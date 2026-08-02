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

  const tribeInspector = document.getElementById('tribe-inspector');

  let world = null;
  let camera = createCamera();
  let selectedTribeId = null;
  // Satellite overlays: markers off by default (the view shows what is
  // physically visible from above); roads ARE physical, so they default
  // on, Google Maps style.
  const overlays = { resources: false, settlements: false, roads: true };

  function formatPop(n) {
    n = Math.round(n);
    if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
    if (n >= 10000) return (n / 1000).toFixed(1) + 'k';
    return n.toLocaleString();
  }

  function generate(seed) {
    const t0 = performance.now();
    world = createWorld(seed);
    const ms = performance.now() - t0;
    seedInput.value = seed;
    simulateBtn.textContent = 'Found tribes & simulate 10 years';
    tribesSection.style.display = 'none';
    selectedTribeId = null;
    if (viewSelect.value === 'communities' || viewSelect.value === 'development') {
      viewSelect.value = 'satellite';
    }
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
    tribesPanel.innerHTML = world.tribes
      .slice()
      .sort((a, b) => totalTribePop(world, b) - totalTribePop(world, a))
      .map((t) => {
        const pop = totalTribePop(world, t);
        const posture = computePosture(t.traits);
        const nomadic = tribeIsNomadic(world, t);
        const places = nomadic
          ? `${tribeBands(world, t.id).length} bands`
          : `${tribeSettlements(world, t.id).length} settlement${tribeSettlements(world, t.id).length > 1 ? 's' : ''}`;
        const meta = t.alive
          ? `${formatPop(pop)} people<br>${places}`
          : 'died out';
        const badge = t.alive
          ? `<span class="badge">${ERA_LABELS[tribeEra(t)]}</span> ${dominantPostureGlyph(posture)}`
          : '';
        return `<div class="tribe-row${t.alive ? '' : ' dead'}${t.id === selectedTribeId ? ' selected' : ''}" data-tribe="${t.id}">` +
          `<span class="swatch" style="background: ${t.color}"></span>` +
          `<span>${t.name}</span> ${badge}` +
          `<span class="tribe-meta">${meta}</span></div>`;
      })
      .join('');

    for (const row of tribesPanel.querySelectorAll('.tribe-row')) {
      row.addEventListener('click', () => {
        const id = Number(row.dataset.tribe);
        selectedTribeId = selectedTribeId === id ? null : id;
        renderTribes();
        renderInspector();
      });
    }
    renderInspector();
  }

  function renderInspector() {
    if (selectedTribeId === null || !world.tribes || !world.tribes[selectedTribeId]) {
      tribeInspector.style.display = 'none';
      return;
    }
    const t = world.tribes[selectedTribeId];
    const p = t.progress;
    const posture = computePosture(t.traits);
    const era = ERA_LABELS[tribeEra(t)];
    let arch = t.archetype === 'random' ? 'A people of their own kind'
      : `${ARCHETYPES[t.archetype].label} archetype`;
    if (t.parentId !== undefined && world.tribes[t.parentId]) {
      arch = `Broke away from ${world.tribes[t.parentId].name}`;
    }

    const traitRows = TRAIT_KEYS.map((key) =>
      `<div class="trait-row"><span class="trait-name">${TRAIT_LABELS[key]}</span>` +
      `<span class="trait-bar"><div style="width:${(t.traits[key] * 100).toFixed(0)}%; background:${t.color}"></div></span></div>`
    ).join('');

    const techNames = [...p.techs].filter((id) => TECHS[id])
      .map((id) => TECHS[id].name);
    const target = p.target && TECHS[p.target] ? TECHS[p.target].name : '—';

    const relations = Object.entries(world.relations || {})
      .filter(([key]) => key.split('-').map(Number).includes(t.id))
      .map(([key, rel]) => {
        const otherId = key.split('-').map(Number).find((id) => id !== t.id);
        const other = world.tribes[otherId];
        return other && other.alive ? `${other.name}: ${rel.stance}` : null;
      })
      .filter(Boolean);

    tribeInspector.style.display = '';
    tribeInspector.innerHTML =
      `<h3 style="color:${t.color}">${t.name}${t.alive ? '' : ' †'}</h3>` +
      `<div class="insp-sub">${arch} · ${era} · ${GOVERNANCE_LABELS[p.governance]}</div>` +
      `<div class="posture-row">` +
      `<span>⚔ ${(posture.military * 100).toFixed(0)}%</span>` +
      `<span>⚖ ${(posture.trade * 100).toFixed(0)}%</span>` +
      `<span>📜 ${(posture.learning * 100).toFixed(0)}%</span></div>` +
      traitRows +
      `<div class="insp-section"><strong>Unity:</strong> ${(100 * (t.unity ?? 1)).toFixed(0)}%${
        (t.unity ?? 1) < 0.35 ? ' — on the brink of civil war' : ''}</div>` +
      `<div class="insp-section"><strong>Leadership:</strong> ${
        (t.leaderBias || 0) > 0.12 ? 'war-hungry'
          : (t.leaderBias || 0) < -0.12 ? 'peace-minded' : 'steady'
      }${t.tributeTo !== undefined && world.tribes[t.tributeTo]
        ? ` · pays tribute to ${world.tribes[t.tributeTo].name}` : ''}</div>` +
      `<div class="insp-section"><strong>Technologies:</strong> ${techNames.join(', ') || 'none'}</div>` +
      `<div class="insp-section"><strong>Researching:</strong> ${target}</div>` +
      `<div class="insp-section"><strong>Art:</strong> ${ART_STAGES[p.artStage]} · ` +
      `<strong>Philosophy:</strong> ${PHIL_STAGES[p.philStage]}</div>` +
      (relations.length
        ? `<div class="insp-section"><strong>Relations:</strong> ${relations.join(' · ')}</div>`
        : '');
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
    renderWorld(world, canvas, view, camera, true, overlays);
    renderLegends(view);
    updateZoomUI();
  }

  // Cheap refresh for panning and zooming: reuses the cached tile layer.
  function redraw() {
    renderWorld(world, canvas, viewSelect.value, camera, false, overlays);
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
    } else if (view === 'development') {
      legendATitle.textContent = 'Development (era)';
      terrainLegend.innerHTML = ERAS.map((era) =>
        `<div class="legend-row">` +
        `<span class="swatch" style="background: ${ERA_COLORS[era]}"></span>` +
        `<span>${ERA_LABELS[era]}</span></div>`).join('');
      legendBTitle.textContent = '';
      resourceLegend.innerHTML = '';
    } else if (view === 'satellite') {
      legendATitle.textContent = 'Terrain';
      terrainLegend.innerHTML = terrainSwatchRows() +
        `<div class="legend-row"><span class="swatch" style="background: rgb(142,132,118)"></span><span>Built-up ground</span></div>` +
        `<div class="legend-row"><span class="swatch" style="background: rgb(188,172,104)"></span><span>Worked fields</span></div>`;
      legendBTitle.textContent = 'Overlays';
      resourceLegend.innerHTML =
        `<label class="legend-row toggle-row"><input type="checkbox" id="toggle-roads"${overlays.roads ? ' checked' : ''}> Roads &amp; tracks</label>` +
        `<label class="legend-row toggle-row"><input type="checkbox" id="toggle-resources"${overlays.resources ? ' checked' : ''}> Resource markers</label>` +
        `<label class="legend-row toggle-row"><input type="checkbox" id="toggle-settlements"${overlays.settlements ? ' checked' : ''}> Settlement markers</label>` +
        (overlays.resources ? resourceSwatchRows() : '');
      document.getElementById('toggle-roads').addEventListener('change', (ev) => {
        overlays.roads = ev.target.checked;
        redraw();
      });
      document.getElementById('toggle-resources').addEventListener('change', (ev) => {
        overlays.resources = ev.target.checked;
        redraw();
        renderLegends('satellite');
      });
      document.getElementById('toggle-settlements').addEventListener('change', (ev) => {
        overlays.settlements = ev.target.checked;
        redraw();
      });
    } else if (view === 'trade') {
      legendATitle.textContent = 'Trade';
      const line = (color, label) =>
        `<div class="legend-row"><span class="swatch" style="background:${color}; height:4px; border-radius:2px"></span><span>${label}</span></div>`;
      terrainLegend.innerHTML =
        line('rgba(217,180,74,0.9)', 'Internal route (flow-weighted)') +
        line('rgba(95,201,232,0.9)', 'Route between peoples') +
        line('rgb(96,72,46)', 'Road') +
        line('rgb(168,168,175)', 'Bridge') +
        line('rgba(120,185,220,0.9)', 'Ferry / barge lane') +
        line('rgba(126,102,70,0.6)', 'Track (worn by use)');
      const routes = world.routes || [];
      const external = routes.filter((r) => r.external).length;
      legendBTitle.textContent = 'Network';
      resourceLegend.innerHTML =
        `<div class="stat-row"><span>Active routes</span><span class="value">${routes.length}</span></div>` +
        `<div class="stat-row"><span>Between peoples</span><span class="value">${external}</span></div>` +
        `<div class="stat-row"><span>Road tiles</span><span class="value">${world.roadLevel ? Array.from(world.roadLevel).filter((v) => v === 2).length : 0}</span></div>`;
    } else {
      // elevation
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
      const totalPop = alive.reduce((sum, t) => sum + totalTribePop(world, t), 0);
      rows.push(['Tribes', `${alive.length} of ${world.tribes.length}`]);
      if (world.bands.length) rows.push(['Nomad bands', world.bands.length]);
      if (world.settlements.length) rows.push(['Settlements', world.settlements.length]);
      rows.push(['Population', formatPop(totalPop)]);
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
      parts.push(`<strong>${settlement.name}</strong> — ${formatPop(settlement.pop)} people` +
        (tribe ? ` of ${tribe.name}` : '') +
        ` (founded Yr ${settlement.foundedYear})`);
      const inc = world.settlementIncome && world.settlementIncome.get(settlement.id);
      if (inc && (inc.trade + inc.market + inc.mine) > 0.5) {
        parts.push(`Economy — trade ${inc.trade.toFixed(0)}, market ${inc.market.toFixed(0)}, mines ${inc.mine.toFixed(0)}`);
      }
    } else if (world.tribes) {
      const band = bandAt(world, tile.x, tile.y);
      if (band) {
        const tribe = world.tribes[band.tribeId];
        parts.push(`A wandering band of <strong>${tribe ? tribe.name : '?'}</strong> — ` +
          `${Math.round(band.pop)} people`);
      }
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

  // --- Parameters tab -------------------------------------------------------

  const tabWorld = document.getElementById('tab-world');
  const tabParams = document.getElementById('tab-params');
  const tabBtnWorld = document.getElementById('tab-btn-world');
  const tabBtnParams = document.getElementById('tab-btn-params');
  const paramsPanel = document.getElementById('params-panel');

  function selectTab(which) {
    const params = which === 'params';
    tabWorld.style.display = params ? 'none' : '';
    tabParams.style.display = params ? '' : 'none';
    tabBtnWorld.classList.toggle('active', !params);
    tabBtnParams.classList.toggle('active', params);
  }
  tabBtnWorld.addEventListener('click', () => selectTab('world'));
  tabBtnParams.addEventListener('click', () => selectTab('params'));

  // Format a default so 0.0015 doesn't render as 0.001500...
  function fmtParam(v) {
    return String(parseFloat(v.toPrecision(6)));
  }

  function renderParams() {
    const groups = [];
    const byGroup = new Map();
    for (const def of PARAM_DEFS) {
      if (!byGroup.has(def.group)) {
        byGroup.set(def.group, []);
        groups.push(def.group);
      }
      byGroup.get(def.group).push(def);
    }

    paramsPanel.innerHTML = groups.map((group) =>
      `<h2>${group}</h2>` + byGroup.get(group).map((def) =>
        `<div class="param-row">` +
        `<label for="param-${def.key}">${def.label}${def.worldgen ? ' ⟳' : ''}` +
        (def.hint ? `<span class="hint">${def.hint}</span>` : '') +
        `</label>` +
        `<input type="number" id="param-${def.key}" data-key="${def.key}"` +
        ` value="${fmtParam(PARAMS[def.key])}" min="${def.min}" max="${def.max}" step="${def.step}">` +
        `</div>`).join('')
    ).join('');

    for (const input of paramsPanel.querySelectorAll('input[data-key]')) {
      const def = PARAM_DEFS.find((d) => d.key === input.dataset.key);
      const markChanged = () =>
        input.classList.toggle('changed', PARAMS[def.key] !== def.def);
      markChanged();
      input.addEventListener('change', () => {
        const v = parseFloat(input.value);
        if (!Number.isFinite(v)) {
          input.value = fmtParam(PARAMS[def.key]);
          return;
        }
        PARAMS[def.key] = Math.max(def.min, Math.min(def.max, v));
        input.value = fmtParam(PARAMS[def.key]);
        markChanged();
        // Movement/trade parameters reshape the network next tick.
        if (world) world.networkDirty = true;
      });
    }
  }

  document.getElementById('params-reset').addEventListener('click', () => {
    resetParams();
    renderParams();
    if (world) world.networkDirty = true;
  });

  renderParams();

  viewSelect.addEventListener('change', () => {
    if (world) refreshView();
  });

  generate(randomSeedString());
})();
