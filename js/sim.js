// The simulation: yearly ticks of a people's life. Nomadic bands roam and
// forage; agriculture roots tribes into settlements; knowledge, relations
// and governance evolve on top. Orchestration lives in simulateYear.

// --- Food: wild forage vs farmed ground -----------------------------------
// forageValue: what the wild land yields to hunter-gatherers.
// farmValue: what the same tile yields under cultivation (persons/tile —
// a tile is ~16 km², so 40 persons/tile ≈ 2.5 persons per km²).

function computeFoodValues(world) {
  if (world.forageValue) return;
  const { size, terrain, resources, moisture } = world;
  const forage = new Float32Array(size * size);
  const farm = new Float32Array(size * size);

  const FORAGE = {
    [TERRAIN.GRASSLAND]: 0.8,
    [TERRAIN.PLAINS]: 0.6,
    [TERRAIN.FOREST]: 1.2,
    [TERRAIN.COAST]: 0.6,
    [TERRAIN.MARSH]: 0.5,
    [TERRAIN.HILLS]: 0.4,
    [TERRAIN.RIVER]: 1.6,
    [TERRAIN.LAKE]: 1.2,
    [TERRAIN.MOUNTAINS]: 0.08,
  };
  const FARM = {
    [TERRAIN.GRASSLAND]: 45,
    [TERRAIN.PLAINS]: 35,
    [TERRAIN.FOREST]: 12,   // clearings
    [TERRAIN.MARSH]: 8,
    [TERRAIN.COAST]: 10,
    [TERRAIN.HILLS]: 8,
  };

  for (let i = 0; i < size * size; i++) {
    let f = FORAGE[terrain[i]] || 0;
    let a = FARM[terrain[i]] || 0;
    const res = resources[i];
    if (res) {
      if (res.id === 'fertile') { f += 1.5; a += 120; }
      else if (res.id === 'fish') f += 2.5;
      else if (res.id === 'game') f += 2.0;
      else if (res.id === 'timber') f += 0.4;
    }
    if (a > 0 && moisture[i] < 0.3) a *= 0.4; // too dry to farm well
    forage[i] = f;
    farm[i] = a;
  }
  world.forageValue = forage;
  world.farmValue = farm;
}

function sumInRadius(world, field, cx, cy, r) {
  const { size } = world;
  const ri = Math.ceil(r);
  let sum = 0;
  for (let dy = -ri; dy <= ri; dy++) {
    for (let dx = -ri; dx <= ri; dx++) {
      if (dx * dx + dy * dy > r * r) continue;
      const x = cx + dx;
      const y = cy + dy;
      if (x < 0 || y < 0 || x >= size || y >= size) continue;
      sum += field[y * size + x];
    }
  }
  return sum;
}

function nearRiver(world, cx, cy, r) {
  const { size, terrain } = world;
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      const x = cx + dx;
      const y = cy + dy;
      if (x < 0 || y < 0 || x >= size || y >= size) continue;
      const t = terrain[y * size + x];
      if (t === TERRAIN.RIVER || t === TERRAIN.LAKE) return true;
    }
  }
  return false;
}

// --- Carrying capacities ---------------------------------------------------

// A band lives off the wild land within a day or two's walk.
function bandCapacity(world, band) {
  computeFoodValues(world);
  return Math.max(15, sumInRadius(world, world.forageValue, band.x, band.y, 4) * 0.6);
}

function gatherRadius(pop) {
  return 3 + Math.sqrt(Math.max(0, pop)) / 2.5;
}

// A settlement's capacity: wild forage plus, with the right technologies,
// the farmed yield of the surrounding land.
function settlementCapacity(world, s, tribe) {
  computeFoodValues(world);
  const r = Math.min(9, gatherRadius(s.pop));
  let cap = sumInRadius(world, world.forageValue, s.x, s.y, r) * 0.5;

  const techs = tribe.progress.techs;
  if (techs.has('agriculture') && !s.proto) {
    let farmed = sumInRadius(world, world.farmValue, s.x, s.y, r);
    if (techs.has('irrigation') && nearRiver(world, s.x, s.y, 2)) farmed *= 1.5;
    cap += farmed;
  }
  if (techs.has('fishing')) cap *= 1.15;
  if (techs.has('husbandry')) cap *= 1.12;
  if (techs.has('pottery')) cap *= 1.08;   // storage
  if (techs.has('masonry')) cap *= 1.1;    // denser building
  if (s.proto) cap = Math.min(cap, 400);   // a fishing village, not a farm town
  return Math.max(20, cap);
}

// --- Governance -------------------------------------------------------------

const GOVERNANCE_LABELS = {
  band: 'Band society',
  chiefdom: 'Chiefdom',
  theocracy: 'Theocracy',
  kingship: 'Kingship',
  council: 'Council rule',
  merchant: 'Merchant oligarchy',
};

function governanceStability(tribe) {
  const g = tribe.progress.governance;
  const d = tribe.traits.discipline;
  const base = { band: 1.0, chiefdom: 1.01, theocracy: 1.03, kingship: 1.03, council: 1.03, merchant: 1.03 }[g] || 1;
  // A divided polity governs badly.
  return base * (0.97 + 0.06 * d) * (0.94 + 0.06 * (tribe.unity ?? 1));
}

function maxSettlements(tribe) {
  const g = tribe.progress.governance;
  const d = tribe.traits.discipline;
  const base = { band: 1, chiefdom: 3, theocracy: 6, kingship: 7, council: 6, merchant: 7 }[g] || 1;
  return Math.round(base + 2 * d);
}

function updateGovernance(world, tribe, pop, rng, log) {
  const p = tribe.progress;
  tribe.peakPop = Math.max(tribe.peakPop, pop);

  if (p.governance === 'band' && tribeSettlements(world, tribe.id).length > 0) {
    p.governance = 'chiefdom';
    log(`${tribe.name} came under the rule of chiefs.`);
    return;
  }

  if (p.governance === 'chiefdom' && pop > 2500 && p.techs.has('law')) {
    const t = tribe.traits;
    const options = [
      ['theocracy', t.cohesion + t.dogmatism],
      ['kingship', t.aggression + t.cohesion],
      ['council', t.contemplation + (1 - t.dogmatism)],
      ['merchant', t.mercantile + (tribe.tradePartners > 0 ? 0.5 : 0)],
    ];
    options.sort((a, b) => b[1] - a[1]);
    p.governance = options[0][0];
    log(`${tribe.name} established ${GOVERNANCE_LABELS[p.governance].toLowerCase()}.`);
    return;
  }

  // Passionate polities wobble: succession crises and factional strife.
  if (p.governance !== 'band' && p.governance !== 'chiefdom') {
    if (rng.random() < 0.01 * (1 - tribe.traits.discipline) * 2) {
      damageTribe(world, tribe, 0.02, rng);
      nudgeTrait(tribe, 'cohesion', -0.01);
      tribe.weakUntil = world.year + 5; // chaos invites the neighbours
      rollLeader(world, tribe, rng, log, true);
      log(`A succession crisis convulsed ${tribe.name}.`);
    }
  }

  // Collapse: losing half the people at the peak breaks complex rule.
  if (p.governance !== 'band' && p.governance !== 'chiefdom' &&
      pop < tribe.peakPop * 0.5) {
    p.governance = 'chiefdom';
    tribe.peakPop = pop;
    tribe.weakUntil = world.year + 8;
    log(`Order broke down; ${tribe.name} fell back under rival chiefs.`);
  }
}

// --- Unity and civil war -------------------------------------------------------
// Unity is the polity's current condition (state), distinct from cohesion
// (the people's character, a trait). Conquest dilutes unity with
// unabsorbed masses; time rebuilds it — faster for cohesive, disciplined
// peoples. Deeply divided empires can tear themselves apart.

function updateUnity(world, tribe) {
  if (tribe.unity === undefined) tribe.unity = 1;
  const settlements = tribeSettlements(world, tribe.id);

  // Overextension: holding more places than the polity's governance can
  // coordinate grinds unity down, year on year.
  const over = Math.max(0, settlements.length - maxSettlements(tribe));
  if (over > 0) {
    tribe.unity = Math.max(0, tribe.unity - 0.004 * over);
  }

  // Healing is slow — generations, not years — and impossible while the
  // empire is still digesting conquered peoples.
  const digesting = settlements.some((s) =>
    s.assimilatingUntil && world.year < s.assimilatingUntil);
  if (!digesting && over === 0) {
    const recovery = PARAMS.unityRecovery *
      (0.5 + 0.5 * tribe.traits.cohesion) *
      (0.5 + 0.5 * tribe.traits.discipline);
    tribe.unity = Math.min(1, tribe.unity + recovery);
  }
}

function checkCivilWar(world, tribe, rng, log) {
  const settlements = tribeSettlements(world, tribe.id);
  if (settlements.length < 3 || (tribe.unity ?? 1) >= PARAMS.civilWarUnity) return;

  const p = 0.1 * ((PARAMS.civilWarUnity - tribe.unity) / PARAMS.civilWarUnity) *
    (1.5 - tribe.traits.discipline);
  if (rng.random() >= p) return;

  // The empire splits: the breakaway takes roughly half the settlements,
  // preferring the unassimilated conquests and the places farthest from
  // the chief settlement — the periphery goes first.
  const chief = tribeChiefSettlement(world, tribe);
  const candidates = settlements
    .filter((s) => s !== chief)
    .map((s) => {
      const dx = s.x - chief.x;
      const dy = s.y - chief.y;
      const foreign = s.assimilatingUntil && world.year < s.assimilatingUntil ? 1 : 0;
      return { s, score: foreign * 1000 + dx * dx + dy * dy };
    })
    .sort((a, b) => b.score - a.score);

  const takeCount = Math.max(1, Math.floor(settlements.length / 2));
  const splinter = createSplinterTribe(world, tribe, rng);
  const taken = candidates.slice(0, takeCount).map((c) => c.s);
  for (const s of taken) {
    s.tribeId = splinter.id;
    s.assimilatingUntil = undefined; // they follow the rebels willingly
  }
  splinter.rangeCenter = { x: taken[0].x, y: taken[0].y };
  splinter.peakPop = totalTribePop(world, splinter);
  world.networkDirty = true;

  tribe.unity = 0.7; // what remains is the coherent core
  tribe.peakPop = totalTribePop(world, tribe);
  tribe.weakUntil = world.year + 6;

  // Civil war: the halves part in blood, not peace.
  const key = relationKey(tribe.id, splinter.id);
  world.relations[key] = {
    stance: 'war', familiarity: 1.5, grievances: 3, warYears: 0, warScore: 0,
  };
  log(`Civil war! ${splinter.name} broke away from ${tribe.name}, ` +
    `taking ${taken.length} settlement${taken.length > 1 ? 's' : ''}.`);
}

// --- Leaders -----------------------------------------------------------------
// Each tribe is led by someone — abstracted to a single temperament in
// [-0.3, 0.3]: negative leans to peace, positive hungers for war. Leaders
// pass in time (or fall in succession crises), and a change at the top
// can tip a standing rivalry into war, or a war into peace.

function rollLeader(world, tribe, rng, log, forced = false) {
  const due = !tribe.leaderSince ||
    world.year - tribe.leaderSince >= (tribe.leaderTerm || 0);
  if (!due && !forced) return;

  // Temperament centres on the people's own aggression.
  const lean = (tribe.traits.aggression - 0.5) * 0.2;
  tribe.leaderBias = Math.max(-0.3, Math.min(0.3, lean + rng.range(-0.2, 0.2)));
  tribe.leaderSince = world.year;
  tribe.leaderTerm = rng.int(12, 35);

  // Only notable temperaments make the chronicle.
  if (world.year > 0 && tribe.leaderBias > 0.12) {
    log(`A new leader rose among ${tribe.name}, hungry for glory in war.`);
  } else if (world.year > 0 && tribe.leaderBias < -0.12) {
    log(`A new leader rose among ${tribe.name}, minded toward peace.`);
  }
}

// --- Demography: bands -------------------------------------------------------

function updateBands(world, tribe, rng, seasonFactor, log) {
  const { size } = world;
  const bands = tribeBands(world, tribe.id);

  for (const band of bands) {
    // Roam: every few years, drift toward better forage within the range.
    if (world.year - band.lastMove >= 3 && rng.random() < 0.5) {
      let best = null;
      let bestScore = -Infinity;
      for (let attempt = 0; attempt < 8; attempt++) {
        const nx = Math.max(4, Math.min(size - 5, band.x + rng.int(-5, 5)));
        const ny = Math.max(4, Math.min(size - 5, band.y + rng.int(-5, 5)));
        if (isSea(world.terrain[ny * size + nx])) continue;
        let score = sumInRadius(world, world.forageValue, nx, ny, 4);
        // A gentle pull keeps the tribe's bands loosely together.
        const dx = nx - tribe.rangeCenter.x;
        const dy = ny - tribe.rangeCenter.y;
        score -= Math.sqrt(dx * dx + dy * dy) * 0.4;
        if (score > bestScore) { bestScore = score; best = { x: nx, y: ny }; }
      }
      if (best) {
        band.x = best.x;
        band.y = best.y;
        band.lastMove = world.year;
      }
    }

    // Forager demography: very slow growth toward a low wild ceiling —
    // realistic hunter-gatherer rates (~0.1-0.3 %/yr).
    const cap = bandCapacity(world, band) * seasonFactor;
    const r = PARAMS.foragerGrowth * varianceRoll(rng, tribe.traits);
    band.pop = Math.max(0, band.pop + r * band.pop * (1 - band.pop / cap));

    if (band.pop > 100) {
      const migrants = band.pop * 0.45;
      band.pop -= migrants;
      const nx = Math.max(4, Math.min(size - 5, band.x + rng.int(-6, 6)));
      const ny = Math.max(4, Math.min(size - 5, band.y + rng.int(-6, 6)));
      createBand(world, nx, ny, migrants, tribe.id);
    }
  }

  // Merge or lose failing bands.
  const survivors = [];
  for (const band of tribeBands(world, tribe.id)) {
    if (band.pop >= 12) { survivors.push(band); continue; }
    const nearest = survivors[0] || null;
    if (nearest) nearest.pop += band.pop;
    world.bands = world.bands.filter((b) => b !== band);
  }
}

// --- Demography: settlements --------------------------------------------------

function updateSettlements(world, tribe, rng, seasonFactor, log) {
  const settlements = tribeSettlements(world, tribe.id);
  const stability = governanceStability(tribe);
  let tribeFactor = 1;
  // Tribute drains the payer.
  if (tribe.tributeTo !== undefined && world.year < tribe.tributeUntil) {
    tribeFactor *= 0.94;
  }
  // A disunited people work against each other.
  tribeFactor *= 0.8 + 0.2 * (tribe.unity ?? 1);

  for (const s of settlements) {
    // The economy of the place: trade and market income speed growth,
    // and imports let route towns and mine towns outgrow their fields.
    const pros = settlementProsperity(world, s);
    const cap = Math.max(20,
      settlementCapacity(world, s, tribe) * seasonFactor * pros.capBoost);
    let r = PARAMS.farmerGrowth * stability * tribeFactor * pros.growth *
      varianceRoll(rng, tribe.traits);
    if (s.assimilatingUntil) {
      if (world.year < s.assimilatingUntil) {
        r *= 0.4;
      } else {
        // The conquered have become one people with their conquerors.
        s.assimilatingUntil = undefined;
        tribe.unity = Math.min(1, (tribe.unity ?? 1) + 0.05);
      }
    }
    s.pop = Math.max(0, s.pop + r * s.pop * (1 - s.pop / cap));
  }

  // Daughter settlements: crowded places seed new ones, within what the
  // tribe's governance can coordinate. Crowding is judged against what
  // the local land yields — trade-fed booms spill people outward rather
  // than piling ever higher.
  if (settlements.length < maxSettlements(tribe)) {
    for (const s of settlements) {
      const landCap = settlementCapacity(world, s, tribe);
      if (s.pop < PARAMS.settlementSplitPop ||
          s.pop < landCap * PARAMS.splitCapFraction) continue;
      const site = findDaughterSite(world, s, rng);
      if (!site) continue;
      const migrants = Math.round(s.pop * 0.3);
      s.pop -= migrants;
      const daughter = createSettlement(world, rng, site.x, site.y, migrants, tribe.id);
      log(`${tribe.name} founded ${daughter.name} as ${s.name} grew crowded.`);
      break;
    }
  }

  // Abandonment.
  for (const s of [...tribeSettlements(world, tribe.id)]) {
    if (s.pop >= 15) continue;
    world.settlements = world.settlements.filter((x) => x !== s);
    world.networkDirty = true;
    log(`${s.name} was abandoned as its people dwindled.`);
  }
}

function findDaughterSite(world, parent, rng) {
  const { size } = world;
  const MIN_DIST = 7;
  let best = null;
  let bestScore = 4;

  for (let attempt = 0; attempt < 90; attempt++) {
    const angle = rng.range(0, Math.PI * 2);
    const dist = rng.range(6, 18);
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

// --- The year -------------------------------------------------------------

function simulateYears(world, years = 10) {
  if (!world.tribes) foundTribes(world);
  for (let k = 0; k < years; k++) {
    simulateYear(world);
  }
}

function simulateYear(world) {
  world.year++;
  const year = world.year;
  const rng = new RNG(world.seed + ':year:' + year);
  const log = (text) => world.events.push({ year, text });

  // Island-wide season quality for the year.
  const seasonRoll = rng.random();
  let harsh = false;
  let seasonFactor = 1;
  if (seasonRoll < PARAMS.harshWinterChance) {
    harsh = true;
    log('A harsh winter gripped the island; food ran short everywhere.');
  } else if (seasonRoll > 1 - PARAMS.mildYearChance) {
    seasonFactor = 1.2;
    log('A mild year with rich harvests of forage and game.');
  }

  // The trade network: recomputed periodically, and soon (coalesced, not
  // instantly) after the world changes shape — new/lost settlements,
  // boats, roads, conquest.
  const sinceNetwork = year - (world.lastNetworkYear || 0);
  if (world.settlements.length > 0 &&
      (!world.routes || (world.networkDirty && sinceNetwork >= 2) ||
        sinceNetwork >= PARAMS.networkInterval)) {
    updateTradeNetwork(world);
    computeSettlementIncome(world);
    world.networkDirty = false;
    world.lastNetworkYear = year;
  }
  // Mines are worked every year (also refreshes mine income).
  updateExtraction(world, log);

  // Snapshot: a civil war can add a splinter tribe mid-year; it begins
  // living its own years from the next tick.
  for (const tribe of [...world.tribes]) {
    if (!tribe.alive) continue;
    const tribeRng = rng.fork('tribe:' + tribe.id);

    // Harsh winters hit harder without stores; pottery softens the blow.
    let tribeSeason = seasonFactor;
    if (harsh) {
      tribeSeason = Math.min(1, PARAMS.harshWinterFactor +
        (tribe.progress.techs.has('pottery') ? 0.1 : 0));
      nudgeTrait(tribe, 'cohesion', 0.002); // hardship binds
    }

    const pop = totalTribePop(world, tribe);

    // Knowledge: pools, stages, discovery.
    const events = updateKnowledge(world, tribe, pop, tribeRng.fork('knowledge'), tribeSeason);
    for (const e of events) log(e);

    // Agriculture ends the wandering.
    if (tribe.progress.techs.has('agriculture') && tribeIsNomadic(world, tribe)) {
      const home = settleTribe(world, tribe, tribeRng.fork('settle'));
      if (home) log(`${tribe.name} settled at ${home.name} — their wandering ended.`);
    }

    // Sedentary foragers: an exceptional fishing ground can hold a
    // proto-village before farming.
    if (tribeIsNomadic(world, tribe) && tribe.progress.techs.has('fishing') &&
        !tribe.triedProtoVillage) {
      const bands = tribeBands(world, tribe.id);
      const rich = bands.find((b) =>
        countResourceNear(world, b.x, b.y, 'fish', 3) >= 4);
      if (rich) {
        tribe.triedProtoVillage = true;
        const home = settleTribe(world, tribe, tribeRng.fork('proto'), { proto: true });
        if (home) log(`${tribe.name} settled at ${home.name}, living from the rich waters.`);
      }
    }

    // Demography.
    if (tribeIsNomadic(world, tribe)) {
      updateBands(world, tribe, tribeRng.fork('bands'), tribeSeason, log);
    } else {
      updateSettlements(world, tribe, tribeRng.fork('towns'), tribeSeason, log);
      buildRoads(world, tribe, log);
    }

    // Society.
    rollLeader(world, tribe, tribeRng.fork('leader'), log);
    updateGovernance(world, tribe, totalTribePop(world, tribe), tribeRng.fork('gov'), log);
    updateUnity(world, tribe);
    checkCivilWar(world, tribe, tribeRng.fork('civil'), log);
    driftTraits(tribe, tribeRng.fork('drift'));

    // Tribute runs out.
    if (tribe.tributeTo !== undefined && tribe.tributeUntil <= world.year) {
      tribe.tributeTo = undefined;
    }

    checkTribeDeath(world, tribe, log);
  }

  // The map layer everything else reads.
  computeInfluence(world);
  computeResourceAccess(world);

  // Where peoples meet: contact, trade, rivalry, war, conquest.
  updateRelations(world, rng.fork('relations'), log);

  // Ideas travel with contact.
  for (const e of diffuseTechs(world, rng.fork('diffusion'))) log(e);

  for (const tribe of world.tribes) checkTribeDeath(world, tribe, log);
}

function countResourceNear(world, cx, cy, resourceId, r) {
  const { size } = world;
  let n = 0;
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      const x = cx + dx;
      const y = cy + dy;
      if (x < 0 || y < 0 || x >= size || y >= size) continue;
      const res = world.resources[y * size + x];
      if (res && res.id === resourceId) n++;
    }
  }
  return n;
}

// --- Influence ---------------------------------------------------------------
// Influence flows from PLACES (settlements) and PRESENCES (bands), but
// accrues to the SOCIAL entity — the tribe they answer to. Bands project
// only a faint, drifting presence; settled peoples hold ground.

function computeInfluence(world) {
  const { size, terrain } = world;
  const owner = new Int16Array(size * size).fill(-1);
  const strength = new Float32Array(size * size);
  if (!world.tribes) {
    world.influenceOwner = owner;
    world.influenceStrength = strength;
    return;
  }

  const tribeStrength = new Float32Array(size * size); // reused per tribe

  for (const tribe of world.tribes) {
    if (!tribe.alive) continue;
    tribeStrength.fill(0);

    const stamp = (x, y, pop, reach, weight) => {
      const ri = Math.ceil(reach);
      for (let dy = -ri; dy <= ri; dy++) {
        for (let dx = -ri; dx <= ri; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
          const d = Math.sqrt(dx * dx + dy * dy);
          if (d > reach) continue;
          const ni = ny * size + nx;
          if (isSea(terrain[ni])) continue;
          tribeStrength[ni] += pop * weight * (1 - d / reach);
        }
      }
    };

    for (const s of tribeSettlements(world, tribe.id)) {
      stamp(s.x, s.y, s.pop, gatherRadius(s.pop) * 2.2, 1);
    }
    for (const band of tribeBands(world, tribe.id)) {
      stamp(band.x, band.y, band.pop, 6, 0.4);
    }

    for (let i = 0; i < size * size; i++) {
      const v = tribeStrength[i];
      if (v > 0 && v > strength[i]) {
        strength[i] = v;
        owner[i] = tribe.id;
      }
    }
  }

  // Normalise strength into a display alpha. Log scale: settlements grow
  // to thousands, bands stay at dozens, and both should read on the map.
  for (let i = 0; i < size * size; i++) {
    if (owner[i] >= 0) {
      strength[i] = Math.min(1, Math.log10(1 + strength[i]) / 3.2);
    }
  }

  world.influenceOwner = owner;
  world.influenceStrength = strength;

  for (const tribe of world.tribes) tribe.territoryTiles = 0;
  for (let i = 0; i < size * size; i++) {
    if (owner[i] >= 0) {
      const tribe = world.tribes[owner[i]];
      if (tribe) tribe.territoryTiles++;
    }
  }
}