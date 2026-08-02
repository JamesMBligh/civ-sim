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
  const simulateBtn = document.getElementById('simulate-btn');
  const tribesSection = document.getElementById('tribes-section');
  const tribesPanel = document.getElementById('tribes-panel');
  const eventsLog = document.getElementById('events-log');
  const zoomInBtn = document.getElementById('zoom-in-btn');
  const zoomOutBtn = document.getElementById('zoom-out-btn');
  const zoomResetBtn = document.getElementById('zoom-reset-btn');
  const zoomLevelEl = document.getElementById('zoom-level');

  let world = null;
  let camera = createCamera();

  function generate(seed) {
    const t0 = performance.now();
    world = createWorld(seed);
    const ms = performance.now() - t0;
    seedInput.value = seed;
    simulateBtn.textContent = 'Found tribes & simulate 10 years';
    tribesSection.style.display = 'none';
    if (viewSelect.value === 'communities') viewSelect.value = 'satellite';
    camera = createCamera();
    refreshView();
    renderStats(ms);
  }

  function simulate() {
    const firstRun = !world.tribes;
    if (firstRun) foundTribes(world);
    simulateYears(world, 10);
    simulateBtn.textContent = 'Simulate 10 more years';
    tribesSection.style.display = '';
    if (firstRun) viewSelect.value = 'communities';
    refreshView();
    renderStats();
    renderTribes();
    renderEvents();
  }

  function renderTribes() {
    const kmPerTile = world.kmPerTile;
    tribesPanel.innerHTML = world.tribes
      .slice()
      .sort((a, b) => tribePopulation(world, b) - tribePopulation(world, a))
      .map((t) => {
        const pop = Math.round(tribePopulation(world, t));
        const camps = tribeSettlements(world, t.id).length;
        const territory = ((t.territoryTiles || 0) * kmPerTile * kmPerTile).toLocaleString();
        const meta = t.alive
          ? `${pop.toLocaleString()} people · ${camps} camp${camps > 1 ? 's' : ''}<br>${territory} km²`
          : 'died out';
        return `<div class="tribe-row${t.alive ? '' : ' dead'}">` +
          `<span class="swatch" style="background: ${t.color}"></span>` +
          `<span>${t.name}</span>` +
          `<span class="tribe-meta">${meta}</span></div>`;
      })
      .join('');
  }

  function renderEvents() {
    eventsLog.innerHTML = world.events
      .slice(-60)
      .reverse()
      .map((e) => `<div><span class="ev-year">Yr ${e.year}</span> ${e.text}</div>`)
      .join('');
  }

  // Full refresh: repaints the tile layer too (world or simulation changed).
  function refreshView() {
    const view = viewSelect.value;
    renderWorld(world, canvas, view, camera, true);
    renderLegends(view);
    updateZoomUI();
  }

  // Cheap refresh for panning and zooming: reuses the cached tile layer.
  function redraw() {
    renderWorld(world, canvas, viewSelect.value, camera, false);
    updateZoomUI();
  }

  function updateZoomUI() {
    zoomLevelEl.textContent = `${camera.zoom.toFixed(1)}×`;
    zoomOutBtn.disabled = camera.zoom <= MIN_ZOOM;
    zoomInBtn.disabled = camera.zoom >= MAX_ZOOM;
    canvas.classList.toggle('zoomed', camera.zoom > MIN_ZOOM);
  }

  // Zoom about a fixed point on screen (the cursor, or the view centre),
  // so whatever you're looking at stays put.
  function zoomBy(factor, anchorScreen) {
    const before = anchorScreen
      ? screenToTile(world, camera, anchorScreen.x, anchorScreen.y)
      : null;
    camera.zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, camera.zoom * factor));
    clampCamera(world, camera);
    if (before) {
      const after = screenToTile(world, camera, anchorScreen.x, anchorScreen.y);
      camera.cx += before.x - after.x;
      camera.cy += before.y - after.y;
      clampCamera(world, camera);
    }
    redraw();
  }

  // Pointer position in canvas pixels (the canvas is scaled by CSS).
  function canvasPoint(ev) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: (ev.clientX - rect.left) * (canvas.width / rect.width),
      y: (ev.clientY - rect.top) * (canvas.height / rect.height),
    };
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
    } else if (view === 'communities') {
      legendATitle.textContent = 'Communities';
      terrainLegend.innerHTML = world.tribes
        ? world.tribes.map((t) =>
            `<div class="legend-row${t.alive ? '' : '" style="opacity:0.45'}">` +
            `<span class="swatch" style="background: ${t.color}"></span>` +
            `<span>${t.name}</span></div>`).join('')
        : '<div class="legend-row">No tribes yet — press the simulate button.</div>';
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
    if (world.tribes) {
      rows.push(['Year', world.year]);
      const alive = world.tribes.filter((t) => t.alive);
      const totalPop = Math.round(world.settlements.reduce((sum, s) => sum + s.pop, 0));
      rows.push(['Tribes', `${alive.length} of ${world.tribes.length}`]);
      rows.push(['Settlements', world.settlements.length]);
      rows.push(['Population', totalPop.toLocaleString()]);
    }
    rows.push(['Land area', `${s.landAreaKm2.toLocaleString()} km²`]);
    rows.push(['Land cover', `${s.landPercent.toFixed(1)}%`]);
    const riverTiles = s.terrainCounts[TERRAIN.RIVER] || 0;
    rows.push(['River tiles', riverTiles.toLocaleString()]);
    const resTotal = Object.values(s.resourceCounts).reduce((a, b) => a + b, 0);
    rows.push(['Resource sites', resTotal.toLocaleString()]);
    if (genMs !== undefined) rows.push(['Generated in', `${genMs.toFixed(0)} ms`]);

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
    const settlement = world.tribes ? settlementAt(world, tile.x, tile.y) : null;
    if (settlement) {
      const tribe = world.tribes[settlement.tribeId];
      parts.push(`<strong>${settlement.name}</strong> — ${Math.round(settlement.pop)} people` +
        (tribe ? ` of ${tribe.name}` : '') +
        ` (founded Yr ${settlement.foundedYear})`);
    }
    if (world.influenceOwner) {
      const ownerId = world.influenceOwner[tile.y * world.size + tile.x];
      if (ownerId >= 0 && world.tribes[ownerId]) {
        parts.push(`Territory of <strong>${world.tribes[ownerId].name}</strong>`);
      }
    }
    return parts.join('<br>');
  }

  let panning = null;

  canvas.addEventListener('mousemove', (ev) => {
    if (!world) return;
    const p = canvasPoint(ev);

    if (panning) {
      const pxPerTile = screenPxPerTile(world, camera);
      camera.cx = panning.camX + (panning.x - p.x) / pxPerTile;
      camera.cy = panning.camY + (panning.y - p.y) / pxPerTile;
      clampCamera(world, camera);
      redraw();
      return;
    }

    const t = screenToTile(world, camera, p.x, p.y);
    tileInfo.innerHTML = describeTile(tileAt(world, Math.floor(t.x), Math.floor(t.y)));
  });

  canvas.addEventListener('mousedown', (ev) => {
    if (!world || camera.zoom <= MIN_ZOOM) return;
    const p = canvasPoint(ev);
    panning = { x: p.x, y: p.y, camX: camera.cx, camY: camera.cy };
    canvas.classList.add('panning');
    ev.preventDefault();
  });

  window.addEventListener('mouseup', () => {
    panning = null;
    canvas.classList.remove('panning');
  });

  canvas.addEventListener('wheel', (ev) => {
    if (!world) return;
    ev.preventDefault();
    const factor = ev.deltaY < 0 ? 1.2 : 1 / 1.2;
    zoomBy(factor, canvasPoint(ev));
  }, { passive: false });

  canvas.addEventListener('mouseleave', () => {
    tileInfo.textContent = 'Hover over the map to inspect a tile.';
  });

  zoomInBtn.addEventListener('click', () => zoomBy(1.5));
  zoomOutBtn.addEventListener('click', () => zoomBy(1 / 1.5));
  zoomResetBtn.addEventListener('click', () => {
    camera = createCamera();
    redraw();
  });

  generateBtn.addEventListener('click', () => {
    const seed = seedInput.value.trim() || randomSeedString();
    generate(seed);
  });

  randomBtn.addEventListener('click', () => generate(randomSeedString()));

  simulateBtn.addEventListener('click', () => {
    if (world) simulate();
  });

  seedInput.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') generateBtn.click();
  });

  viewSelect.addEventListener('change', () => {
    if (world) refreshView();
  });

  generate(randomSeedString());
})();
