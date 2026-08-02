// Technology, eras, and the knowledge pools. Progress is attainment —
// what a people has achieved — and is driven by traits + geography.
// See design/tribe-evolution.md §4.

// Era is derived from technologies held, never stored.
const ERAS = ['paleolithic', 'neolithic', 'chalcolithic', 'bronze', 'iron'];
const ERA_LABELS = {
  paleolithic: 'Paleolithic',
  neolithic: 'Neolithic',
  chalcolithic: 'Chalcolithic',
  bronze: 'Bronze Age',
  iron: 'Iron Age',
};
const ERA_COLORS = {
  paleolithic: '#8a7f6a',
  neolithic: '#6aa84f',
  chalcolithic: '#2fa198',
  bronze: '#d08a2e',
  iron: '#7f95b5',
};

// The tree is small, hand-authored, and heavily resource-gated: what a
// people can become depends on what their ground (or their trading
// partners' ground) holds. category weights the choice of research
// target by the tribe's posture.
const TECHS = {
  fishing: { name: 'Fishing', cost: 40, category: 'subsistence', prereqs: [], needsResources: ['fish'] },
  boats: { name: 'Boats', cost: 90, category: 'trade', prereqs: ['fishing'] },
  agriculture: { name: 'Agriculture', cost: 120, category: 'subsistence', prereqs: [], needsResources: ['fertile'] },
  irrigation: { name: 'Irrigation', cost: 160, category: 'subsistence', prereqs: ['agriculture'] },
  husbandry: { name: 'Animal Husbandry', cost: 130, category: 'subsistence', prereqs: ['agriculture'], needsResources: ['game'] },
  pottery: { name: 'Pottery', cost: 90, category: 'learning', prereqs: [], needsResources: ['clay'] },
  copper_working: { name: 'Copper Working', cost: 180, category: 'learning', prereqs: ['pottery'], needsResources: ['copper'] },
  bronze_working: { name: 'Bronze Working', cost: 260, category: 'learning', prereqs: ['copper_working'], needsResources: ['copper', 'tin'] },
  iron_working: { name: 'Iron Working', cost: 420, category: 'learning', prereqs: ['bronze_working'], needsResources: ['iron'] },
  writing: { name: 'Writing', cost: 240, category: 'learning', prereqs: ['pottery'], needsPhilStage: 2 },
  law: { name: 'Law', cost: 280, category: 'learning', prereqs: ['writing'] },
  masonry: { name: 'Masonry', cost: 200, category: 'learning', prereqs: [], needsResources: ['stone'] },
  barter: { name: 'Barter Custom', cost: 60, category: 'trade', prereqs: [] },
  trade_routes: { name: 'Trade Routes', cost: 190, category: 'trade', prereqs: ['barter'] },
  currency: { name: 'Currency', cost: 380, category: 'trade', prereqs: ['trade_routes', 'bronze_working'] },
  raiding: { name: 'Organised Raiding', cost: 70, category: 'military', prereqs: [] },
  warriors: { name: 'Professional Warriors', cost: 240, category: 'military', prereqs: ['raiding'] },
  fortifications: { name: 'Fortifications', cost: 320, category: 'military', prereqs: ['masonry', 'warriors'] },
  bridges: { name: 'Bridges', cost: 240, category: 'trade', prereqs: ['masonry'] },
  roads: { name: 'Roads', cost: 300, category: 'trade', prereqs: ['masonry'] },
  deep_mining: { name: 'Deep Mining', cost: 380, category: 'learning', prereqs: ['iron_working'] },
};

// Techs that reshape the movement-cost surface or resource reach: their
// discovery forces a trade-network rebuild.
const NETWORK_TECHS = new Set(['fishing', 'boats', 'roads', 'bridges', 'deep_mining']);

function tribeEra(tribe) {
  const t = tribe.progress.techs;
  if (t.has('iron_working')) return 'iron';
  if (t.has('bronze_working')) return 'bronze';
  if (t.has('copper_working')) return 'chalcolithic';
  if (t.has('agriculture')) return 'neolithic';
  return 'paleolithic';
}

// Dogmatism makes every idea more expensive to accept.
function effectiveCost(tech, traits) {
  return tech.cost * (0.6 + 0.8 * traits.dogmatism);
}

// Which resources a tribe can draw on: anything inside its influence,
// near its bands, or held by a trade partner (one hop).
function computeResourceAccess(world) {
  const { size } = world;
  const owner = world.influenceOwner;
  for (const tribe of world.tribes) tribe.resourceAccess = new Set();

  if (owner) {
    for (let i = 0; i < size * size; i++) {
      const res = world.resources[i];
      if (!res || owner[i] < 0) continue;
      const tribe = world.tribes[owner[i]];
      if (!tribe || !tribe.alive) continue;
      // A worked-out deposit grants nothing until deep mining reopens it.
      if (world.depositSurface && !depositActive(world, i, tribe)) continue;
      tribe.resourceAccess.add(res.id);
    }
  }

  // Nomads reach whatever lies around their bands.
  const REACH = 5;
  for (const band of world.bands || []) {
    const tribe = world.tribes[band.tribeId];
    if (!tribe || !tribe.alive) continue;
    for (let dy = -REACH; dy <= REACH; dy++) {
      for (let dx = -REACH; dx <= REACH; dx++) {
        const nx = band.x + dx;
        const ny = band.y + dy;
        if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
        const ni = ny * size + nx;
        const res = world.resources[ni];
        if (!res) continue;
        if (world.depositSurface && !depositActive(world, ni, tribe)) continue;
        tribe.resourceAccess.add(res.id);
      }
    }
  }

  // Trade shares access (one hop, applied simultaneously).
  const shared = world.tribes.map((t) => new Set(t.resourceAccess));
  for (const [key, rel] of Object.entries(world.relations || {})) {
    if (rel.stance !== 'trade') continue;
    const [a, b] = key.split('-').map(Number);
    const ta = world.tribes[a];
    const tb = world.tribes[b];
    if (!ta || !tb || !ta.alive || !tb.alive) continue;
    for (const r of shared[a]) tb.resourceAccess.add(r);
    for (const r of shared[b]) ta.resourceAccess.add(r);
  }
}

function techAvailable(world, tribe, id) {
  const tech = TECHS[id];
  const p = tribe.progress;
  if (p.techs.has(id)) return false;
  if (tech.prereqs.some((pre) => !p.techs.has(pre))) return false;
  if (tech.needsPhilStage && p.philStage < tech.needsPhilStage) return false;
  if (tech.needsResources &&
      tech.needsResources.some((r) => !tribe.resourceAccess.has(r))) return false;
  return true;
}

// Pick a research target: the cheapest available tech, discounted by how
// well its category matches the tribe's posture.
function chooseResearchTarget(world, tribe) {
  const posture = computePosture(tribe.traits);
  const weight = {
    subsistence: 1.0,
    learning: 0.6 + 0.8 * posture.learning,
    trade: 0.6 + 0.8 * posture.trade,
    military: 0.6 + 0.8 * posture.military,
  };
  let best = null;
  let bestScore = Infinity;
  for (const id of Object.keys(TECHS)) {
    if (!techAvailable(world, tribe, id)) continue;
    const score = effectiveCost(TECHS[id], tribe.traits) / (weight[TECHS[id].category] || 1);
    if (score < bestScore) {
      bestScore = score;
      best = id;
    }
  }
  return best;
}

const ART_STAGES = ['—', 'Craft decoration', 'Monumental works', 'Distinctive style'];
const PHIL_STAGES = ['—', 'Oral tradition', 'Cosmology', 'Schools of thought'];
const ART_THRESHOLDS = [120, 500, 1500];
const PHIL_THRESHOLDS = [100, 400, 1200];

// Yearly knowledge update for one tribe: feed the pools from surplus
// effort, advance art/philosophy stages, and try to complete the current
// research target. Returns discovery/stage events as strings.
function updateKnowledge(world, tribe, pop, rng, seasonFactor) {
  const events = [];
  const p = tribe.progress;
  const traits = tribe.traits;
  const posture = computePosture(traits);
  const v = varianceRoll(rng, traits);

  // Surplus effort scales with sqrt(pop): bigger societies free more
  // hands, with diminishing returns. A disunited polity squanders much
  // of what it raises.
  const surplus = Math.sqrt(Math.max(0, pop)) * seasonFactor * v *
    (0.7 + 0.3 * (tribe.unity ?? 1));
  const prosperity = tribe.tradePartners > 0 ? 1.3 : 1.0;

  p.pools.tech += PARAMS.knowledgeRate * surplus * (2 * posture.learning) * (0.5 + traits.acumen);
  p.pools.art += PARAMS.knowledgeRate * surplus * traits.artistry * (1 + 0.5 * (1 - traits.discipline)) * prosperity;
  p.pools.philosophy += PARAMS.knowledgeRate * surplus * traits.contemplation * (1 - traits.dogmatism);

  // Stage ladders.
  while (p.artStage < 3 && p.pools.art >= ART_THRESHOLDS[p.artStage]) {
    p.artStage++;
    nudgeTrait(tribe, 'cohesion', 0.01);
    events.push(`${tribe.name} attained ${ART_STAGES[p.artStage].toLowerCase()} in their art.`);
  }
  while (p.philStage < 3 && p.pools.philosophy >= PHIL_THRESHOLDS[p.philStage]) {
    p.philStage++;
    events.push(`${tribe.name} developed ${PHIL_STAGES[p.philStage].toLowerCase()}.`);
  }

  // Research: retarget freely (cheap), then complete when the pool covers
  // the effective cost.
  p.target = chooseResearchTarget(world, tribe);
  if (p.target) {
    const cost = effectiveCost(TECHS[p.target], traits);
    if (p.pools.tech >= cost) {
      p.pools.tech -= cost;
      const eraBefore = tribeEra(tribe);
      p.techs.add(p.target);
      if (NETWORK_TECHS.has(p.target)) world.networkDirty = true;
      events.push(`${tribe.name} mastered ${TECHS[p.target].name}.`);
      const eraAfter = tribeEra(tribe);
      if (eraAfter !== eraBefore) {
        events.push(`${tribe.name} entered the ${ERA_LABELS[eraAfter]}.`);
      }
      p.target = null;
    }
  }
  return events;
}

// Ideas travel with contact. Adoption still requires prereqs and
// resources — you cannot copy bronze-working without tin.
function diffuseTechs(world, rng) {
  const events = [];
  const intensity = { trade: 3, contact: 1, rivalry: 0.6, war: 0.5 };

  for (const [key, rel] of Object.entries(world.relations || {})) {
    const mult = intensity[rel.stance] || 0;
    if (!mult) continue;
    const [aId, bId] = key.split('-').map(Number);
    const pair = [[aId, bId], [bId, aId]];
    for (const [fromId, toId] of pair) {
      const from = world.tribes[fromId];
      const to = world.tribes[toId];
      if (!from || !to || !from.alive || !to.alive) continue;
      for (const id of from.progress.techs) {
        if (!techAvailable(world, to, id)) continue;
        const pAdopt = PARAMS.diffusionRate * mult * (1 - to.traits.dogmatism) * (1 - 0.5 * from.traits.cohesion);
        if (rng.random() < pAdopt) {
          const eraBefore = tribeEra(to);
          to.progress.techs.add(id);
          if (NETWORK_TECHS.has(id)) world.networkDirty = true;
          events.push(`${to.name} learned ${TECHS[id].name} from ${from.name}.`);
          if (tribeEra(to) !== eraBefore) {
            events.push(`${to.name} entered the ${ERA_LABELS[tribeEra(to)]}.`);
          }
          break; // one adoption per pair-direction per year
        }
      }
    }
  }
  return events;
}
