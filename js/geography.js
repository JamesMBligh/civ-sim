// Economic geography: the movement-cost surface, static site features
// (harbors, fords, confluences), and A* pathfinding. Everything the trade
// network does derives from this substrate.
// See design/economic-geography.md.

const ROAD_NONE = 0;
const ROAD_TRACK = 1;
const ROAD_ROAD = 2;
const ROAD_FERRY = 3; // an established water crossing or barge lane

// --- Static site features ---------------------------------------------------
// Properties of the map itself, computed once at worldgen: places where a
// settlement has a reason to exist beyond the fertility of the ground.

function computeSiteFeatures(world) {
  const { size, terrain } = world;
  const access = new Float32Array(size * size);

  const at = (x, y) => (x < 0 || y < 0 || x >= size || y >= size)
    ? null : terrain[y * size + x];
  const N4 = [[0, -1], [1, 0], [0, 1], [-1, 0]];

  for (let y = 1; y < size - 1; y++) {
    for (let x = 1; x < size - 1; x++) {
      const i = y * size + x;
      const t = terrain[i];

      if (t === TERRAIN.RIVER) {
        let riverN = 0;
        let seaN = 0;
        for (const [dx, dy] of N4) {
          const nt = at(x + dx, y + dy);
          if (nt === TERRAIN.RIVER) riverN++;
          if (nt && isSea(nt)) seaN++;
        }
        // River mouth: where the river meets the sea — a natural port.
        if (seaN > 0) spread(access, world, x, y, 2.5, 1);
        // Confluence: branches meeting.
        else if (riverN >= 3) spread(access, world, x, y, 2.0, 1);
        // Ford: a narrow crossing — land flanking the channel on
        // opposite sides.
        else {
          const landLR = at(x - 1, y) && !isWater(at(x - 1, y)) &&
            at(x + 1, y) && !isWater(at(x + 1, y));
          const landUD = at(x, y - 1) && !isWater(at(x, y - 1)) &&
            at(x, y + 1) && !isWater(at(x, y + 1));
          if (landLR || landUD) spread(access, world, x, y, 1.5, 1);
        }
      }

      // Harbor: a coast tile cradled by open water — shelter and access.
      if (t === TERRAIN.COAST) {
        let seaN = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nt = at(x + dx, y + dy);
            if (nt && isSea(nt)) seaN++;
          }
        }
        if (seaN >= 3) access[i] += 2.0;
      }
    }
  }

  world.siteAccess = access;
}

// Add value to the land tiles around a water feature (you settle beside
// the ford, not in it).
function spread(access, world, cx, cy, value, radius) {
  const { size, terrain } = world;
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const x = cx + dx;
      const y = cy + dy;
      if (x < 0 || y < 0 || x >= size || y >= size) continue;
      const i = y * size + x;
      if (isWater(terrain[i])) continue;
      access[i] = Math.max(access[i], value / (1 + Math.abs(dx) + Math.abs(dy)) * 2);
    }
  }
}

// --- The movement-cost surface -----------------------------------------------

const IMPASSABLE = Infinity;

// Infrastructure travel costs. The gap between an established road and
// raw terrain is what makes traffic consolidate onto existing corridors
// instead of wearing new parallel paths — the wider the gap, the fewer
// roads the island ends up needing.
const COST_ROAD = 0.08;        // established road: strongly preferred (3.5:1 vs plains)
const TRACK_FACTOR = 0.85;      // a worn track modestly eases the underlying terrain
const COST_FERRY_BOATS = 0.35; // a worked crossing, for peoples with boats
const COST_FERRY_WALK = 1.5;   // an operated ferry carries anyone, at a price

// Cost grids are rebuilt at each trade-network update (they change as
// roads are laid) and stored as world.costWalk / world.costBoats.
function buildCostGrid(world, hasBoats) {
  const { size, terrain } = world;
  const roads = world.roadLevel;
  const cost = new Float32Array(size * size);

  const BASE = {
    [TERRAIN.GRASSLAND]: 1.0,
    [TERRAIN.PLAINS]: 1.0,
    [TERRAIN.COAST]: 1.0,
    [TERRAIN.FOREST]: 1.8,
    [TERRAIN.HILLS]: 2.5,
    [TERRAIN.MARSH]: 3.0,
    [TERRAIN.MOUNTAINS]: 6.0,
    [TERRAIN.PEAKS]: IMPASSABLE,
    [TERRAIN.RIVER]: 2.2,     // fording, without boats
    [TERRAIN.LAKE]: IMPASSABLE,
    [TERRAIN.OCEAN]: IMPASSABLE,
    [TERRAIN.DEEP_OCEAN]: IMPASSABLE, // open sea awaits Sailing
  };

  let minCost = Infinity;
  for (let i = 0; i < size * size; i++) {
    const t = terrain[i];
    let c = BASE[t] !== undefined ? BASE[t] : 1.5;

    if (hasBoats) {
      // Boats turn water into the cheapest lanes on the map: rivers
      // and coastal waters carry trade, as they did historically.
      if (t === TERRAIN.RIVER) c = 0.35;
      else if (t === TERRAIN.LAKE) c = 0.4;
      else if (t === TERRAIN.OCEAN) c = 0.45;
    }

    // Physical infrastructure is usable by anyone who walks it. A road
    // on a river tile is a bridge; a ferry is an operated crossing —
    // cheap for boat peoples, and it opens the water to everyone else.
    if (roads && roads[i] === ROAD_ROAD) c = Math.min(c, COST_ROAD);
    else if (roads && roads[i] === ROAD_TRACK) c = Math.min(c, c * TRACK_FACTOR);
    else if (roads && roads[i] === ROAD_FERRY) {
      c = Math.min(c, hasBoats ? COST_FERRY_BOATS : COST_FERRY_WALK);
    }

    cost[i] = c;
    if (c < minCost) minCost = c;
  }
  // The cheapest passable step, used as the A* heuristic floor — the
  // tighter this is, the less the search wanders.
  cost.minCost = minCost;
  return cost;
}

// --- A* pathfinding ------------------------------------------------------------
// Scratch buffers are reused across calls; generation stamps avoid
// clearing 65k-entry arrays each time.

const astar = {
  size: 0,
  g: null, from: null, seen: null, gen: 0,
  heapF: new Float64Array(1 << 16), heapI: new Int32Array(1 << 16), heapN: 0,
};

function astarInit(n) {
  if (astar.size !== n) {
    astar.size = n;
    astar.g = new Float32Array(n);
    astar.from = new Int32Array(n);
    astar.seen = new Int32Array(n);
    astar.gen = 0;
  }
  astar.gen++;
  astar.heapN = 0;
}

function heapPush(f, idx) {
  const { heapF, heapI } = astar;
  let i = astar.heapN++;
  if (i >= heapF.length) return; // saturated: drop (search is capped anyway)
  heapF[i] = f;
  heapI[i] = idx;
  while (i > 0) {
    const p = (i - 1) >> 1;
    if (heapF[p] <= heapF[i]) break;
    const tf = heapF[p]; heapF[p] = heapF[i]; heapF[i] = tf;
    const ti = heapI[p]; heapI[p] = heapI[i]; heapI[i] = ti;
    i = p;
  }
}

function heapPop() {
  const { heapF, heapI } = astar;
  const topF = heapF[0];
  const topI = heapI[0];
  const n = --astar.heapN;
  heapF[0] = heapF[n];
  heapI[0] = heapI[n];
  let i = 0;
  for (;;) {
    const l = 2 * i + 1;
    const r = l + 1;
    let m = i;
    if (l < n && heapF[l] < heapF[m]) m = l;
    if (r < n && heapF[r] < heapF[m]) m = r;
    if (m === i) break;
    const tf = heapF[m]; heapF[m] = heapF[i]; heapF[i] = tf;
    const ti = heapI[m]; heapI[m] = heapI[i]; heapI[i] = ti;
    i = m;
  }
  astar.popF = topF;
  return topI;
}

// Cheapest path between two tiles. Returns { cost, path } or null if
// unreachable, over maxCost, or the search exceeds its node budget.
// 8-directional with diagonal scaling.
function findPath(world, cost, startIdx, goalIdx, maxCost = 150) {
  const { size } = world;
  astarInit(size * size);
  const { g, from, seen } = astar;
  const gen = astar.gen;
  const MAX_EXPANSIONS = 15000;

  const gx = goalIdx % size;
  const gy = (goalIdx / size) | 0;
  const floor = cost.minCost || 0.35; // admissible heuristic floor
  const h = (idx) => {
    const dx = (idx % size) - gx;
    const dy = ((idx / size) | 0) - gy;
    return Math.sqrt(dx * dx + dy * dy) * floor;
  };

  g[startIdx] = 0;
  from[startIdx] = -1;
  seen[startIdx] = gen;
  heapPush(h(startIdx), startIdx);

  let expansions = 0;
  while (astar.heapN > 0) {
    const current = heapPop();
    const f = astar.popF;
    if (current === goalIdx) {
      const path = [];
      let idx = goalIdx;
      while (idx !== -1) {
        path.push(idx);
        idx = from[idx];
      }
      path.reverse();
      return { cost: g[goalIdx], path };
    }
    if (f - h(current) > g[current] + 1e-9) continue; // stale entry
    if (g[current] > maxCost) return null;
    if (++expansions > MAX_EXPANSIONS) return null;

    const cx = current % size;
    const cy = (current / size) | 0;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
        const ni = ny * size + nx;
        const stepCost = cost[ni];
        if (stepCost === IMPASSABLE) continue;
        const diag = dx !== 0 && dy !== 0 ? 1.4142 : 1;
        const tentative = g[current] + stepCost * diag;
        if (seen[ni] !== gen || tentative < g[ni]) {
          seen[ni] = gen;
          g[ni] = tentative;
          from[ni] = current;
          heapPush(tentative + h(ni), ni);
        }
      }
    }
  }
  return null;
}
