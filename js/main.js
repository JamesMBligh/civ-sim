// App entry point: wires the UI to world generation and rendering.

(function () {
  const canvas = document.getElementById('map-canvas');
  const seedInput = document.getElementById('seed-input');
  const generateBtn = document.getElementById('generate-btn');
  const randomBtn = document.getElementById('random-btn');
  const viewSelect = document.getElementById('view-select');
  const tileInfo = document.getElementById('tile-info');
  const terrainLegend = document.getElementById('terrain-legend');
  const resourceLegend = document.getElementById('resource-legend');
  const legendATitle = document.getElementById('legend-a-title');
  const legendBTitle = document.getElementById('legend-b-title');
  const statsEl = document.getElementById('stats');

  let world = null;

  function generate(seed) {
    const t0 = performance.now();
    world = createWorld(seed);
    const ms = performance.now() - t0;
    seedInput.value = seed;
    refreshView();
    renderStats(ms);
  }

  function refreshView() {
    const view = viewSelect.value;
    renderWorld(world, canvas, view);
    renderLegends(view);
  }

  function terrainSwatchRows() {
    return Object.entries(TERRAIN_LABELS).map(([type, label]) => {
      const [r, g, b] = TERRAIN_COLORS[type];
      return `<div class="legend-row">` +
        `<span class="swatch" style="background: rgb(${r},${g},${b})"></span>` +
        `<span>${label}</span></div>`;
    }).join('');
  }

  function resourceSwatchRows(category) {
    return Object.values(RESOURCES)
      .filter((res) => !category || res.category === category)
      .map((res) =>
        `<div class="legend-row">` +
        `<span class="swatch" style="background: ${res.color}; border-radius: 50%"></span>` +
        `<span>${res.name}</span></div>`)
      .join('');
  }

  function rampLegend(stops, minLabel, maxLabel) {
    const colors = stops.map(([r, g, b]) => `rgb(${r},${g},${b})`).join(', ');
    return `<div class="ramp-bar" style="background: linear-gradient(to right, ${colors})"></div>` +
      `<div class="ramp-labels"><span>${minLabel}</span><span>${maxLabel}</span></div>`;
  }

  // The two sidebar legend sections adapt to the active view.
  function renderLegends(view) {
    if (view === 'rainfall') {
      legendATitle.textContent = 'Avg annual rainfall';
      terrainLegend.innerHTML = rampLegend(RAINFALL_RAMP,
        `${RAINFALL_RANGE.min} mm`, `${RAINFALL_RANGE.max} mm`);
      legendBTitle.textContent = '';
      resourceLegend.innerHTML = '';
    } else if (view === 'temperature') {
      legendATitle.textContent = 'Avg annual temperature';
      terrainLegend.innerHTML = rampLegend(TEMPERATURE_RAMP,
        `${TEMPERATURE_RANGE.min}°C`, `${TEMPERATURE_RANGE.max}°C`);
      legendBTitle.textContent = '';
      resourceLegend.innerHTML = '';
    } else if (view === 'natural') {
      legendATitle.textContent = 'Natural resources';
      terrainLegend.innerHTML = resourceSwatchRows('natural');
      legendBTitle.textContent = '';
      resourceLegend.innerHTML = '';
    } else if (view === 'minerals') {
      legendATitle.textContent = 'Mineral resources';
      terrainLegend.innerHTML = resourceSwatchRows('mineral');
      legendBTitle.textContent = '';
      resourceLegend.innerHTML = '';
    } else {
      // satellite / elevation
      legendATitle.textContent = 'Terrain';
      terrainLegend.innerHTML = terrainSwatchRows();
      legendBTitle.textContent = 'Resources';
      resourceLegend.innerHTML = resourceSwatchRows();
    }
  }

  function renderStats(genMs) {
    const s = world.stats;
    const rows = [];
    rows.push(['Land area', `${s.landAreaKm2.toLocaleString()} km²`]);
    rows.push(['Land cover', `${s.landPercent.toFixed(1)}%`]);
    const riverTiles = s.terrainCounts[TERRAIN.RIVER] || 0;
    rows.push(['River tiles', riverTiles.toLocaleString()]);
    const resTotal = Object.values(s.resourceCounts).reduce((a, b) => a + b, 0);
    rows.push(['Resource sites', resTotal.toLocaleString()]);
    rows.push(['Generated in', `${genMs.toFixed(0)} ms`]);

    statsEl.innerHTML = rows
      .map(([k, v]) => `<div class="stat-row"><span>${k}</span><span class="value">${v}</span></div>`)
      .join('');
  }

  function describeTile(tile) {
    if (!tile) return 'Hover over the map to inspect a tile.';
    const parts = [];
    parts.push(`<strong>${TERRAIN_LABELS[tile.terrain]}</strong> at (${tile.x}, ${tile.y})`);
    const meters = elevationToMeters(tile.elevation);
    if (meters >= 0) parts.push(`Elevation ≈ ${meters} m`);
    parts.push(`Rainfall ≈ ${moistureToRainfallMm(tile.moisture).toLocaleString()} mm/yr`);
    parts.push(`Avg temp ≈ ${tile.temperature.toFixed(1)}°C`);
    if (tile.resource) parts.push(`Resource: <strong>${tile.resource.name}</strong>`);
    return parts.join('<br>');
  }

  canvas.addEventListener('mousemove', (ev) => {
    if (!world) return;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const x = Math.floor(((ev.clientX - rect.left) * scaleX) / TILE_PX);
    const y = Math.floor(((ev.clientY - rect.top) * scaleY) / TILE_PX);
    tileInfo.innerHTML = describeTile(tileAt(world, x, y));
  });

  canvas.addEventListener('mouseleave', () => {
    tileInfo.textContent = 'Hover over the map to inspect a tile.';
  });

  generateBtn.addEventListener('click', () => {
    const seed = seedInput.value.trim() || randomSeedString();
    generate(seed);
  });

  randomBtn.addEventListener('click', () => generate(randomSeedString()));

  seedInput.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') generateBtn.click();
  });

  viewSelect.addEventListener('change', () => {
    if (world) refreshView();
  });

  generate(randomSeedString());
})();
