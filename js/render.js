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

// Linear interpolation across a multi-stop color ramp; t in 0..1.
function rampColor(stops, t) {
  t = Math.max(0, Math.min(1, t));
  const seg = t * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(seg));
  const f = seg - i;
  const a = stops[i];
  const b = stops[i + 1];
  return [
    a[0] + (b[0] - a[0]) * f,
    a[1] + (b[1] - a[1]) * f,
    a[2] + (b[2] - a[2]) * f,
  ];
}

// Display ranges for the climate views.
const RAINFALL_RANGE = { min: 400, max: 2800 };   // mm/year
const TEMPERATURE_RANGE = { min: -2, max: 14 };   // °C

const RAINFALL_RAMP = [
  [214, 190, 130],  // dry: parched tan
  [150, 180, 100],  // moderate: green
  [60, 140, 120],   // wet: teal
  [30, 80, 170],    // very wet: deep blue
];

const TEMPERATURE_RAMP = [
  [70, 90, 200],    // cold: blue
  [110, 180, 210],  // cool: cyan
  [220, 215, 120],  // mild: yellow
  [225, 130, 60],   // warm: orange
  [190, 40, 40],    // hot: red
];

function hexToRgb(hex) {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
}

function satelliteColor(world, x, y, i) {
  const t = world.terrain[i];
  let [r, g, b] = TERRAIN_COLORS[t] || [255, 0, 255];

  // Hill-shade land by elevation for a bit of relief.
  if (!isWater(t)) {
    const e = world.elevation[i];
    const west = x > 0 ? world.elevation[i - 1] : e;
    const slope = (e - west) * 8;
    const shade = 1 + Math.max(-0.25, Math.min(0.25, slope));
    r *= shade; g *= shade; b *= shade;
  }
  return [r, g, b];
}

function renderWorld(world, canvas, view = 'satellite') {
  const { size } = world;
  canvas.width = size * TILE_PX;
  canvas.height = size * TILE_PX;
  const ctx = canvas.getContext('2d');

  const img = ctx.createImageData(canvas.width, canvas.height);
  const data = img.data;

  const resourceView = view === 'minerals' || view === 'natural';
  const tribeRgb = (world.tribes || []).map((t) => hexToRgb(t.color));

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      let r, g, b;
      const sea = isSea(world.terrain[i]);

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
      } else if (view === 'rainfall') {
        if (sea) { r = 22; g = 30; b = 44; }
        else {
          const mm = moistureToRainfallMm(world.moisture[i]);
          const t = (mm - RAINFALL_RANGE.min) / (RAINFALL_RANGE.max - RAINFALL_RANGE.min);
          [r, g, b] = rampColor(RAINFALL_RAMP, t);
        }
      } else if (view === 'temperature') {
        if (sea) { r = 22; g = 30; b = 44; }
        else {
          const c = world.temperature[i];
          const t = (c - TEMPERATURE_RANGE.min) / (TEMPERATURE_RANGE.max - TEMPERATURE_RANGE.min);
          [r, g, b] = rampColor(TEMPERATURE_RAMP, t);
        }
      } else if (resourceView) {
        // Desaturated satellite base so the resource markers stand out.
        [r, g, b] = satelliteColor(world, x, y, i);
        const lum = 0.3 * r + 0.59 * g + 0.11 * b;
        const mix = sea ? 0.55 : 0.82; // keep a hint of blue in the sea
        r = r + (lum - r) * mix;
        g = g + (lum - g) * mix;
        b = b + (lum - b) * mix;
        r *= 0.7; g *= 0.7; b *= 0.7;
      } else if (view === 'communities') {
        // Muted satellite base tinted by whichever tribe holds the tile.
        [r, g, b] = satelliteColor(world, x, y, i);
        const lum = 0.3 * r + 0.59 * g + 0.11 * b;
        const mix = sea ? 0.4 : 0.65;
        r = (r + (lum - r) * mix) * 0.8;
        g = (g + (lum - g) * mix) * 0.8;
        b = (b + (lum - b) * mix) * 0.8;

        const ownerId = world.influenceOwner ? world.influenceOwner[i] : -1;
        if (ownerId >= 0 && tribeRgb[ownerId]) {
          const a = 0.2 + world.influenceStrength[i] * 0.45;
          const [tr, tg, tb] = tribeRgb[ownerId];
          r = r * (1 - a) + tr * a;
          g = g * (1 - a) + tg * a;
          b = b * (1 - a) + tb * a;
        }
      } else {
        // satellite
        [r, g, b] = satelliteColor(world, x, y, i);
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

  // Resource markers: all of them on the satellite view, a single filtered
  // category (drawn larger, with an outline) on the resource views.
  if (view === 'satellite' || resourceView) {
    const filter = view === 'minerals' ? 'mineral'
      : view === 'natural' ? 'natural' : null;
    const radius = resourceView ? TILE_PX * 0.75 : TILE_PX * 0.42;

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const res = world.resources[y * size + x];
        if (!res) continue;
        if (filter && res.category !== filter) continue;
        const px = x * TILE_PX + TILE_PX / 2;
        const py = y * TILE_PX + TILE_PX / 2;
        ctx.fillStyle = res.color;
        ctx.beginPath();
        ctx.arc(px, py, radius, 0, Math.PI * 2);
        ctx.fill();
        if (resourceView) {
          ctx.strokeStyle = 'rgba(0,0,0,0.6)';
          ctx.lineWidth = 0.8;
          ctx.stroke();
        }
      }
    }
  }

  // Settlements: drawn on the satellite and communities views. Marker size
  // scales with population; the communities view also labels each tribe at
  // its first (founding) settlement.
  if ((view === 'satellite' || view === 'communities') && world.tribes) {
    for (const tribe of world.tribes) {
      if (!tribe.alive) continue;
      tribe.settlements.forEach((s, idx) => {
        const px = s.x * TILE_PX + TILE_PX / 2;
        const py = s.y * TILE_PX + TILE_PX / 2;
        const radius = 2.5 + Math.sqrt(s.pop) / 5;
        ctx.fillStyle = tribe.color;
        ctx.strokeStyle = 'rgba(0,0,0,0.85)';
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.arc(px, py, radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        if (view === 'communities' && idx === 0) {
          ctx.font = 'bold 12px system-ui, sans-serif';
          ctx.textAlign = 'center';
          ctx.lineWidth = 3;
          ctx.strokeStyle = 'rgba(0,0,0,0.8)';
          ctx.strokeText(tribe.name, px, py - radius - 5);
          ctx.fillStyle = '#fff';
          ctx.fillText(tribe.name, px, py - radius - 5);
        }
      });
    }
  }
}
