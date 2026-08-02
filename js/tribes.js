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

function foundTribes(world, count = 7) {
  const rng = new RNG(world.seed + ':tribes');
  const { size } = world;
  const MIN_SEPARATION = 26; // tiles (~100 km) between founding sites

  // Score every eligible tile, then greedily take the best sites that
  // keep their distance from already-chosen ones.
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
  world.nextSettlementId = 0;
  world.settlementNames = new Set();
  world.tensions = new Set();

  const takenNames = new Set();
  world.tribes = sites.map((site, idx) => ({
    id: idx,
    name: generateTribeName(rng, takenNames),
    color: TRIBE_COLORS[idx % TRIBE_COLORS.length],
    alive: true,
  }));

  for (const tribe of world.tribes) {
    const site = sites[tribe.id];
    createSettlement(world, rng, site.x, site.y, rng.int(90, 160), tribe.id);
  }

  world.events = [{
    year: 0,
    text: `${world.tribes.length} tribes arrived on the island and made their first camps.`,
  }];

  computeInfluence(world);
  return world.tribes;
}
