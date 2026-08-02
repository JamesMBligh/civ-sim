// Tunable simulation parameters. Every entry starts at its default and
// can be edited live from the Parameters tab; code reads PARAMS.<key> at
// the moment of use, so most changes take effect as the simulation
// continues. Entries marked worldgen: true only apply when a new world
// is generated.

const PARAM_DEFS = [
  // --- Movement & roads ---
  { key: 'roadCost', group: 'Movement & roads', label: 'Road travel cost', def: 0.08, min: 0.02, max: 1, step: 0.01,
    hint: 'vs 1.0 open plains — lower pulls traffic onto existing roads' },
  { key: 'trackFactor', group: 'Movement & roads', label: 'Track cost factor', def: 0.85, min: 0.3, max: 1, step: 0.05,
    hint: 'multiplies terrain cost on worn tracks' },
  { key: 'ferryBoatCost', group: 'Movement & roads', label: 'Ferry cost (boats)', def: 0.35, min: 0.05, max: 2, step: 0.05 },
  { key: 'ferryWalkCost', group: 'Movement & roads', label: 'Ferry cost (no boats)', def: 1.5, min: 0.2, max: 5, step: 0.1 },
  { key: 'riverBoatCost', group: 'Movement & roads', label: 'River cost (boats)', def: 0.35, min: 0.05, max: 2, step: 0.05 },
  { key: 'lakeBoatCost', group: 'Movement & roads', label: 'Lake cost (boats)', def: 0.4, min: 0.05, max: 2, step: 0.05 },
  { key: 'seaBoatCost', group: 'Movement & roads', label: 'Coastal sea cost (boats)', def: 0.45, min: 0.05, max: 2, step: 0.05 },
  { key: 'trackThreshold', group: 'Movement & roads', label: 'Wear to form a track', def: 35, min: 5, max: 200, step: 5 },
  { key: 'paveWearMin', group: 'Movement & roads', label: 'Wear to justify paving', def: 75, min: 10, max: 400, step: 5 },
  { key: 'paveRateBase', group: 'Movement & roads', label: 'Paving rate (base)', def: 1, min: 0, max: 10, step: 1,
    hint: 'road tiles per year' },
  { key: 'paveRateDiscipline', group: 'Movement & roads', label: 'Paving rate (× discipline)', def: 2, min: 0, max: 10, step: 1 },

  // --- Trade ---
  { key: 'networkInterval', group: 'Trade', label: 'Route recompute interval (yrs)', def: 5, min: 1, max: 25, step: 1 },
  { key: 'routeMaxCost', group: 'Trade', label: 'Max route cost', def: 120, min: 20, max: 400, step: 10,
    hint: 'paths dearer than this form no route' },
  { key: 'flowDistanceDamp', group: 'Trade', label: 'Flow distance damping', def: 25, min: 5, max: 100, step: 5,
    hint: 'higher = distance hurts trade less' },
  { key: 'externalTradeBonus', group: 'Trade', label: 'External trade value', def: 1.5, min: 0.5, max: 4, step: 0.1,
    hint: 'income multiplier for routes between peoples' },
  { key: 'marketShare', group: 'Trade', label: 'Through-traffic income share', def: 0.5, min: 0, max: 2, step: 0.1 },

  // --- Demography ---
  { key: 'foragerGrowth', group: 'Demography', label: 'Forager growth rate', def: 0.0025, min: 0, max: 0.02, step: 0.0005 },
  { key: 'farmerGrowth', group: 'Demography', label: 'Farmer growth rate', def: 0.008, min: 0, max: 0.05, step: 0.001 },
  { key: 'settlementSplitPop', group: 'Demography', label: 'Settlement split population', def: 1100, min: 200, max: 10000, step: 100 },
  { key: 'splitCapFraction', group: 'Demography', label: 'Split at fraction of land cap', def: 0.45, min: 0.1, max: 1, step: 0.05 },
  { key: 'harshWinterChance', group: 'Demography', label: 'Harsh winter chance', def: 0.15, min: 0, max: 0.5, step: 0.01 },
  { key: 'mildYearChance', group: 'Demography', label: 'Mild year chance', def: 0.15, min: 0, max: 0.5, step: 0.01 },
  { key: 'harshWinterFactor', group: 'Demography', label: 'Harsh winter food factor', def: 0.75, min: 0.3, max: 1, step: 0.05 },

  // --- Knowledge ---
  { key: 'knowledgeRate', group: 'Knowledge', label: 'Knowledge gain rate', def: 0.15, min: 0.01, max: 1, step: 0.01,
    hint: 'scales tech, art and philosophy pools' },
  { key: 'diffusionRate', group: 'Knowledge', label: 'Tech diffusion rate', def: 0.015, min: 0, max: 0.2, step: 0.005,
    hint: 'chance/yr per contact that an idea spreads' },

  // --- War & diplomacy ---
  { key: 'raidLossRate', group: 'War & diplomacy', label: 'Raid loss rate', def: 0.01, min: 0, max: 0.1, step: 0.005,
    hint: 'population lost per war year × strength ratio' },
  { key: 'conquestChance', group: 'War & diplomacy', label: 'Conquest chance', def: 0.15, min: 0, max: 1, step: 0.05,
    hint: '× strength ratio, when the gates are met' },
  { key: 'incidentBase', group: 'War & diplomacy', label: 'Diplomatic incident base rate', def: 0.005, min: 0, max: 0.1, step: 0.005 },
  { key: 'goodwillBase', group: 'War & diplomacy', label: 'Goodwill event base rate', def: 0.005, min: 0, max: 0.1, step: 0.005 },

  // --- Society ---
  { key: 'traitDriftCap', group: 'Society', label: 'Trait drift cap', def: 0.2, min: 0, max: 0.5, step: 0.05,
    hint: 'max distance from founding character' },
  { key: 'passionVariance', group: 'Society', label: 'Passion variance', def: 0.35, min: 0, max: 1, step: 0.05,
    hint: 'outcome swing for low-discipline peoples' },
  { key: 'civilWarUnity', group: 'Society', label: 'Civil war unity threshold', def: 0.4, min: 0, max: 0.9, step: 0.05 },
  { key: 'unityRecovery', group: 'Society', label: 'Unity recovery rate', def: 0.0015, min: 0, max: 0.02, step: 0.0005 },

  // --- Worldgen (apply on Generate) ---
  { key: 'depositSurfaceMin', group: 'Worldgen', label: 'Surface deposit min', def: 80, min: 10, max: 2000, step: 10, worldgen: true },
  { key: 'depositSurfaceMax', group: 'Worldgen', label: 'Surface deposit max', def: 200, min: 20, max: 4000, step: 10, worldgen: true },
  { key: 'depositDeepMin', group: 'Worldgen', label: 'Deep deposit min', def: 250, min: 20, max: 5000, step: 10, worldgen: true },
  { key: 'depositDeepMax', group: 'Worldgen', label: 'Deep deposit max', def: 600, min: 50, max: 10000, step: 10, worldgen: true },
];

const PARAMS = {};
function resetParams() {
  for (const def of PARAM_DEFS) PARAMS[def.key] = def.def;
}
resetParams();
