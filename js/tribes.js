// Tribes and settlements.
//
// These are deliberately separate concepts:
//   - A TRIBE is a social entity — a people with a shared identity. It will
//     evolve into the notion of a nation.
//   - A SETTLEMENT is a place — a camp at a location with inhabitants. It
//     will evolve into the notion of a city.
// A settlement declares allegiance to a tribe via `tribeId`; a tribe never
// "contains" places. Allegiance can later change hands (conquest,
// secession, assimilation) without either entity losing its identity.
//
// Settlements live in world.settlements; tribes in world.tribes.

const TRIBE_COLORS = [
  '#e05555', '#4f8fe0', '#57c470', '#e0b03c',
  '#a06ee0', '#e07fb0', '#4fc4c4', '#c4884f',
];

const NAME_STEMS = ['Ash', 'Bran', 'Cor', 'Dun', 'Elm', 'Fen', 'Gal', 'Hazel',
  'Ith', 'Kel', 'Lor', 'Mor', 'Nav', 'Ost', 'Pel', 'Rin', 'Sul', 'Tor'];
const NAME_SUFFIXES = ['folk', 'kin', 'clan', 'tribe', 'people'];

// Place-name parts for settlements — Anglo-ish toponyms so places sound
// like places, not peoples.
const PLACE_STEMS = ['Ash', 'Bran', 'Cor', 'Dun', 'Elm', 'Fen', 'Gal', 'Hazel',
  'Kel', 'Lor', 'Mor', 'Nav', 'Ost', 'Pel', 'Rin', 'Sul', 'Tor', 'Wyn'];
const PLACE_SUFFIXES = ['ford', 'mouth', 'wick', 'ton', 'mere', 'den',
  'holt', 'combe', 'stead', 'bury'];

function generateTribeName(rng, taken) {
  for (let tries = 0; tries < 50; tries++) {
    const name = `The ${rng.pick(NAME_STEMS)}${rng.pick(NAME_SUFFIXES)}`;
    if (!taken.has(name)) {
      taken.add(name);
      return name;
    }
  }
  return `The ${rng.pick(NAME_STEMS)}${rng.pick(NAME_SUFFIXES)}`;
}

function generateSettlementName(world, rng) {
  for (let tries = 0; tries < 80; tries++) {
    const name = `${rng.pick(PLACE_STEMS)}${rng.pick(PLACE_SUFFIXES)}`;
    if (!world.settlementNames.has(name)) {
      world.settlementNames.add(name);
      return name;
    }
  }
  // Fallback: qualify a reused name rather than fail.
  return `New ${rng.pick(PLACE_STEMS)}${rng.pick(PLACE_SUFFIXES)}`;
}

function createSettlement(world, rng, x, y, pop, tribeId) {
  const settlement = {
    id: world.nextSettlementId++,
    name: generateSettlementName(world, rng),
    x,
    y,
    pop,
    tribeId,           // allegiance, not ownership — may change hands later
    foundedYear: world.year || 0,
  };
  world.settlements.push(settlement);
  return settlement;
}

// --- Tribe/settlement relationship helpers ---

function tribeSettlements(world, tribeId) {
  return world.settlements.filter((s) => s.tribeId === tribeId);
}

function tribePopulation(world, tribe) {
  let sum = 0;
  for (const s of world.settlements) {
    if (s.tribeId === tribe.id) sum += s.pop;
  }
  return sum;
}

// A tribe's chief settlement (the future "capital"): its oldest surviving
// settlement, ties broken by size.
function tribeChiefSettlement(world, tribe) {
  let chief = null;
  for (const s of world.settlements) {
    if (s.tribeId !== tribe.id) continue;
    if (!chief || s.foundedYear < chief.foundedYear ||
      (s.foundedYear === chief.foundedYear && s.pop > chief.pop)) {
      chief = s;
    }
  }
  return chief;
}

function settlementAt(world, x, y, radius = 1) {
  if (!world.settlements) return null;
  for (const s of world.settlements) {
    if (Math.abs(s.x - x) <= radius && Math.abs(s.y - y) <= radius) return s;
  }
  return null;
}

// How attractive a tile is as a place to live. Used both for the initial
// founding sites and for daughter settlements later on.
function settlementScore(world, x, y) {
  const { size, terrain, resources } = world;
  const i = y * size + x;
  const t = terrain[i];

  const BASE = {
    [TERRAIN.GRASSLAND]: 2.0,
    [TERRAIN.PLAINS]: 1.6,
    [TERRAIN.FOREST]: 1.0,
    [TERRAIN.COAST]: 1.0,
    [TERRAIN.MARSH]: 0.2,
    [TERRAIN.HILLS]: 0.4,
  };
  if (!(t in BASE)) return -Infinity; // water, mountains, peaks: no camps
  let score = BASE[t];

  for (let dy = -3; dy <= 3; dy++) {
    for (let dx = -3; dx <= 3; dx++) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
      const ni = ny * size + nx;
      const nt = terrain[ni];
      const close = Math.abs(dx) <= 1 && Math.abs(dy) <= 1;

      if (nt === TERRAIN.RIVER) score += close ? 2.5 : 0.8;
      else if (nt === TERRAIN.LAKE) score += close ? 1.5 : 0.5;
      else if (isSea(nt)) score += close ? 0.8 : 0.2;

      const res = resources[ni];
      if (res) {
        if (res.id === 'fertile') score += 1.2;
        else if (res.id === 'fish') score += 0.9;
        else if (res.id === 'game') score += 0.7;
        else if (res.id === 'timber') score += 0.4;
        else if (res.id === 'flint') score += 0.3;
      }
    }
  }
  return score;
}

// --- Bands: nomadic groups of people, not places -------------------------
// While a tribe is nomadic it has no settlements. Its presence on the map
// is its bands: unnamed, mobile, and transient. Named places begin only
// when agriculture roots a people to the ground.

function createBand(world, x, y, pop, tribeId) {
  const band = {
    id: world.nextBandId++,
    x, y, pop, tribeId,
    lastMove: world.year || 0,
  };
  world.bands.push(band);
  return band;
}

function tribeBands(world, tribeId) {
  return world.bands.filter((b) => b.tribeId === tribeId);
}

function tribeIsNomadic(world, tribe) {
  return tribeSettlements(world, tribe.id).length === 0;
}

function bandAt(world, x, y, radius = 1) {
  if (!world.bands) return null;
  for (const b of world.bands) {
    if (Math.abs(b.x - x) <= radius && Math.abs(b.y - y) <= radius) return b;
  }
  return null;
}

// Sedentism: called when a tribe masters Agriculture (or qualifies for a
// fishing proto-village). Its bands converge on the best ground in their
// range and become the tribe's first true settlement.
function settleTribe(world, tribe, rng, { proto = false } = {}) {
  const { size } = world;
  const bands = tribeBands(world, tribe.id);
  if (bands.length === 0) return null;

  const cx = Math.round(bands.reduce((s, b) => s + b.x, 0) / bands.length);
  const cy = Math.round(bands.reduce((s, b) => s + b.y, 0) / bands.length);

  let best = null;
  let bestScore = -Infinity;
  const R = 14;
  for (let dy = -R; dy <= R; dy++) {
    for (let dx = -R; dx <= R; dx++) {
      const x = cx + dx;
      const y = cy + dy;
      if (x < 4 || y < 4 || x >= size - 4 || y >= size - 4) continue;
      const s = settlementScore(world, x, y);
      if (s > bestScore) { bestScore = s; best = { x, y }; }
    }
  }
  if (!best) return null;

  const totalPop = bands.reduce((s, b) => s + b.pop, 0);
  world.bands = world.bands.filter((b) => b.tribeId !== tribe.id);
  const settlement = createSettlement(world, rng, best.x, best.y, totalPop, tribe.id);
  if (proto) settlement.proto = true;
  tribe.sedentaryYear = world.year;
  return settlement;
}

// A splinter people born of civil war: they carry the parent's knowledge
// and most of its character, but their identity is forged anew in revolt —
// cohesion runs higher, and the founding traits reset to who they now are.
function createSplinterTribe(world, parent, rng) {
  const id = world.tribes.length;
  const takenNames = new Set(world.tribes.map((t) => t.name));
  const traits = {};
  for (const key of TRAIT_KEYS) {
    traits[key] = clamp01(parent.traits[key] + rng.range(-0.08, 0.08));
  }
  traits.cohesion = clamp01(traits.cohesion + 0.15);

  const tribe = {
    id,
    name: generateTribeName(rng, takenNames),
    color: TRIBE_COLORS[id % TRIBE_COLORS.length],
    alive: true,
    archetype: parent.archetype,
    parentId: parent.id,
    traits,
    foundingTraits: { ...traits },
    nudges: {},
    progress: {
      techs: new Set(parent.progress.techs), // knowledge does not un-learn
      pools: {
        tech: parent.progress.pools.tech * 0.3,
        art: parent.progress.pools.art * 0.3,
        philosophy: parent.progress.pools.philosophy * 0.3,
      },
      governance: 'chiefdom',
      artStage: parent.progress.artStage,
      philStage: parent.progress.philStage,
      target: null,
    },
    resourceAccess: new Set(),
    tradePartners: 0,
    sedentaryYear: parent.sedentaryYear,
    peakPop: 0,
    unity: 0.85,
    rangeCenter: { ...parent.rangeCenter },
  };
  // The parent keeps 70% of its accumulated pools.
  parent.progress.pools.tech *= 0.7;
  parent.progress.pools.art *= 0.7;
  parent.progress.pools.philosophy *= 0.7;

  world.tribes.push(tribe);
  return tribe;
}

function foundTribes(world, count = 7) {
  const rng = new RNG(world.seed + ':tribes');
  const { size } = world;
  const MIN_SEPARATION = 26; // tiles (~100 km) between home ranges

  // Score every eligible tile, then greedily take the best sites that
  // keep their distance from already-chosen ones. These are home-range
  // centres, not settlements — the arrivals are nomads.
  const scored = [];
  for (let y = 4; y < size - 4; y++) {
    for (let x = 4; x < size - 4; x++) {
      const s = settlementScore(world, x, y);
      if (s > 3) scored.push({ x, y, s });
    }
  }
  scored.sort((a, b) => b.s - a.s);

  const sites = [];
  for (const cand of scored) {
    if (sites.length >= count) break;
    const ok = sites.every((p) => {
      const dx = p.x - cand.x;
      const dy = p.y - cand.y;
      return dx * dx + dy * dy >= MIN_SEPARATION * MIN_SEPARATION;
    });
    if (ok) sites.push(cand);
  }

  world.year = 0;
  world.settlements = [];
  world.bands = [];
  world.nextSettlementId = 0;
  world.nextBandId = 0;
  world.settlementNames = new Set();
  world.relations = {};

  // Assign archetypes: each real-civilization preset once (shuffled),
  // any remaining tribes are fully random peoples.
  const archetypeIds = Object.keys(ARCHETYPES);
  shuffleInPlace(archetypeIds, rng.fork('archetypes'));

  const takenNames = new Set();
  world.tribes = sites.map((site, idx) => {
    const archetype = idx < archetypeIds.length ? archetypeIds[idx] : 'random';
    const traits = rollTraits(rng.fork('traits:' + idx),
      archetype === 'random' ? null : archetype);
    return {
      id: idx,
      name: generateTribeName(rng, takenNames),
      color: TRIBE_COLORS[idx % TRIBE_COLORS.length],
      alive: true,
      archetype,
      traits,
      foundingTraits: { ...traits },
      nudges: {},
      progress: {
        techs: new Set(['flint_knapping']),
        pools: { tech: 0, art: 0, philosophy: 0 },
        governance: 'band',
        artStage: 0,
        philStage: 0,
        target: null,
      },
      resourceAccess: new Set(),
      tradePartners: 0,
      sedentaryYear: null,
      peakPop: 0,
      // Unity is STATE, not a trait: the current condition of the polity.
      // Conquest dilutes it with unabsorbed peoples; time, cohesion and
      // discipline rebuild it. Low unity saps the economy and can end in
      // civil war.
      unity: 1,
      rangeCenter: { x: site.x, y: site.y },
    };
  });

  // Each tribe arrives as a couple of wandering bands near its range.
  for (const tribe of world.tribes) {
    const c = tribe.rangeCenter;
    const nBands = rng.int(2, 3);
    for (let k = 0; k < nBands; k++) {
      const bx = Math.max(4, Math.min(size - 5, c.x + rng.int(-6, 6)));
      const by = Math.max(4, Math.min(size - 5, c.y + rng.int(-6, 6)));
      createBand(world, bx, by, rng.int(25, 55), tribe.id);
    }
  }

  world.events = [{
    year: 0,
    text: `${world.tribes.length} tribes arrived on the island as wandering bands of foragers.`,
  }];

  computeInfluence(world);
  computeResourceAccess(world);
  return world.tribes;
}
