// Terrain generation: builds the elevation and moisture fields and
// classifies each tile into a terrain type.
//
// Scale: the map is 256x256 tiles at ~4 km per tile, giving a landmass of
// roughly 800-1000 km north-south — about the size of Great Britain.

const TERRAIN = {
  DEEP_OCEAN: 'deep_ocean',
  OCEAN: 'ocean',
  COAST: 'coast',        // beaches / tidal flats
  MARSH: 'marsh',
  PLAINS: 'plains',
  GRASSLAND: 'grassland',
  FOREST: 'forest',
  HILLS: 'hills',
  MOUNTAINS: 'mountains',
  PEAKS: 'peaks',
  LAKE: 'lake',
  RIVER: 'river',
};

// Elevation thresholds (0..1). Sea level is 0.5.
const SEA_LEVEL = 0.5;
const ELEV = {
  DEEP: 0.35,
  COAST_MAX: 0.53,
  HILLS: 0.72,
  MOUNTAINS: 0.83,
  PEAKS: 0.93,
};

function generateTerrain(world, rng) {
  const { size } = world;
  const elevNoise = new ValueNoise(rng.fork('elevation'));
  const moistNoise = new ValueNoise(rng.fork('moisture'));
  const warpNoise = new ValueNoise(rng.fork('warp'));

  const elevation = new Float32Array(size * size);
  const moisture = new Float32Array(size * size);

  // The island's centre is jittered a little so coastlines vary run to run.
  const centerRng = rng.fork('center');
  const cx = size * centerRng.range(0.45, 0.55);
  const cy = size * centerRng.range(0.45, 0.55);
  const maxDist = size * 0.5;

  // Prevailing wind comes from a random compass direction; the windward side
  // of the island is wetter, like Atlantic weather hitting western Britain.
  const windAngle = centerRng.range(0, Math.PI * 2);
  const windX = Math.cos(windAngle);
  const windY = Math.sin(windAngle);
  world.windAngle = windAngle;

  const freq = 4.5 / size; // base noise frequency

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;

      // Domain warp makes coastlines and ridges less blobby.
      const wx = warpNoise.fbm(x * freq * 2, y * freq * 2, 3) - 0.5;
      const wy = warpNoise.fbm(x * freq * 2 + 40, y * freq * 2 + 40, 3) - 0.5;
      const nx = (x + wx * 60) * freq;
      const ny = (y + wy * 60) * freq;

      let e = elevNoise.fbm(nx, ny, 6, 2.0, 0.5);

      // Radial falloff guarantees a single island surrounded by ocean.
      const dx = (x - cx) / maxDist;
      const dy = (y - cy) / maxDist;
      const d = Math.sqrt(dx * dx + dy * dy);
      // Gentle in the interior, steep near the edge.
      const falloff = Math.max(0, 1 - Math.pow(d, 2.6));
      e = e * falloff;

      // Re-normalise into 0..1 with sea level at 0.5: noise*falloff peaks
      // around ~0.75, so stretch it. The soft cap above 0.85 keeps summit
      // plateaus from flattening into one huge blob of peaks.
      e = Math.min(1, e * 1.42);
      if (e > 0.85) e = 0.85 + (e - 0.85) * 0.6;

      elevation[i] = e;

      // Moisture: base noise plus a windward bonus, minus a rain shadow for
      // tiles far downwind (crude but produces a wet coast / drier interior).
      const mBase = moistNoise.fbm(x * freq * 1.5 + 100, y * freq * 1.5 + 100, 4);
      const alongWind = ((x - cx) * windX + (y - cy) * windY) / maxDist; // -1..1
      const windward = -alongWind * 0.15; // upwind side gets +, downwind -
      moisture[i] = Math.max(0, Math.min(1, mBase + windward));
    }
  }

  world.elevation = elevation;
  world.moisture = moisture;

  classifyTerrain(world);
}

function classifyTerrain(world) {
  const { size, elevation, moisture } = world;
  const terrain = new Array(size * size);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const e = elevation[i];
      const m = moisture[i];

      if (e < ELEV.DEEP) {
        terrain[i] = TERRAIN.DEEP_OCEAN;
      } else if (e < SEA_LEVEL) {
        terrain[i] = TERRAIN.OCEAN;
      } else if (e < ELEV.COAST_MAX) {
        terrain[i] = m > 0.72 ? TERRAIN.MARSH : TERRAIN.COAST;
      } else if (e < ELEV.HILLS) {
        if (m > 0.62) terrain[i] = TERRAIN.FOREST;
        else if (m > 0.4) terrain[i] = TERRAIN.GRASSLAND;
        else terrain[i] = TERRAIN.PLAINS;
      } else if (e < ELEV.MOUNTAINS) {
        terrain[i] = m > 0.66 ? TERRAIN.FOREST : TERRAIN.HILLS;
      } else if (e < ELEV.PEAKS) {
        terrain[i] = TERRAIN.MOUNTAINS;
      } else {
        terrain[i] = TERRAIN.PEAKS;
      }
    }
  }

  world.terrain = terrain;
}

function isWater(terrainType) {
  return terrainType === TERRAIN.DEEP_OCEAN ||
    terrainType === TERRAIN.OCEAN ||
    terrainType === TERRAIN.LAKE ||
    terrainType === TERRAIN.RIVER;
}

function isSea(terrainType) {
  return terrainType === TERRAIN.DEEP_OCEAN || terrainType === TERRAIN.OCEAN;
}
