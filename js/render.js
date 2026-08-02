// Canvas rendering. The world's tiles are painted once into an offscreen
// base layer at native resolution; the visible canvas then shows a
// camera-defined window onto that layer, magnified up to MAX_ZOOM.
// Markers and labels are drawn afterwards in screen space so they stay
// crisp and legible at every zoom level.

const TILE_PX = 3;          // base-layer pixels per tile at 1x
const VIEW_PX = 768;        // logical size of the visible canvas
const MIN_ZOOM = 1;
const MAX_ZOOM = 5;

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

// --- Camera ---------------------------------------------------------------
// The camera is a magnification plus a centre point in tile coordinates.

function createCamera() {
  return { zoom: 1, cx: WORLD_SIZE / 2, cy: WORLD_SIZE / 2 };
}

function clampCamera(world, camera) {
  camera.zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, camera.zoom));
  // Half the visible window, in tiles.
  const half = world.size / camera.zoom / 2;
  camera.cx = Math.max(half, Math.min(world.size - half, camera.cx));
  camera.cy = Math.max(half, Math.min(world.size - half, camera.cy));
  return camera;
}

// Maps between base-layer pixels and canvas pixels for the current camera.
function cameraTransform(world, camera) {
  const worldPx = world.size * TILE_PX;
  const srcSize = worldPx / camera.zoom;
  const srcX = Math.max(0, Math.min(worldPx - srcSize, camera.cx * TILE_PX - srcSize / 2));
  const srcY = Math.max(0, Math.min(worldPx - srcSize, camera.cy * TILE_PX - srcSize / 2));
  return { srcX, srcY, srcSize, scale: VIEW_PX / srcSize };
}

// Canvas pixel -> tile coordinate (fractional).
function screenToTile(world, camera, screenX, screenY) {
  const t = cameraTransform(world, camera);
  return {
    x: (screenX / t.scale + t.srcX) / TILE_PX,
    y: (screenY / t.scale + t.srcY) / TILE_PX,
  };
}

// How many canvas pixels one tile occupies at the current zoom.
function screenPxPerTile(world, camera) {
  return cameraTransform(world, camera).scale * TILE_PX;
}

// --- Base layer -----------------------------------------------------------
// Painting 65k tiles is the expensive part, so the result is cached and
// reused while panning and zooming. Callers pass rebuildBase = true after
// the world or the simulation state changes.

let baseLayer = { canvas: null, key: null };

function invalidateBaseLayer() {
  baseLayer.key = null;
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

// What settlement actually looks like from above: built-up ground at the
// core, worked fields around it. Returns per-tile intensities.
function computeVisibleDevelopment(world) {
  const { size } = world;
  const urban = new Float32Array(size * size);
  const fields = new Float32Array(size * size);
  if (!world.settlements || world.settlements.length === 0) {
    return { urban, fields };
  }
  computeFoodValues(world); // for farmValue: fields only appear on arable land

  for (const s of world.settlements) {
    const tribe = world.tribes[s.tribeId];
    if (!tribe || !tribe.alive) continue;

    // Built-up core: grows with population, visible from ~a village up.
    const uR = Math.min(3, 0.6 + Math.sqrt(s.pop) / 25);
    const uStrength = Math.min(1, s.pop / 500);
    const uri = Math.ceil(uR);
    for (let dy = -uri; dy <= uri; dy++) {
      for (let dx = -uri; dx <= uri; dx++) {
        const x = s.x + dx;
        const y = s.y + dy;
        if (x < 0 || y < 0 || x >= size || y >= size) continue;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d > uR) continue;
        const i = y * size + x;
        if (isWater(world.terrain[i])) continue;
        urban[i] = Math.max(urban[i], uStrength * (1 - d / (uR + 0.5)));
      }
    }

    // Field patchwork: only for farming peoples, only on arable tiles,
    // hugging the settlement rather than blanketing the region.
    if (tribe.progress.techs.has('agriculture') && !s.proto) {
      const fR = Math.min(6, 1.5 + Math.sqrt(s.pop) / 14);
      const fStrength = Math.min(1, s.pop / 400);
      const fri = Math.ceil(fR);
      for (let dy = -fri; dy <= fri; dy++) {
        for (let dx = -fri; dx <= fri; dx++) {
          const x = s.x + dx;
          const y = s.y + dy;
          if (x < 0 || y < 0 || x >= size || y >= size) continue;
          const d = Math.sqrt(dx * dx + dy * dy);
          if (d > fR) continue;
          const i = y * size + x;
          if (world.farmValue[i] < 8 || isWater(world.terrain[i])) continue;
          fields[i] = Math.max(fields[i], fStrength * Math.pow(1 - d / (fR + 0.5), 1.4));
        }
      }
    }
  }
  return { urban, fields };
}

function buildBaseLayer(world, view) {
  const { size } = world;
  const worldPx = size * TILE_PX;

  let canvas = baseLayer.canvas;
  if (!canvas || canvas.width !== worldPx) {
    canvas = document.createElement('canvas');
    canvas.width = worldPx;
    canvas.height = worldPx;
    baseLayer.canvas = canvas;
  }
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(worldPx, worldPx);
  const data = img.data;

  const resourceView = view === 'minerals' || view === 'natural';
  const tribeRgb = (world.tribes || []).map((t) => hexToRgb(t.color));

  // The satellite view shows civilization as it would actually look from
  // above: built-up cores and worked fields, part of the landscape itself.
  const dev = view === 'satellite' ? computeVisibleDevelopment(world) : null;

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
      } else if (view === 'communities' || view === 'development') {
        // Muted satellite base tinted by whichever tribe holds the tile —
        // tribe colour for Communities, era colour for Development.
        [r, g, b] = satelliteColor(world, x, y, i);
        const lum = 0.3 * r + 0.59 * g + 0.11 * b;
        const mix = sea ? 0.4 : 0.65;
        r = (r + (lum - r) * mix) * 0.8;
        g = (g + (lum - g) * mix) * 0.8;
        b = (b + (lum - b) * mix) * 0.8;

        const ownerId = world.influenceOwner ? world.influenceOwner[i] : -1;
        if (ownerId >= 0 && world.tribes && world.tribes[ownerId]) {
          let tint = null;
          if (view === 'communities') {
            tint = tribeRgb[ownerId];
          } else {
            const era = tribeEra(world.tribes[ownerId]);
            tint = hexToRgb(ERA_COLORS[era]);
          }
          if (tint) {
            const a = 0.2 + world.influenceStrength[i] * 0.45;
            r = r * (1 - a) + tint[0] * a;
            g = g * (1 - a) + tint[1] * a;
            b = b * (1 - a) + tint[2] * a;
          }
        }
      } else {
        // satellite
        [r, g, b] = satelliteColor(world, x, y, i);

        // Worked fields: a tan patchwork over arable land, hashed per
        // tile so adjacent fields read as separate plots.
        if (dev && dev.fields[i] > 0.04) {
          const h = (i * 2654435761) >>> 0;
          const vary = ((h & 31) - 16) * 1.4;
          const a = Math.min(0.68, dev.fields[i] * 0.75);
          r = r * (1 - a) + (196 + vary) * a;
          g = g * (1 - a) + (176 + vary * 0.8) * a;
          b = b * (1 - a) + (96 + vary * 0.5) * a;
        }
        // Built-up ground: a distinct earthen brown, strengthening with
        // population so towns read as towns against any terrain.
        if (dev && dev.urban[i] > 0.04) {
          const a = Math.min(0.92, dev.urban[i]);
          r = r * (1 - a) + 122 * a;
          g = g * (1 - a) + 104 * a;
          b = b * (1 - a) + 86 * a;
        }
      }

      // Fill the TILE_PX x TILE_PX block
      for (let py = 0; py < TILE_PX; py++) {
        let p = ((y * TILE_PX + py) * worldPx + x * TILE_PX) * 4;
        for (let px = 0; px < TILE_PX; px++) {
          data[p] = r; data[p + 1] = g; data[p + 2] = b; data[p + 3] = 255;
          p += 4;
        }
      }
    }
  }

  ctx.putImageData(img, 0, 0);
  baseLayer.key = `${world.seed}|${view}`;
  return canvas;
}

// --- Frame ----------------------------------------------------------------

function renderWorld(world, canvas, view = 'satellite', camera = null, rebuildBase = true, overlays = {}) {
  camera = clampCamera(world, camera || createCamera());

  const key = `${world.seed}|${view}`;
  if (rebuildBase || baseLayer.key !== key) buildBaseLayer(world, view);

  // Only resize when needed — assigning width clears and reallocates.
  if (canvas.width !== VIEW_PX || canvas.height !== VIEW_PX) {
    canvas.width = VIEW_PX;
    canvas.height = VIEW_PX;
  }
  const ctx = canvas.getContext('2d');
  const t = cameraTransform(world, camera);

  // Tiles are meant to look like tiles — no smoothing when magnified.
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(baseLayer.canvas,
    t.srcX, t.srcY, t.srcSize, t.srcSize,
    0, 0, VIEW_PX, VIEW_PX);
  ctx.imageSmoothingEnabled = true;

  const toScreenX = (tileX) => ((tileX + 0.5) * TILE_PX - t.srcX) * t.scale;
  const toScreenY = (tileY) => ((tileY + 0.5) * TILE_PX - t.srcY) * t.scale;

  // Visible tile window, with a margin so markers straddling the edge
  // still get drawn.
  const left = t.srcX / TILE_PX - 1;
  const top = t.srcY / TILE_PX - 1;
  const right = (t.srcX + t.srcSize) / TILE_PX + 1;
  const bottom = (t.srcY + t.srcSize) / TILE_PX + 1;
  const visible = (x, y) => x >= left && x <= right && y >= top && y <= bottom;

  const resourceView = view === 'minerals' || view === 'natural';

  // Resource markers: an optional overlay on the satellite view, a single
  // filtered category (drawn larger, with an outline) on the resource
  // views. They mark individual tiles, so they scale with the tiles.
  if ((view === 'satellite' && overlays.resources) || resourceView) {
    const filter = view === 'minerals' ? 'mineral'
      : view === 'natural' ? 'natural' : null;
    const radius = (resourceView ? TILE_PX * 0.75 : TILE_PX * 0.42) * t.scale;
    const { size } = world;

    for (let y = Math.max(0, Math.floor(top)); y < Math.min(size, bottom); y++) {
      for (let x = Math.max(0, Math.floor(left)); x < Math.min(size, right); x++) {
        const res = world.resources[y * size + x];
        if (!res) continue;
        if (filter && res.category !== filter) continue;
        ctx.fillStyle = res.color;
        ctx.beginPath();
        ctx.arc(toScreenX(x), toScreenY(y), radius, 0, Math.PI * 2);
        ctx.fill();
        if (resourceView) {
          ctx.strokeStyle = 'rgba(0,0,0,0.6)';
          ctx.lineWidth = Math.max(0.8, 0.8 * t.scale);
          ctx.stroke();
        }
      }
    }
  }

  // Settlements (places) and bands (nomadic presences) are drawn on the
  // communities and development views, and on satellite as an optional
  // overlay — by default the satellite shows only what is physically
  // visible. Settled markers are solid and scale with population; bands
  // are small open rings — people passing through, not places.
  const peopleView = (view === 'satellite' && overlays.settlements) ||
    view === 'communities' || view === 'development';
  if (peopleView && (world.settlements || world.bands)) {
    const markerScale = Math.sqrt(camera.zoom);
    const markerRadius = (pop) => (2.5 + Math.sqrt(pop) / 5) * markerScale;

    for (const s of world.settlements || []) {
      const tribe = world.tribes[s.tribeId];
      if (!tribe || !tribe.alive || !visible(s.x, s.y)) continue;
      ctx.fillStyle = tribe.color;
      ctx.strokeStyle = 'rgba(0,0,0,0.85)';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.arc(toScreenX(s.x), toScreenY(s.y),
        Math.min(14 * markerScale, markerRadius(s.pop)), 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }

    for (const band of world.bands || []) {
      const tribe = world.tribes[band.tribeId];
      if (!tribe || !tribe.alive || !visible(band.x, band.y)) continue;
      ctx.strokeStyle = tribe.color;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.arc(toScreenX(band.x), toScreenY(band.y), 2.2 * markerScale, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Labels keep a constant size on screen, the way a map's do.
    const label = (text, screenX, screenY, font) => {
      ctx.font = font;
      ctx.textAlign = 'center';
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(0,0,0,0.8)';
      ctx.strokeText(text, screenX, screenY);
      ctx.fillStyle = '#fff';
      ctx.fillText(text, screenX, screenY);
    };

    if (view === 'communities' || view === 'development') {
      for (const tribe of world.tribes) {
        if (!tribe.alive) continue;
        // Settled peoples are labelled at their chief settlement; nomads
        // at their largest band.
        let anchor = tribeChiefSettlement(world, tribe);
        if (!anchor) {
          for (const band of world.bands || []) {
            if (band.tribeId === tribe.id && (!anchor || band.pop > anchor.pop)) {
              anchor = band;
            }
          }
        }
        if (!anchor || !visible(anchor.x, anchor.y)) continue;
        const radius = markerRadius(anchor.pop);
        label(tribe.name, toScreenX(anchor.x), toScreenY(anchor.y) - radius - 5,
          'bold 12px system-ui, sans-serif');
      }
    }

    // Zoomed in far enough to read the map in detail: name the places
    // themselves, which is the point of having settlements as entities.
    if (camera.zoom >= 2.5) {
      for (const s of world.settlements || []) {
        const tribe = world.tribes[s.tribeId];
        if (!tribe || !tribe.alive || !visible(s.x, s.y)) continue;
        const radius = Math.min(14 * markerScale, markerRadius(s.pop));
        label(s.name, toScreenX(s.x), toScreenY(s.y) + radius + 12,
          '11px system-ui, sans-serif');
      }
    }
  }
}
