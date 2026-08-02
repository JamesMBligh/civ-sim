// Tribe founding: scores the landscape for settlement suitability and
// places a handful of primitive tribes at the best well-separated sites —
// river valleys, fertile lowland and rich coasts, just where real early
// peoples settled.

const TRIBE_COLORS = [
  '#e05555', '#4f8fe0', '#57c470', '#e0b03c',
  '#a06ee0', '#e07fb0', '#4fc4c4', '#c4884f',
];

const NAME_STEMS = ['Ash', 'Bran', 'Cor', 'Dun', 'Elm', 'Fen', 'Gal', 'Hazel',
  'Ith', 'Kel', 'Lor', 'Mor', 'Nav', 'Ost', 'Pel', 'Rin', 'Sul', 'Tor'];
const NAME_SUFFIXES = ['folk', 'kin', 'clan', 'tribe', 'people'];

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

  const takenNames = new Set();
  world.tribes = sites.map((site, idx) => {
    const pop = rng.int(90, 160);
    return {
      id: idx,
      name: generateTribeName(rng, takenNames),
      color: TRIBE_COLORS[idx % TRIBE_COLORS.length],
      settlements: [{ x: site.x, y: site.y, pop }],
      alive: true,
    };
  });

  world.year = 0;
  world.events = [{
    year: 0,
    text: `${world.tribes.length} tribes arrived on the island and made their first camps.`,
  }];
  world.tensions = new Set();

  computeInfluence(world);
  return world.tribes;
}

function tribePopulation(tribe) {
  return tribe.settlements.reduce((sum, s) => sum + s.pop, 0);
}
