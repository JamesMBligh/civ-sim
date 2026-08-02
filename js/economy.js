// The living economy: trade routes over the movement-cost surface,
// settlement economies fed by production and exchange, tracks worn by
// use, roads built on purpose, and mineral deposits that run dry.
// See design/economic-geography.md §3-§5.

const NETWORK_INTERVAL = 5; // years between full route recomputations

// --- Trade network -------------------------------------------------------------

function tribeHasBoatsPair(a, b) {
  return a.progress.techs.has('boats') || (b && b.progress.techs.has('boats'));
}

// Which settlement pairs should even attempt a route: each settlement to
// its nearest same-tribe neighbour and to the tribe's chief settlement
// (internal trade), plus the closest pair across each trading relation.
function collectRoutePairs(world) {
  const pairs = [];
  const seen = new Set();
  const addPair = (a, b) => {
    if (!a || !b || a.id === b.id) return;
    const key = a.id < b.id ? `${a.id}-${b.id}` : `${b.id}-${a.id}`;
    if (!seen.has(key)) {
      seen.add(key);
      pairs.push([a, b]);
    }
  };
  const dist2 = (a, b) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;

  for (const tribe of world.tribes) {
    if (!tribe.alive) continue;
    const mine = tribeSettlements(world, tribe.id);
    if (mine.length < 2) continue;
    const chief = tribeChiefSettlement(world, tribe);
    for (const s of mine) {
      addPair(s, chief);
      let nearest = null;
      let best = Infinity;
      for (const o of mine) {
        if (o === s) continue;
        const d = dist2(s, o);
        if (d < best) { best = d; nearest = o; }
      }
      addPair(s, nearest);
    }
  }

  for (const [key, rel] of Object.entries(world.relations || {})) {
    if (rel.stance !== 'trade') continue;
    const [aId, bId] = key.split('-').map(Number);
    const ta = world.tribes[aId];
    const tb = world.tribes[bId];
    if (!ta || !tb || !ta.alive || !tb.alive) continue;
    const sa = tribeSettlements(world, aId);
    const sb = tribeSettlements(world, bId);
    let bestPair = null;
    let best = Infinity;
    for (const a of sa) {
      for (const b of sb) {
        const d = dist2(a, b);
        if (d < best) { best = d; bestPair = [a, b]; }
      }
    }
    if (bestPair) addPair(bestPair[0], bestPair[1]);
  }
  return pairs;
}

function updateTradeNetwork(world) {
  const { size } = world;
  if (!world.roadLevel) world.roadLevel = new Uint8Array(size * size);
  if (!world.wear) world.wear = new Float32Array(size * size);

  // Roads changed since last time (or first run): rebuild cost grids.
  world.costWalk = buildCostGrid(world, false);
  world.costBoats = buildCostGrid(world, true);

  const routes = [];
  const flow = new Float32Array(size * size);
  const pairs = collectRoutePairs(world);

  for (const [a, b] of pairs) {
    const ta = world.tribes[a.tribeId];
    const tb = world.tribes[b.tribeId];
    const grid = tribeHasBoatsPair(ta, tb) ? world.costBoats : world.costWalk;
    const found = findPath(world, grid, a.y * size + a.x, b.y * size + b.x, 120);
    if (!found) continue;
    // Flow: how much the two ends have to exchange, damped by distance.
    const routeFlow = Math.sqrt(Math.min(a.pop, b.pop)) / (1 + found.cost / 25);
    if (routeFlow < 1) continue;
    routes.push({
      aId: a.id, bId: b.id, cost: found.cost, path: found.path, flow: routeFlow,
      external: a.tribeId !== b.tribeId,
    });
    for (const idx of found.path) flow[idx] += routeFlow;
  }

  world.routes = routes;
  world.routeFlow = flow;

  // Wear: traffic marks the land. Old wear fades; sustained flow beats a
  // track into existence, and a track that loses its traffic grasses over.
  const wear = world.wear;
  const roads = world.roadLevel;
  const TRACK_THRESHOLD = 35;
  for (let i = 0; i < wear.length; i++) {
    wear[i] = wear[i] * 0.55 + flow[i];
    if (roads[i] === ROAD_NONE && wear[i] > TRACK_THRESHOLD) {
      roads[i] = ROAD_TRACK;
    } else if (roads[i] === ROAD_TRACK && wear[i] < TRACK_THRESHOLD * 0.3) {
      roads[i] = ROAD_NONE;
    }
  }
}

// Settlement income from the network: routes ending here (trade) and
// routes passing within a tile (market — the crossroads bonus).
function computeSettlementIncome(world) {
  const { size } = world;
  const income = new Map(); // settlement id -> {trade, market, mine}
  for (const s of world.settlements) {
    income.set(s.id, { trade: 0, market: 0, mine: 0 });
  }
  for (const route of world.routes || []) {
    const a = income.get(route.aId);
    const b = income.get(route.bId);
    // External exchange is worth more than moving goods internally.
    const value = route.flow * (route.external ? 1.5 : 1);
    if (a) a.trade += value;
    if (b) b.trade += value;

    for (const s of world.settlements) {
      if (s.id === route.aId || s.id === route.bId) continue;
      // Passing through: any route tile within 1 of the settlement.
      for (const idx of route.path) {
        const dx = (idx % size) - s.x;
        const dy = ((idx / size) | 0) - s.y;
        if (dx * dx + dy * dy <= 2) {
          income.get(s.id).market += route.flow * 0.5;
          break;
        }
      }
    }
  }
  world.settlementIncome = income;
}

// --- Roads: built on purpose ---------------------------------------------------
// A tribe with the Roads tech paves its highest-wear tracks, at a pace
// set by discipline and governance. Rome builds roads.

function buildRoads(world, tribe, log) {
  if (!tribe.progress.techs.has('roads') || !world.roadLevel) return;
  const { size } = world;
  const owner = world.influenceOwner;
  const perYear = Math.round(1 + 4 * tribe.traits.discipline +
    (tribe.progress.governance !== 'chiefdom' ? 1 : 0));

  // Candidate tiles: this tribe's tracks, richest wear first.
  const candidates = [];
  for (let i = 0; i < size * size; i++) {
    // Only genuinely busy tracks are worth paving — this keeps braided
    // parallel paths from all being made permanent.
    if (world.roadLevel[i] === ROAD_TRACK && world.wear[i] > 50 &&
        owner && owner[i] === tribe.id) {
      candidates.push(i);
    }
  }
  candidates.sort((a, b) => world.wear[b] - world.wear[a] || a - b);

  let built = 0;
  for (const i of candidates) {
    if (built >= perYear) break;
    // Bridging a river tile needs the Bridges tech.
    if (world.terrain[i] === TERRAIN.RIVER &&
        !tribe.progress.techs.has('bridges')) continue;
    world.roadLevel[i] = ROAD_ROAD;
    built++;
  }
  if (built > 0 && !tribe.roadsStarted) {
    tribe.roadsStarted = true;
    log(`${tribe.name} began laying roads.`);
  }
}

// --- Mineral deposits: extraction and exhaustion --------------------------------

const DEPLETABLE = new Set(['gold', 'silver', 'copper', 'tin', 'iron', 'lead']);
const EXTRACTION_TECH = {
  copper: 'copper_working',
  tin: 'bronze_working',
  gold: 'copper_working',
  silver: 'copper_working',
  lead: 'copper_working',
  iron: 'iron_working',
};

function initDeposits(world, rng) {
  const { size, resources } = world;
  const surface = new Float32Array(size * size);
  const deep = new Float32Array(size * size);
  for (let i = 0; i < size * size; i++) {
    const res = resources[i];
    if (res && DEPLETABLE.has(res.id)) {
      surface[i] = rng.int(80, 200);
      deep[i] = rng.int(250, 600);
    }
  }
  world.depositSurface = surface;
  world.depositDeep = deep;
}

// Is this mineral tile still yielding for the given tribe?
function depositActive(world, i, tribe) {
  const res = world.resources[i];
  if (!res) return false;
  if (!DEPLETABLE.has(res.id)) return true;
  if (world.depositSurface[i] > 0) return true;
  return tribe && tribe.progress.techs.has('deep_mining') &&
    world.depositDeep[i] > 0;
}

// A deposit nobody can currently work (worked out at the surface, deep
// tier out of technological reach). Used for rendering and site scoring.
function depositDormant(world, i) {
  const res = world.resources[i];
  if (!res || !DEPLETABLE.has(res.id)) return false;
  if (world.depositSurface[i] > 0) return false;
  for (const tribe of world.tribes || []) {
    if (tribe.alive && tribe.progress.techs.has('deep_mining') &&
        world.depositDeep[i] > 0) return false;
  }
  return true;
}

// Yearly extraction: each settlement works the active deposits within
// reach that its tribe can exploit. Feeds mine income; drains deposits.
function updateExtraction(world, log) {
  if (!world.depositSurface) return;
  const { size } = world;
  const REACH = 3;

  // Mine income is re-earned each year (trade/market income persists
  // between network updates).
  if (world.settlementIncome) {
    for (const inc of world.settlementIncome.values()) inc.mine = 0;
  }

  for (const s of world.settlements) {
    const tribe = world.tribes[s.tribeId];
    if (!tribe || !tribe.alive) continue;
    const inc = world.settlementIncome && world.settlementIncome.get(s.id);

    for (let dy = -REACH; dy <= REACH; dy++) {
      for (let dx = -REACH; dx <= REACH; dx++) {
        const x = s.x + dx;
        const y = s.y + dy;
        if (x < 0 || y < 0 || x >= size || y >= size) continue;
        const i = y * size + x;
        const res = world.resources[i];
        if (!res || !DEPLETABLE.has(res.id)) continue;
        const tech = EXTRACTION_TECH[res.id];
        if (tech && !tribe.progress.techs.has(tech)) continue;

        if (world.depositSurface[i] > 0) {
          world.depositSurface[i] -= 1;
          if (inc) inc.mine += 3;
          if (world.depositSurface[i] <= 0) {
            log(`The ${res.name.toLowerCase()} near ${s.name} is worked out` +
              (world.depositDeep[i] > 0 ? '; richer veins lie deeper.' : '.'));
          }
        } else if (tribe.progress.techs.has('deep_mining') &&
                   world.depositDeep[i] > 0) {
          world.depositDeep[i] -= 1;
          if (inc) inc.mine += 3;
          if (!world.reopened) world.reopened = new Set();
          if (!world.reopened.has(i)) {
            world.reopened.add(i);
            log(`Deep shafts reopened the old ${res.name.toLowerCase()} workings near ${s.name}.`);
          }
        }
      }
    }
  }
}

// The prosperity multiplier a settlement's economy earns it, applied to
// growth rate and (for trade towns fed by imports) its effective cap.
function settlementProsperity(world, s) {
  const inc = world.settlementIncome && world.settlementIncome.get(s.id);
  if (!inc) return { growth: 1, capBoost: 1, income: 0 };
  const income = inc.trade + inc.market + inc.mine;
  const perHead = income / (30 + s.pop * 0.04);
  return {
    growth: 1 + Math.min(0.35, perHead),
    capBoost: 1 + Math.min(0.6, perHead * 0.8),
    income,
  };
}
