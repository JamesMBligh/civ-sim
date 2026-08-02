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
  return d - 0.1 * rel.grievances;
}

function warDesire(world, a, b, rel) {
  let d = 0.5 * (a.traits.aggression + b.traits.aggression)
    + 0.3 * (a.traits.cohesion + b.traits.cohesion) / 2
    + 0.12 * rel.grievances
    - 0.25 * Math.min(1, rel.familiarity);
  // Resource envy: a martial people locked out of the metals.
  for (const [x, y] of [[a, b], [b, a]]) {
    const envy = ['tin', 'copper', 'iron'].some((r) =>
      !x.resourceAccess.has(r) && y.resourceAccess.has(r));
    if (envy && computePosture(x.traits).military > 0.38) d += 0.2;
  }
  return d;
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

function defensiveBonus(tribe) {
  return tribe.progress.techs.has('fortifications')
    ? 1.2 + 0.3 * tribe.traits.discipline : 1;
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
    rel.familiarity = Math.min(2, rel.familiarity +
      (rel.stance === 'trade' ? 0.04 : rel.stance === 'war' ? 0.01 : 0.02));
    rel.grievances = Math.max(0, rel.grievances - 0.02); // old wounds fade

    const td = tradeDesire(world, a, b, rel);
    const wd = warDesire(world, a, b, rel);

    switch (rel.stance) {
      case 'contact':
        if (td > 0.75 && pairRng.random() < 0.25) {
          rel.stance = 'trade';
          log(`${a.name} and ${b.name} began to trade.`);
        } else if (wd > 0.7 && pairRng.random() < 0.15) {
          rel.stance = 'rivalry';
          log(`Rivalry hardened between ${a.name} and ${b.name}.`);
        }
        break;

      case 'trade':
        if (wd > 0.95 && pairRng.random() < 0.1) {
          rel.stance = 'rivalry';
          rel.grievances += 1;
          log(`Trade between ${a.name} and ${b.name} broke down amid disputes.`);
        } else if (td < 0.45) {
          rel.stance = 'contact';
        }
        break;

      case 'rivalry':
        if (wd > 0.85 && pairRng.random() < 0.12) {
          rel.stance = 'war';
          rel.warYears = 0;
          log(`War broke out between ${a.name} and ${b.name}.`);
        } else if (td > 0.85 && pairRng.random() < 0.1) {
          rel.stance = 'trade';
          log(`Old rivals ${a.name} and ${b.name} set enmity aside to trade.`);
        }
        break;

      case 'war': {
        rel.warYears++;
        resolveWarYear(world, a, b, rel, pairRng, log);
        if (!a.alive || !b.alive) break;
        const exhaustion = 0.08 + 0.05 * rel.warYears;
        if (pairRng.random() < exhaustion) {
          rel.stance = 'rivalry';
          log(`${a.name} and ${b.name} made an exhausted peace.`);
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

function resolveWarYear(world, a, b, rel, rng, log) {
  const sa = militaryStrength(world, a, rng);
  const sb = militaryStrength(world, b, rng);
  const [winner, loser, sw, sl] = sa >= sb ? [a, b, sa, sb] : [b, a, sb, sa];
  const ratio = Math.min(3, sw / Math.max(0.01, sl * defensiveBonus(loser)));

  // Raid damage falls on the loser's people.
  const lossRate = 0.01 * ratio;
  damageTribe(world, loser, lossRate, rng);
  rel.grievances = Math.min(5, rel.grievances + 0.5);

  if (rel.warYears === 1 || rng.random() < 0.25) {
    log(`${winner.name} raided ${loser.name} and carried off spoils.`);
  }

  // Conquest: a sustained, decisive edge flips a settlement's allegiance
  // — the place and its people endure; only the banner changes.
  const loserSettlements = tribeSettlements(world, loser.id);
  if (rel.warYears >= 3 && ratio > 1.6 &&
      winner.progress.techs.has('warriors') && loserSettlements.length > 0 &&
      rng.random() < 0.35) {
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
