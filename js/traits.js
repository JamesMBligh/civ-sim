// Traits: the dispositions of a people. Traits are causes — slow-moving
// character that shapes behaviour. Progress (js/tech.js) is effect.
// See design/tribe-evolution.md §2.

const TRAIT_KEYS = ['cohesion', 'dogmatism', 'physicality', 'acumen',
  'aggression', 'mercantile', 'artistry', 'contemplation', 'discipline'];

const TRAIT_LABELS = {
  cohesion: 'Cohesion',
  dogmatism: 'Dogmatism',
  physicality: 'Physicality',
  acumen: 'Acumen',
  aggression: 'Aggression',
  mercantile: 'Mercantile',
  artistry: 'Artistry',
  contemplation: 'Contemplation',
  discipline: 'Discipline',
};

// Real-civilization presets. Unlisted traits default to 0.5.
const ARCHETYPES = {
  hellenic: {
    label: 'Hellenic',
    traits: { contemplation: 0.9, artistry: 0.8, acumen: 0.8, mercantile: 0.7, cohesion: 0.3, dogmatism: 0.2, discipline: 0.35, aggression: 0.5, physicality: 0.55 },
  },
  roman: {
    label: 'Roman',
    traits: { cohesion: 0.85, aggression: 0.7, acumen: 0.75, discipline: 0.9, dogmatism: 0.5, contemplation: 0.4, mercantile: 0.55, artistry: 0.45, physicality: 0.65 },
  },
  israelite: {
    label: 'Israelite',
    traits: { cohesion: 0.9, dogmatism: 0.8, contemplation: 0.8, discipline: 0.7, mercantile: 0.5, aggression: 0.35, artistry: 0.5, acumen: 0.65, physicality: 0.5 },
  },
  philistine: {
    label: 'Philistine',
    traits: { mercantile: 0.8, aggression: 0.65, physicality: 0.7, artistry: 0.55, cohesion: 0.5, discipline: 0.5, dogmatism: 0.45, acumen: 0.55, contemplation: 0.35 },
  },
  persian: {
    label: 'Persian',
    traits: { acumen: 0.7, mercantile: 0.75, dogmatism: 0.35, cohesion: 0.6, contemplation: 0.6, discipline: 0.7, aggression: 0.55, artistry: 0.6, physicality: 0.55 },
  },
  han: {
    label: 'Han',
    traits: { acumen: 0.85, contemplation: 0.75, artistry: 0.7, cohesion: 0.75, dogmatism: 0.6, discipline: 0.85, mercantile: 0.6, aggression: 0.4, physicality: 0.5 },
  },
};

function clamp01(v, lo = 0.02, hi = 0.98) {
  return Math.max(lo, Math.min(hi, v));
}

// Roll a tribe's founding traits: an archetype with ±0.1 jitter, or a
// fully random people.
function rollTraits(rng, archetypeId) {
  const traits = {};
  const preset = archetypeId && ARCHETYPES[archetypeId]
    ? ARCHETYPES[archetypeId].traits : null;
  for (const key of TRAIT_KEYS) {
    const base = preset ? (preset[key] !== undefined ? preset[key] : 0.5)
      : rng.range(0.2, 0.8);
    const jitter = preset ? rng.range(-0.1, 0.1) : 0;
    traits[key] = clamp01(base + jitter);
  }
  return traits;
}

// The posture triangle: how a people prefers to spend surplus effort.
// Derived from traits, never stored. Discipline deliberately stays out —
// it shapes how well a posture is executed, not which one is preferred.
function computePosture(traits) {
  const military = 0.4 * traits.aggression + 0.3 * traits.cohesion + 0.3 * traits.physicality;
  const trade = 0.4 * traits.mercantile + 0.3 * (1 - traits.cohesion) + 0.3 * (1 - traits.dogmatism);
  const learning = 0.4 * traits.acumen + 0.3 * traits.contemplation + 0.3 * (1 - traits.dogmatism);
  const sum = military + trade + learning;
  return { military: military / sum, trade: trade / sum, learning: learning / sum };
}

function dominantPostureGlyph(posture) {
  if (posture.military >= posture.trade && posture.military >= posture.learning) return '⚔';
  if (posture.trade >= posture.learning) return '⚖';
  return '📜';
}

// Discipline as a variance dial: high discipline lands near expectation,
// low discipline swings both ways. Multiplicative factor around 1.
function varianceRoll(rng, traits) {
  const spread = 0.35 * (1 - traits.discipline);
  return Math.max(0.4, 1 + rng.range(-1, 1) * spread);
}

// Yearly trait drift: tiny seeded noise plus event nudges accumulated
// during the year (war, trade, famine...). Capped at ±0.2 from the
// founding value so a people's character stays recognisable.
const TRAIT_DRIFT_CAP = 0.2;

function nudgeTrait(tribe, key, delta) {
  if (!tribe.nudges) tribe.nudges = {};
  tribe.nudges[key] = (tribe.nudges[key] || 0) + delta;
}

function driftTraits(tribe, rng) {
  for (const key of TRAIT_KEYS) {
    let v = tribe.traits[key];
    v += rng.range(-0.004, 0.004);
    if (tribe.nudges && tribe.nudges[key]) v += tribe.nudges[key];
    const anchor = tribe.foundingTraits[key];
    v = Math.max(anchor - TRAIT_DRIFT_CAP, Math.min(anchor + TRAIT_DRIFT_CAP, v));
    tribe.traits[key] = clamp01(v);
  }
  tribe.nudges = {};
}
