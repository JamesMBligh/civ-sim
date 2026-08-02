// Inter-tribe relations: where traits meet. Each pair of tribes in
// contact carries a small state machine — contact, trade, rivalry, war —
// driven by both sides' dispositions and by what each side has that the
// other lacks. See design/tribe-evolution.md §6.

function relationKey(a, b) {
  return a < b ? `${a}-${b}` : `${b}-${a}`;
}

function getRelation(world, a, b) {
  return (world.relations || {})[relationKey(a, b)] || null;
}

// Contact begins when peoples actually meet: influence borders touch, or
// nomadic bands wander near another tribe's people.
function detectContacts(world, log) {
  const { size } = world;
  const owner = world.influenceOwner;
  world.relations = world.relations || {};

  const borderCount = new Map();
  if (owner) {
    for (let y = 1; y < size - 1; y++) {
      for (let x = 1; x < size - 1; x++) {
        const a = owner[y * size + x];
        if (a < 0) continue;
        for (const b of [owner[y * size + x + 1], owner[(y + 1) * size + x]]) {
          if (b >= 0 && b !== a) {
            const key = relationKey(a, b);
            borderCount.set(key, (borderCount.get(key) || 0) + 1);
          }
        }
      }
    }
  }

  const near = (x1, y1, x2, y2, d) => {
    const dx = x1 - x2;
    const dy = y1 - y2;
    return dx * dx + dy * dy <= d * d;
  };

  // Band proximity: to other bands and to settlements.
  const bands = world.bands || [];
  const pairsMet = new Set([...borderCount.keys()]);
  for (let i = 0; i < bands.length; i++) {
    for (let j = i + 1; j < bands.length; j++) {
      if (bands[i].tribeId !== bands[j].tribeId &&
          near(bands[i].x, bands[i].y, bands[j].x, bands[j].y, 9)) {
        pairsMet.add(relationKey(bands[i].tribeId, bands[j].tribeId));
      }
    }
    for (const s of world.settlements || []) {
      if (s.tribeId !== bands[i].tribeId &&
          near(bands[i].x, bands[i].y, s.x, s.y, 9)) {
        pairsMet.add(relationKey(bands[i].tribeId, s.tribeId));
      }
    }
  }

  for (const key of pairsMet) {
    if (!world.relations[key]) {
      const [a, b] = key.split('-').map(Number);
      const ta = world.tribes[a];
      const tb = world.tribes[b];
      if (!ta || !tb || !ta.alive || !tb.alive) continue;
      world.relations[key] = {
        stance: 'contact', familiarity: 0, grievances: 0, warYears: 0,
      };
      log(`${ta.name} and ${tb.name} met for the first time.`);
    }
  }
}

// The two appetites a pair of peoples can have for each other.
function tradeDesire(world, a, b, rel) {
  let d = 0.5 * (a.traits.mercantile + b.traits.mercantile)
    + 0.25 * (1 - (a.traits.cohesion + b.traits.cohesion) / 2)
    + 0.2 * (1 - (a.traits.dogmatism + b.traits.dogmatism) / 2)
    + 0.15 * Math.min(1, rel.familiarity);
  // Complementary resources — one side holds what the other needs.
  for (const [x, y] of [[a, b], [b, a]]) {
    const wants = ['tin', 'copper', 'iron'].some((r) =>
      !x.resourceAccess.has(r) && y.resourceAccess.has(r));
    if (wants) d += 0.15;
  }
  // Belligerent leaders sour commerce; conciliatory ones court it.
  d -= 0.3 * Math.max(0, (a.leaderBias || 0) + (b.leaderBias || 0));
  return d - 0.1 * rel.grievances;
}

// War appetite is directional: what X wants against Y. Strength preys on
// weakness (opportunism), leaders tilt the scales, and a neighbour's
// moment of internal chaos is an invitation. Familiarity soothes, but
// only so much — old neighbours can still come to blows.
function directionalWarDesire(world, x, y, rel) {
  let d = 0.45 * x.traits.aggression
    + 0.2 * x.traits.cohesion
    + 0.1 * rel.grievances
    - 0.12 * Math.min(1, rel.familiarity)
    + (x.leaderBias || 0);

  // Opportunism: dominant tribes pressure weaker neighbours.
  const px = totalTribePop(world, x);
  const py = Math.max(1, totalTribePop(world, y));
  const powerRatio = px / py;
  if (powerRatio > 1.4) d += Math.min(0.3, 0.12 * (powerRatio - 1.4));

  // Weakness invites attack: crises leave a window of vulnerability.
  if (y.weakUntil && world.year < y.weakUntil) d += 0.2;

  // Resource envy: a martial people locked out of the metals.
  const envy = ['tin', 'copper', 'iron'].some((r) =>
    !x.resourceAccess.has(r) && y.resourceAccess.has(r));
  if (envy && computePosture(x.traits).military > 0.36) d += 0.2;

  return d;
}

function warDesire(world, a, b, rel) {
  return Math.max(
    directionalWarDesire(world, a, b, rel),
    directionalWarDesire(world, b, a, rel));
}

// Military strength for a raid/battle roll. Discipline helps organised
// war (professional warriors); its absence fuels shock raiding.
function militaryStrength(world, tribe, rng) {
  const pop = totalTribePop(world, tribe);
  const posture = computePosture(tribe.traits);
  const t = tribe.progress.techs;
  let techMult = 1;
  if (t.has('bronze_working')) techMult *= 1.3;
  if (t.has('iron_working')) techMult *= 1.35;
  if (t.has('raiding')) techMult *= 1.15;
  if (t.has('warriors')) techMult *= 1.25;
  const style = t.has('warriors')
    ? 0.7 + 0.6 * tribe.traits.discipline        // organised warfare
    : 1 + 0.35 * (1 - tribe.traits.discipline);  // shock raiding
  return Math.sqrt(pop) * (0.5 + posture.military) * techMult * style *
    varianceRoll(rng, tribe.traits);
}

function defensiveBonus(world, tribe) {
  let bonus = tribe.progress.techs.has('fortifications')
    ? 1.2 + 0.3 * tribe.traits.discipline : 1;
  // A people defending their last town fight with their backs to it.
  if (tribeSettlements(world, tribe.id).length === 1) bonus *= 1.35;
  return bonus;
}

// Yearly relations pass: stance transitions, trade effects, war damage,
// conquest. Runs after influence + resource access are fresh.
function updateRelations(world, rng, log) {
  detectContacts(world, log);

  for (const tribe of world.tribes) tribe.tradePartners = 0;

  for (const [key, rel] of Object.entries(world.relations)) {
    const [aId, bId] = key.split('-').map(Number);
    const a = world.tribes[aId];
    const b = world.tribes[bId];
    if (!a || !b || !a.alive || !b.alive) continue;

    const pairRng = rng.fork(`rel:${key}`);
    // Familiarity grows through peaceful contact and erodes in hostility.
    rel.familiarity = Math.max(0, Math.min(2, rel.familiarity +
      (rel.stance === 'trade' ? 0.04
        : rel.stance === 'contact' ? 0.02 : -0.01)));
    rel.grievances = Math.max(0, rel.grievances - 0.01); // old wounds fade slowly

    // Diplomatic incidents: chance sparks that history turns on.
    diplomaticEvent(world, a, b, rel, pairRng, log);

    const td = tradeDesire(world, a, b, rel);
    const wd = warDesire(world, a, b, rel);

    switch (rel.stance) {
      case 'contact':
        if (td > 0.75 && pairRng.random() < 0.25) {
          rel.stance = 'trade';
          log(`${a.name} and ${b.name} began to trade.`);
        } else if (wd > 0.65 && pairRng.random() < 0.15) {
          rel.stance = 'rivalry';
          log(`Rivalry hardened between ${a.name} and ${b.name}.`);
        }
        break;

      case 'trade':
        if (wd > 0.9 && pairRng.random() < 0.1) {
          rel.stance = 'rivalry';
          rel.grievances += 1;
          log(`Trade between ${a.name} and ${b.name} broke down amid disputes.`);
        } else if (td < 0.45) {
          rel.stance = 'contact';
        }
        break;

      case 'rivalry':
        if (wd > 0.75 && pairRng.random() < 0.15 &&
            !(rel.truceUntil && world.year < rel.truceUntil)) {
          startWar(world, a, b, rel, log);
        } else if (td > 0.85 && pairRng.random() < 0.1) {
          rel.stance = 'trade';
          log(`Old rivals ${a.name} and ${b.name} set enmity aside to trade.`);
        }
        break;

      case 'war': {
        rel.warYears++;
        resolveWarYear(world, a, b, rel, pairRng, log);
        if (!a.alive || !b.alive) break;
        // Peace comes from exhaustion — sooner when a conciliatory
        // leader holds either side.
        let exhaustion = 0.08 + 0.05 * rel.warYears;
        if ((a.leaderBias || 0) < -0.1 || (b.leaderBias || 0) < -0.1) {
          exhaustion += 0.1;
        }
        if (pairRng.random() < exhaustion) {
          makePeace(world, a, b, rel, pairRng, log);
        }
        break;
      }
    }

    if (rel.stance === 'trade') {
      a.tradePartners++;
      b.tradePartners++;
      // Sustained exchange erodes closed-mindedness.
      nudgeTrait(a, 'dogmatism', -0.002);
      nudgeTrait(b, 'dogmatism', -0.002);
    }
    if (rel.stance === 'war') {
      for (const t of [a, b]) {
        nudgeTrait(t, 'aggression', 0.004);
        nudgeTrait(t, 'cohesion', 0.004);
      }
    }
  }
}

function startWar(world, a, b, rel, log, cause) {
  rel.stance = 'war';
  rel.warYears = 0;
  rel.warScore = 0; // positive: a is winning; negative: b
  log(cause || `War broke out between ${a.name} and ${b.name}.`);
}

// Can this tribe actually take and hold a town? Professional warriors, or
// raw raiding backed by a full era's edge in metal.
function canConquer(winner, loser) {
  const t = winner.progress.techs;
  if (t.has('warriors')) return true;
  const eraEdge = ERAS.indexOf(tribeEra(winner)) - ERAS.indexOf(tribeEra(loser));
  return t.has('raiding') && eraEdge >= 1;
}

function resolveWarYear(world, a, b, rel, rng, log) {
  const sa = militaryStrength(world, a, rng);
  const sb = militaryStrength(world, b, rng);
  const [winner, loser, sw, sl] = sa >= sb ? [a, b, sa, sb] : [b, a, sb, sa];
  const ratio = Math.min(3, sw / Math.max(0.01, sl * defensiveBonus(world, loser)));

  // Raid damage falls on the loser's people, and the year's outcome
  // accumulates into the war score that peace terms are settled by.
  const lossRate = 0.01 * ratio;
  damageTribe(world, loser, lossRate, rng);
  rel.grievances = Math.min(5, rel.grievances + 0.7);
  rel.warScore = (rel.warScore || 0) + (winner === a ? 1 : -1) * (ratio - 1);

  if (rel.warYears === 1 || rng.random() < 0.25) {
    log(`${winner.name} raided ${loser.name} and carried off spoils.`);
  }

  // Conquest: a decisive edge flips a settlement's allegiance — the place
  // and its people endure; only the banner changes. The stronger the
  // edge, the likelier the fall.
  const loserSettlements = tribeSettlements(world, loser.id);
  if (rel.warYears >= 2 && ratio > 1.4 && canConquer(winner, loser) &&
      loserSettlements.length > 0 && rng.random() < 0.15 * ratio) {
    conquerSettlement(world, winner, loser, rel, log);
  }
}

function conquerSettlement(world, winner, loser, rel, log) {
  const loserSettlements = tribeSettlements(world, loser.id);
  if (loserSettlements.length === 0) return;
  const centre = tribeCentroid(world, winner);
  let target = loserSettlements[0];
  let bestD = Infinity;
  for (const s of loserSettlements) {
    const d = (s.x - centre.x) ** 2 + (s.y - centre.y) ** 2;
    if (d < bestD) { bestD = d; target = s; }
  }
  target.tribeId = winner.id;
  target.assimilatingUntil = world.year + Math.round(20 + 40 * loser.traits.cohesion);
  log(`${winner.name} conquered ${target.name}; its people now answer to new masters.`);
  rel.grievances = Math.min(5, rel.grievances + 2);
  checkTribeDeath(world, loser, log);
}

// Peace is settled on the war score: a drawn war ends in weary rivalry, a
// clearly lost one costs land or tribute.
function makePeace(world, a, b, rel, rng, log) {
  rel.stance = 'rivalry';
  // A truce holds for a generation's better part — no immediate re-war.
  rel.truceUntil = world.year + rng.int(8, 20);
  const score = rel.warScore || 0;
  const [winner, loser] = score >= 0 ? [a, b] : [b, a];
  const magnitude = Math.abs(score);

  if (magnitude > 2.5 && tribeSettlements(world, loser.id).length > 0 &&
      canConquer(winner, loser)) {
    log(`${a.name} and ${b.name} made peace — dictated by ${winner.name}.`);
    conquerSettlement(world, winner, loser, rel, log);
  } else if (magnitude > 1.2) {
    loser.tributeTo = winner.id;
    loser.tributeUntil = world.year + 20;
    log(`${a.name} and ${b.name} made peace; ${loser.name} must pay tribute to ${winner.name}.`);
  } else {
    log(`${a.name} and ${b.name} made an exhausted peace.`);
  }
  rel.warScore = 0;
}

// --- Diplomatic incidents ---------------------------------------------------
// Small sparks that history turns on: an insult at a gathering, murdered
// envoys, a marriage feast. Their likelihood follows the two peoples'
// tempers; their consequences run through grievances and familiarity.

const INCIDENT_TEXTS = [
  (a, b) => `An envoy of ${a.name} was humiliated at ${b.name}'s fires; the insult was not forgotten.`,
  (a, b) => `Hunters of ${a.name} were found slain on ${b.name}'s ground.`,
  (a, b) => `A dispute over grazing lands flared between ${a.name} and ${b.name}.`,
  (a, b) => `${b.name} seized goods from traders of ${a.name}, calling it toll.`,
];

const GOODWILL_TEXTS = [
  (a, b) => `${a.name} and ${b.name} sealed friendship with a marriage between leading families.`,
  (a, b) => `Envoys of ${a.name} brought rich gifts to ${b.name}.`,
  (a, b) => `${a.name} and ${b.name} feasted together at the season's turning.`,
];

function diplomaticEvent(world, a, b, rel, rng, log) {
  if (rel.stance === 'war') return;
  const avgAggression = (a.traits.aggression + b.traits.aggression) / 2;
  const avgDiscipline = (a.traits.discipline + b.traits.discipline) / 2;
  const avgMercantile = (a.traits.mercantile + b.traits.mercantile) / 2;
  const avgContemplation = (a.traits.contemplation + b.traits.contemplation) / 2;

  // Hot tempers and low discipline breed incidents; traders and
  // philosophers breed goodwill.
  const pIncident = 0.005 + 0.012 * avgAggression + 0.008 * (1 - avgDiscipline);
  const pGoodwill = 0.005 + 0.012 * avgMercantile + 0.006 * avgContemplation;

  const roll = rng.random();
  if (roll < pIncident) {
    rel.grievances = Math.min(5, rel.grievances + 1);
    const text = rng.pick(INCIDENT_TEXTS)(a, b);
    log(text);
    // An insult can be the spark that sets smouldering rivals alight.
    if (rel.stance === 'rivalry' &&
        !(rel.truceUntil && world.year < rel.truceUntil) &&
        warDesire(world, a, b, rel) > 0.7 && rng.random() < 0.35) {
      startWar(world, a, b, rel, log,
        `The offence set ${a.name} and ${b.name} at war.`);
    } else if (rel.stance === 'trade' && rng.random() < 0.25) {
      rel.stance = 'contact';
      log(`Trade between ${a.name} and ${b.name} withered after the offence.`);
    }
  } else if (roll < pIncident + pGoodwill) {
    rel.grievances = Math.max(0, rel.grievances - 1);
    rel.familiarity = Math.min(2, rel.familiarity + 0.15);
    log(rng.pick(GOODWILL_TEXTS)(a, b));
  }
}

function damageTribe(world, tribe, rate, rng) {
  for (const s of tribeSettlements(world, tribe.id)) {
    s.pop *= 1 - rate * rng.range(0.6, 1.4);
  }
  for (const band of world.bands || []) {
    if (band.tribeId === tribe.id) band.pop *= 1 - rate * rng.range(0.6, 1.4);
  }
}

function tribeCentroid(world, tribe) {
  let x = 0;
  let y = 0;
  let n = 0;
  for (const s of tribeSettlements(world, tribe.id)) { x += s.x; y += s.y; n++; }
  for (const band of world.bands || []) {
    if (band.tribeId === tribe.id) { x += band.x; y += band.y; n++; }
  }
  return n ? { x: x / n, y: y / n } : tribe.rangeCenter;
}

function totalTribePop(world, tribe) {
  let sum = tribePopulation(world, tribe);
  for (const band of world.bands || []) {
    if (band.tribeId === tribe.id) sum += band.pop;
  }
  return sum;
}

function checkTribeDeath(world, tribe, log) {
  if (!tribe.alive) return;
  const hasSettlement = world.settlements.some((s) => s.tribeId === tribe.id);
  const hasBand = (world.bands || []).some((b) => b.tribeId === tribe.id);
  if (!hasSettlement && !hasBand) {
    tribe.alive = false;
    log(`${tribe.name} died out.`);
  }
}
