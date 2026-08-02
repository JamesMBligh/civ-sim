// Resource placement. Each resource has terrain it can appear on and a
// density; placement is seeded so it's reproducible. Resources sit near
// where they'd plausibly occur on Earth: ores in mountains, fish on coasts,
// fertile soil along rivers, and so on.

// category: 'natural' = living/renewable resources, 'mineral' = extractive
// deposits. The map can be filtered to show either group on its own.
const RESOURCES = {
  FISH: { id: 'fish', name: 'Fish', color: '#5fc9e8', symbol: '◆', category: 'natural' },
  GAME: { id: 'game', name: 'Wild game', color: '#c98d5f', symbol: '▲', category: 'natural' },
  TIMBER: { id: 'timber', name: 'Timber', color: '#3e7a3e', symbol: '♠', category: 'natural' },
  FERTILE: { id: 'fertile', name: 'Fertile soil', color: '#d9c94a', symbol: '❋', category: 'natural' },
  STONE: { id: 'stone', name: 'Stone', color: '#a8a8b0', symbol: '■', category: 'mineral' },
  COPPER: { id: 'copper', name: 'Copper ore', color: '#e08a3c', symbol: '●', category: 'mineral' },
  IRON: { id: 'iron', name: 'Iron ore', color: '#8a4a4a', symbol: '●', category: 'mineral' },
  CLAY: { id: 'clay', name: 'Clay', color: '#b06848', symbol: '▼', category: 'mineral' },
  SALT: { id: 'salt', name: 'Salt', color: '#e8e8f0', symbol: '✦', category: 'mineral' },
};

function generateResources(world, rng) {
  const { size, terrain, moisture } = world;
  const resRng = rng.fork('resources');
  const resources = new Array(size * size).fill(null);

  const nearType = (x, y, type, radius) => {
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
        const t = terrain[ny * size + nx];
        if (Array.isArray(type) ? type.includes(t) : t === type) return true;
      }
    }
    return false;
  };

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const t = terrain[i];
      const roll = resRng.random();

      switch (t) {
        case TERRAIN.OCEAN:
          // Fishing grounds hug the shore.
          if (roll < 0.045 && nearType(x, y, [TERRAIN.COAST, TERRAIN.MARSH], 2)) {
            resources[i] = RESOURCES.FISH;
          }
          break;

        case TERRAIN.COAST:
          if (roll < 0.02) resources[i] = RESOURCES.SALT;
          else if (roll < 0.05 && nearType(x, y, TERRAIN.RIVER, 2)) {
            resources[i] = RESOURCES.CLAY;
          }
          break;

        case TERRAIN.MARSH:
          if (roll < 0.06) resources[i] = RESOURCES.CLAY;
          break;

        case TERRAIN.PLAINS:
        case TERRAIN.GRASSLAND:
          if (nearType(x, y, [TERRAIN.RIVER, TERRAIN.LAKE], 2)) {
            // River valleys are the breadbasket.
            if (roll < 0.22) resources[i] = RESOURCES.FERTILE;
            else if (roll < 0.26) resources[i] = RESOURCES.CLAY;
          } else if (roll < 0.04 && moisture[i] > 0.45) {
            resources[i] = RESOURCES.FERTILE;
          } else if (roll < 0.055) {
            resources[i] = RESOURCES.GAME;
          }
          break;

        case TERRAIN.FOREST:
          if (roll < 0.14) resources[i] = RESOURCES.TIMBER;
          else if (roll < 0.19) resources[i] = RESOURCES.GAME;
          break;

        case TERRAIN.HILLS:
          if (roll < 0.05) resources[i] = RESOURCES.STONE;
          else if (roll < 0.07) resources[i] = RESOURCES.COPPER;
          else if (roll < 0.085) resources[i] = RESOURCES.IRON;
          else if (roll < 0.11) resources[i] = RESOURCES.GAME;
          break;

        case TERRAIN.MOUNTAINS:
          if (roll < 0.09) resources[i] = RESOURCES.STONE;
          else if (roll < 0.125) resources[i] = RESOURCES.IRON;
          else if (roll < 0.15) resources[i] = RESOURCES.COPPER;
          break;

        default:
          break;
      }
    }
  }

  world.resources = resources;
}
