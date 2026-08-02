// Resource placement. Each resource has terrain it can appear on and a
// density; placement is seeded so it's reproducible. Resources sit near
// where they'd plausibly occur on Earth: ores in mountains, fish on coasts,
// fertile soil along rivers, and so on.

// category: 'natural' = living/renewable resources, 'mineral' = extractive
// deposits. The map can be filtered to show either group on its own.
//
// The mineral set covers the strategic materials of the Stone, Bronze and
// Iron Ages:
//   Stone Age  — flint (knappable toolstone), obsidian (volcanic glass),
//                stone, clay, salt
//   Bronze Age — copper + tin (bronze), gold, silver, lead
//   Iron Age   — iron ore (abundant, unlike tin/copper)
const RESOURCES = {
  FISH: { id: 'fish', name: 'Fish', color: '#5fc9e8', symbol: '◆', category: 'natural' },
  GAME: { id: 'game', name: 'Wild game', color: '#c98d5f', symbol: '▲', category: 'natural' },
  TIMBER: { id: 'timber', name: 'Timber', color: '#3e7a3e', symbol: '♠', category: 'natural' },
  FERTILE: { id: 'fertile', name: 'Fertile soil', color: '#d9c94a', symbol: '❋', category: 'natural' },
  STONE: { id: 'stone', name: 'Stone', color: '#a8a8b0', symbol: '■', category: 'mineral' },
  FLINT: { id: 'flint', name: 'Flint', color: '#4d5866', symbol: '◆', category: 'mineral' },
  OBSIDIAN: { id: 'obsidian', name: 'Obsidian', color: '#6a4d8f', symbol: '◆', category: 'mineral' },
  COPPER: { id: 'copper', name: 'Copper ore', color: '#e08a3c', symbol: '●', category: 'mineral' },
  TIN: { id: 'tin', name: 'Tin ore', color: '#7fa8b8', symbol: '●', category: 'mineral' },
  IRON: { id: 'iron', name: 'Iron ore', color: '#8a4a4a', symbol: '●', category: 'mineral' },
  GOLD: { id: 'gold', name: 'Gold', color: '#f2c118', symbol: '●', category: 'mineral' },
  SILVER: { id: 'silver', name: 'Silver ore', color: '#c2cede', symbol: '●', category: 'mineral' },
  LEAD: { id: 'lead', name: 'Lead ore', color: '#5f6672', symbol: '●', category: 'mineral' },
  CLAY: { id: 'clay', name: 'Clay', color: '#b06848', symbol: '▼', category: 'mineral' },
  SALT: { id: 'salt', name: 'Salt', color: '#e8e8f0', symbol: '✦', category: 'mineral' },
};

function generateResources(world, rng) {
  const { size, terrain, moisture, elevation } = world;
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

  // Ore provinces: the scarce Bronze Age metals don't occur evenly across a
  // landmass — they cluster in a few mineralised districts (think Cornish
  // tin or Welsh gold). Each metal gets 1-2 upland regions; deposits only
  // spawn inside them, so their locations shape future trade routes.
  const uplandTiles = [];
  for (let i = 0; i < size * size; i++) {
    if (terrain[i] === TERRAIN.HILLS || terrain[i] === TERRAIN.MOUNTAINS) {
      uplandTiles.push(i);
    }
  }

  const makeProvince = (label, count, radius) => {
    const r = resRng.fork(label);
    const centers = [];
    for (let k = 0; k < count && uplandTiles.length > 0; k++) {
      centers.push(r.pick(uplandTiles));
    }
    return { centers, radius };
  };

  const provinces = {
    tin: makeProvince('tin', 2, 13),
    gold: makeProvince('gold', 2, 10),
    // Silver and lead co-occur in nature (silver is refined from galena,
    // a lead ore), so they share one province.
    silverLead: makeProvince('silver-lead', 2, 12),
  };

  const inProvince = (p, x, y) => {
    for (const c of p.centers) {
      const dx = x - (c % size);
      const dy = y - ((c / size) | 0);
      if (dx * dx + dy * dy <= p.radius * p.radius) return true;
    }
    return false;
  };
  world.oreProvinces = provinces;

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
          } else if (roll < 0.065) {
            // Flint nodules erode out of chalk sea-cliffs onto beaches.
            resources[i] = RESOURCES.FLINT;
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
          } else if (roll < 0.075 && elevation[i] < 0.62) {
            // Chalk downland: surface flint, the Stone Age's toolstone.
            resources[i] = RESOURCES.FLINT;
          }
          break;

        case TERRAIN.FOREST:
          if (roll < 0.14) resources[i] = RESOURCES.TIMBER;
          else if (roll < 0.19) resources[i] = RESOURCES.GAME;
          break;

        case TERRAIN.HILLS:
          // Province metals first: scarce, and only in their districts.
          if (inProvince(provinces.tin, x, y) && roll < 0.09) {
            resources[i] = RESOURCES.TIN;
          } else if (inProvince(provinces.gold, x, y) && roll < 0.05) {
            resources[i] = RESOURCES.GOLD;
          } else if (inProvince(provinces.silverLead, x, y) && roll < 0.045) {
            resources[i] = RESOURCES.SILVER;
          } else if (inProvince(provinces.silverLead, x, y) && roll < 0.095) {
            resources[i] = RESOURCES.LEAD;
          } else if (roll < 0.11 && roll >= 0.105 &&
            nearType(x, y, TERRAIN.RIVER, 1)) {
            // A trace of placer gold panned from upland streams.
            resources[i] = RESOURCES.GOLD;
          } else if (roll < 0.05) resources[i] = RESOURCES.STONE;
          else if (roll < 0.07) resources[i] = RESOURCES.COPPER;
          else if (roll < 0.085) resources[i] = RESOURCES.IRON;
          else if (roll < 0.105) resources[i] = RESOURCES.GAME;
          break;

        case TERRAIN.MOUNTAINS:
          if (inProvince(provinces.tin, x, y) && roll < 0.07) {
            resources[i] = RESOURCES.TIN;
          } else if (inProvince(provinces.gold, x, y) && roll < 0.04) {
            resources[i] = RESOURCES.GOLD;
          } else if (inProvince(provinces.silverLead, x, y) && roll < 0.04) {
            resources[i] = RESOURCES.SILVER;
          } else if (inProvince(provinces.silverLead, x, y) && roll < 0.08) {
            resources[i] = RESOURCES.LEAD;
          } else if (roll < 0.02 && nearType(x, y, TERRAIN.PEAKS, 2)) {
            // Volcanic glass around the high summits.
            resources[i] = RESOURCES.OBSIDIAN;
          } else if (roll < 0.09) resources[i] = RESOURCES.STONE;
          else if (roll < 0.125) resources[i] = RESOURCES.IRON;
          else if (roll < 0.15) resources[i] = RESOURCES.COPPER;
          break;

        case TERRAIN.PEAKS:
          if (roll < 0.04) resources[i] = RESOURCES.OBSIDIAN;
          break;

        default:
          break;
      }
    }
  }

  world.resources = resources;
}
