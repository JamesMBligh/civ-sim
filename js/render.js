// Canvas rendering: draws the world at a fixed pixel scale with three view
// modes (terrain, elevation, moisture) and resource markers.

const TILE_PX = 3;

const TERRAIN_COLORS = {
  [TERRAIN.DEEP_OCEAN]: [16, 42, 74],
  [TERRAIN.OCEAN]: [30, 70, 110],
  [TERRAIN.COAST]: [214, 196, 148],
  [TERRAIN.MARSH]: [104, 130, 90],
  [TERRAIN.PLAINS]: [168, 184, 108],
  [TERRAIN.GRASSLAND]: [120, 160, 84],
  [TERRAIN.FOREST]: [56, 104, 58],
  [TERRAIN.HILLS]: [142, 128, 96],
  [TERRAIN.MOUNTAINS]: [130, 122, 120],
  [TERRAIN.PEAKS]: [235, 235, 240],
  [TERRAIN.LAKE]: [60, 120, 160],
  [TERRAIN.RIVER]: [70, 130, 175],
};

const TERRAIN_LABELS = {
  [TERRAIN.DEEP_OCEAN]: 'Deep ocean',
  [TERRAIN.OCEAN]: 'Ocean',
  [TERRAIN.COAST]: 'Coast',
  [TERRAIN.MARSH]: 'Marsh',
  [TERRAIN.PLAINS]: 'Plains',
  [TERRAIN.GRASSLAND]: 'Grassland',
  [TERRAIN.FOREST]: 'Forest',
  [TERRAIN.HILLS]: 'Hills',
  [TERRAIN.MOUNTAINS]: 'Mountains',
  [TERRAIN.PEAKS]: 'Peaks',
  [TERRAIN.LAKE]: 'Lake',
  [TERRAIN.RIVER]: 'River',
};

function renderWorld(world, canvas, view = 'terrain') {
  const { size } = world;
  canvas.width = size * TILE_PX;
  canvas.height = size * TILE_PX;
  const ctx = canvas.getContext('2d');

  const img = ctx.createImageData(canvas.width, canvas.height);
  const data = img.data;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      let r, g, b;

      if (view === 'elevation') {
        const e = world.elevation[i];
        if (e < 0.5) {
          // Water depths in blue
          const t = e / 0.5;
          r = 10 + 40 * t; g = 30 + 70 * t; b = 60 + 110 * t;
        } else {
          // Land heights from green to white
          const t = (e - 0.5) / 0.5;
          r = 60 + 175 * t; g = 130 + 105 * t; b = 60 + 175 * t;
        }
      } else if (view === 'moisture') {
        const m = world.moisture[i];
        const sea = isSea(world.terrain[i]);
        if (sea) { r = 25; g = 35; b = 50; }
        else { r = 200 - 160 * m; g = 170 - 60 * m; b = 60 + 160 * m; }
      } else {
        const t = world.terrain[i];
        [r, g, b] = TERRAIN_COLORS[t] || [255, 0, 255];

        // Hill-shade land by elevation for a bit of relief.
        if (!isWater(t)) {
          const e = world.elevation[i];
          const west = x > 0 ? world.elevation[i - 1] : e;
          const slope = (e - west) * 8;
          const shade = 1 + Math.max(-0.25, Math.min(0.25, slope));
          r *= shade; g *= shade; b *= shade;
        }
      }

      // Fill the TILE_PX x TILE_PX block
      for (let py = 0; py < TILE_PX; py++) {
        let p = ((y * TILE_PX + py) * canvas.width + x * TILE_PX) * 4;
        for (let px = 0; px < TILE_PX; px++) {
          data[p] = r; data[p + 1] = g; data[p + 2] = b; data[p + 3] = 255;
          p += 4;
        }
      }
    }
  }

  ctx.putImageData(img, 0, 0);

  // Resource markers on top (terrain view only, to keep data views clean).
  if (view === 'terrain') {
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const res = world.resources[y * size + x];
        if (!res) continue;
        ctx.fillStyle = res.color;
        const px = x * TILE_PX + TILE_PX / 2;
        const py = y * TILE_PX + TILE_PX / 2;
        ctx.beginPath();
        ctx.arc(px, py, TILE_PX * 0.42, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
}
