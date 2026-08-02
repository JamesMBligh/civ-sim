// The simulation: yearly ticks of tribal life. Each settlement gathers
// food from the land around it; population grows toward the local carrying
// capacity, large settlements bud off daughter camps, and each tribe's
// influence spreads across the landscape as it grows.

// How many people one tile can feed for a year (very roughly), given its
// terrain and any food resource on it. Cached per world.
function computeFoodValues(world) {
  if (world.foodValue) return world.foodValue;
  const { size, terrain, resources } = world;
  const fv = new Float32Array(size * size);

  const TERRAIN_FOOD = {
    [TERRAIN.GRASSLAND]: 1.2,
    [TERRAIN.PLAINS]: 1.0,
    [TERRAIN.FOREST]: 1.4,   // foraging and hunting
    [TERRAIN.COAST]: 0.8,
    [TERRAIN.MARSH]: 0.6,    // wildfowl, eels
    [TERRAIN.HILLS]: 0.5,
    [TERRAIN.RIVER]: 2.0,
    [TERRAIN.LAKE]: 1.5,
    [TERRAIN.MOUNTAINS]: 0.1,
  };

  for (let i = 0; i < size * size; i++) {
    let v = TERRAIN_FOOD[terrain[i]] || 0;
    const res = resources[i];
    if (res) {
      if (res.id === 'fertile') v += 4;
      else if (res.id === 'fish') v += 3;
      else if (res.id === 'game') v += 2.5;
      else if (res.id === 'timber') v += 0.5;
    }
    fv[i] = v;
  }
  world.foodValue = fv;
  return fv;
}

function gatherRadius(pop) {
  return 3 + Math.sqrt(Math.max(0, pop)) / 2.5;
}

// Carrying capacity of the land a settlement can reach.
function settlementCapacity(world, s) {
  const fv = computeFoodValues(world);
  const { size } = world;
  const r = gatherRadius(s.pop);
  const ri = Math.ceil(r);
  let cap = 0;
  for (let dy = -ri; dy <= ri; dy++) {
    for (let dx = -ri; dx <= ri; dx++) {
      if (dx * dx + dy * dy > r * r) continue;
      const nx = s.x + dx;
      const ny = s.y + dy;
      if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
      cap += fv[ny * size + nx];
    }
  }
  return cap;
}

function simulateYears(world, years = 10) {
  if (!world.tribes) foundTribes(world);
  for (let k = 0; k < years; k++) {
    simulateYear(world);
  }
  computeInfluence(world);
}

function simulateYear(world) {
  world.year++;
  const year = world.year;
  const rng = new RNG(world.seed + ':year:' + year);
  const log = (text) => world.events.push({ year, text });

  // Island-wide season quality for the year.
  const seasonRoll = rng.random();
  let seasonFactor = 1;
  if (seasonRoll < 0.15) {
    seasonFactor = 0.75;
    log('A harsh winter gripped the island; food ran short everywhere.');
  } else if (seasonRoll > 0.85) {
    seasonFactor = 1.2;
    log('A mild year with rich harvests of forage and game.');
  }

  const GROWTH_RATE = 0.06;

  // Places live their year: each settlement feeds itself from the land
  // around it, whatever tribe it answers to.
  for (const s of world.settlements) {
    const cap = Math.max(10, settlementCapacity(world, s) * seasonFactor);
    // Logistic growth toward capacity; shrinks when over capacity.
    const growth = GROWTH_RATE * s.pop * (1 - s.pop / cap);
    s.pop = Math.max(0, s.pop + growth + rng.range(-2, 2));
  }

  // Founding daughter settlements: a crowded settlement sends part of its
  // people to the best nearby unclaimed ground. The new place keeps the
  // parent's allegiance. At most one founding per tribe per year.
  const SPLIT_POP = 220;
  const foundedThisYear = new Set();
  for (const s of [...world.settlements]) {
    if (s.pop < SPLIT_POP || foundedThisYear.has(s.tribeId)) continue;
    const site = findDaughterSite(world, s, rng);
    if (!site) continue;
    const migrants = Math.round(s.pop * 0.4);
    s.pop -= migrants;
    const daughter = createSettlement(world, rng, site.x, site.y, migrants, s.tribeId);
    foundedThisYear.add(s.tribeId);
    const tribe = world.tribes[s.tribeId];
    log(`${tribe.name} founded ${daughter.name} as ${s.name} grew crowded.`);
  }

  // Abandon failed settlements.
  world.settlements = world.settlements.filter((s) => {
    if (s.pop >= 12) return true;
    log(`${s.name} was abandoned as its people dwindled.`);
    return false;
  });

  // A tribe with no settlements left has died out as a people.
  for (const tribe of world.tribes) {
    if (tribe.alive && tribeSettlements(world, tribe.id).length === 0) {
      tribe.alive = false;
      log(`${tribe.name} died out.`);
    }
  }

  computeInfluence(world);
  detectTensions(world, log);
}

// Pick a spot 8-16 tiles from the parent settlement with the best
// settlement score, away from every existing settlement.
function findDaughterSite(world, parent, rng) {
  const { size } = world;
  const MIN_DIST = 7;
  let best = null;
  let bestScore = 4; // don't settle marginal ground

  for (let attempt = 0; attempt < 60; attempt++) {
    const angle = rng.range(0, Math.PI * 2);
    const dist = rng.range(8, 16);
    const x = Math.round(parent.x + Math.cos(angle) * dist);
    const y = Math.round(parent.y + Math.sin(angle) * dist);
    if (x < 4 || y < 4 || x >= size - 4 || y >= size - 4) continue;

    let tooClose = false;
    for (const s of world.settlements) {
      const dx = s.x - x;
      const dy = s.y - y;
      if (dx * dx + dy * dy < MIN_DIST * MIN_DIST) { tooClose = true; break; }
    }
    if (tooClose) continue;

    const score = settlementScore(world, x, y);
    if (score > bestScore) {
      bestScore = score;
      best = { x, y };
    }
  }
  return best;
}

// Influence: each settlement projects strength that fades with distance;
// every land tile is credited to whichever tribe is strongest there.
// world.influenceOwner: Int16Array of tribe id (-1 = unclaimed)
// world.influenceStrength: Float32Array 0..1 for display alpha
function computeInfluence(world) {
  const { size, terrain } = world;
  const owner = new Int16Array(size * size).fill(-1);
  const strength = new Float32Array(size * size);
  if (!world.tribes) {
    world.influenceOwner = owner;
    world.influenceStrength = strength;
    return;
  }

  // Accumulate per-tribe strength only where settlements reach: iterate
  // each settlement's footprint instead of every tile x every settlement.
  // Influence flows from PLACES (settlements) but accrues to the SOCIAL
  // entity (the tribe they give allegiance to).
  const tribeStrength = new Float32Array(size * size); // reused per tribe

  for (const tribe of world.tribes) {
    if (!tribe.alive) continue;
    tribeStrength.fill(0);

    for (const s of tribeSettlements(world, tribe.id)) {
      const reach = gatherRadius(s.pop) * 2.2;
      const ri = Math.ceil(reach);
      for (let dy = -ri; dy <= ri; dy++) {
        for (let dx = -ri; dx <= ri; dx++) {
          const nx = s.x + dx;
          const ny = s.y + dy;
          if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
          const d = Math.sqrt(dx * dx + dy * dy);
          if (d > reach) continue;
          const ni = ny * size + nx;
          if (isSea(terrain[ni])) continue;
          tribeStrength[ni] += s.pop * (1 - d / reach);
        }
      }
    }

    for (let i = 0; i < size * size; i++) {
      const v = tribeStrength[i];
      if (v > 0 && v > strength[i]) {
        strength[i] = v;
        owner[i] = tribe.id;
      }
    }
  }

  // Normalise strength into a display alpha.
  for (let i = 0; i < size * size; i++) {
    if (owner[i] >= 0) {
      strength[i] = Math.min(1, strength[i] / 120);
    }
  }

  world.influenceOwner = owner;
  world.influenceStrength = strength;

  // Territory sizes for the stats panel.
  for (const tribe of world.tribes) tribe.territoryTiles = 0;
  for (let i = 0; i < size * size; i++) {
    if (owner[i] >= 0) {
      const tribe = world.tribes[owner[i]];
      if (tribe) tribe.territoryTiles++;
    }
  }
}

// Where two tribes press against each other, note the tension (once per
// pair) — the seed of future conflict and trade mechanics.
function detectTensions(world, log) {
  const { size } = world;
  const owner = world.influenceOwner;
  const contested = new Map(); // "a-b" -> count of border tiles

  for (let y = 1; y < size - 1; y++) {
    for (let x = 1; x < size - 1; x++) {
      const a = owner[y * size + x];
      if (a < 0) continue;
      const b1 = owner[y * size + x + 1];
      const b2 = owner[(y + 1) * size + x];
      for (const b of [b1, b2]) {
        if (b >= 0 && b !== a) {
          const key = a < b ? `${a}-${b}` : `${b}-${a}`;
          contested.set(key, (contested.get(key) || 0) + 1);
        }
      }
    }
  }

  for (const [key, count] of contested) {
    if (count >= 25 && !world.tensions.has(key)) {
      world.tensions.add(key);
      const [a, b] = key.split('-').map(Number);
      const ta = world.tribes[a];
      const tb = world.tribes[b];
      if (ta && tb && ta.alive && tb.alive) {
        log(`${ta.name} and ${tb.name} now share a border; there is tension between them.`);
      }
    }
  }
}
