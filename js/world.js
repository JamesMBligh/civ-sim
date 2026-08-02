// The World object holds the entire simulation state in memory.
// Generation pipeline: terrain (elevation + moisture + biomes) -> rivers ->
// resources. Later phases (tribes, simulation ticks) will build on this.

const WORLD_SIZE = 256;      // tiles per side
const KM_PER_TILE = 4;       // ~1000 km across: Great Britain scale

function createWorld(seedString) {
  const rng = new RNG(seedString);

  const world = {
    seed: seedString,
    size: WORLD_SIZE,
    kmPerTile: KM_PER_TILE,
    elevation: null,   // Float32Array, 0..1, sea level at 0.5
    moisture: null,    // Float32Array, 0..1
    temperature: null, // Float32Array, average annual °C
    terrain: null,     // Array of TERRAIN values
    riverFlow: null,   // Uint16Array flow volume
    resources: null,   // Array of RESOURCES entries or null
    windAngle: 0,      // prevailing wind direction, radians
  };

  generateTerrain(world, rng);
  generateRivers(world, rng);
  generateResources(world, rng);
  computeSiteFeatures(world);        // harbors, fords, confluences
  initDeposits(world, rng.fork('deposits')); // finite mineral deposits

  world.stats = computeStats(world);
  return world;
}

function computeStats(world) {
  const { size, terrain, resources } = world;
  const terrainCounts = {};
  const resourceCounts = {};
  let landTiles = 0;

  for (let i = 0; i < size * size; i++) {
    const t = terrain[i];
    terrainCounts[t] = (terrainCounts[t] || 0) + 1;
    if (!isSea(t)) landTiles++;
    const r = resources[i];
    if (r) resourceCounts[r.id] = (resourceCounts[r.id] || 0) + 1;
  }

  const kmPerTile = world.kmPerTile;
  return {
    terrainCounts,
    resourceCounts,
    landTiles,
    landAreaKm2: landTiles * kmPerTile * kmPerTile,
    landPercent: (100 * landTiles) / (size * size),
  };
}

function tileAt(world, x, y) {
  if (x < 0 || y < 0 || x >= world.size || y >= world.size) return null;
  const i = y * world.size + x;
  return {
    x,
    y,
    terrain: world.terrain[i],
    elevation: world.elevation[i],
    moisture: world.moisture[i],
    temperature: world.temperature[i],
    resource: world.resources[i],
    riverFlow: world.riverFlow[i],
  };
}
