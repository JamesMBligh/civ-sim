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
  const statsEl = document.getElementById('stats');

  let world = null;

  function generate(seed) {
    const t0 = performance.now();
    world = createWorld(seed);
    const ms = performance.now() - t0;
    seedInput.value = seed;
    renderWorld(world, canvas, viewSelect.value);
    renderLegends();
    renderStats(ms);
  }

  function renderLegends() {
    terrainLegend.innerHTML = '';
    for (const [type, label] of Object.entries(TERRAIN_LABELS)) {
      const [r, g, b] = TERRAIN_COLORS[type];
      const row = document.createElement('div');
      row.className = 'legend-row';
      row.innerHTML =
        `<span class="swatch" style="background: rgb(${r},${g},${b})"></span>` +
        `<span>${label}</span>`;
      terrainLegend.appendChild(row);
    }

    resourceLegend.innerHTML = '';
    for (const res of Object.values(RESOURCES)) {
      const row = document.createElement('div');
      row.className = 'legend-row';
      row.innerHTML =
        `<span class="swatch" style="background: ${res.color}; border-radius: 50%"></span>` +
        `<span>${res.name}</span>`;
      resourceLegend.appendChild(row);
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
    const meters = Math.round((tile.elevation - 0.5) * 2 * 1300); // crude m above sea level
    if (meters >= 0) parts.push(`Elevation ≈ ${meters} m`);
    parts.push(`Moisture ${(tile.moisture * 100).toFixed(0)}%`);
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
    if (world) renderWorld(world, canvas, viewSelect.value);
  });

  generate(randomSeedString());
})();
