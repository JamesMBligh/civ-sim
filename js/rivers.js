// River generation: springs start in high, wet terrain and flow downhill to
// the sea, carving RIVER tiles. Where a path gets stuck in a depression it
// fills a small LAKE and continues from the lake's lowest rim.

function generateRivers(world, rng) {
  const { size, elevation, terrain } = world;
  const riverRng = rng.fork('rivers');

  // rivers[i] = 0 (none) or flow volume (1+); larger volume = wider river
  const riverFlow = new Uint16Array(size * size);

  // Collect candidate springs: high-elevation land, weighted toward wetter
  // tiles. Aim for a realistic count of major rivers for a UK-sized island.
  const candidates = [];
  for (let y = 2; y < size - 2; y++) {
    for (let x = 2; x < size - 2; x++) {
      const i = y * size + x;
      if (elevation[i] > 0.68 && !isSea(terrain[i])) {
        candidates.push(i);
      }
    }
  }

  const targetRivers = Math.min(candidates.length, riverRng.int(14, 22));
  shuffleInPlace(candidates, riverRng);

  const NEIGHBORS = [
    [-1, -1], [0, -1], [1, -1],
    [-1, 0], [1, 0],
    [-1, 1], [0, 1], [1, 1],
  ];

  let springsUsed = 0;
  for (let c = 0; c < candidates.length && springsUsed < targetRivers; c++) {
    const start = candidates[c];
    // Keep springs apart so rivers spread across the island.
    if (tooCloseToRiver(start, riverFlow, size, 6)) continue;

    const path = tracePath(start);
    if (path && path.length >= 5) {
      springsUsed++;
      for (const idx of path) {
        riverFlow[idx] = Math.min(65535, riverFlow[idx] + 1);
      }
    }
  }

  // Stamp river/lake tiles onto the terrain (not over sea).
  for (let i = 0; i < riverFlow.length; i++) {
    if (riverFlow[i] > 0 && !isSea(terrain[i])) {
      terrain[i] = TERRAIN.RIVER;
    }
  }

  world.riverFlow = riverFlow;

  // --- helpers ---

  function tracePath(startIdx) {
    const path = [];
    const visited = new Set();
    let current = startIdx;
    // Work on a copy of elevations we can raise when filling depressions.
    const filled = new Map();
    const elevAt = (i) => (filled.has(i) ? filled.get(i) : elevation[i]);

    for (let steps = 0; steps < size * 4; steps++) {
      if (visited.has(current)) return null; // loop safety
      visited.add(current);
      path.push(current);

      if (isSea(terrain[current])) {
        path.pop(); // don't stamp the ocean tile itself
        return path;
      }
      // Merging into an existing river completes this one.
      if (riverFlow[current] > 0 && current !== startIdx) {
        return path;
      }

      const cx = current % size;
      const cy = (current / size) | 0;
      let best = -1;
      let bestElev = Infinity;
      for (const [dx, dy] of NEIGHBORS) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
        const ni = ny * size + nx;
        if (visited.has(ni)) continue;
        const ne = elevAt(ni);
        if (ne < bestElev) {
          bestElev = ne;
          best = ni;
        }
      }

      if (best === -1) return path; // boxed in; end here

      // Depression: raise the current tile's water level slightly so flow
      // can spill over the rim (simple flood-and-spill). Mark it a lake.
      if (bestElev > elevAt(current)) {
        filled.set(best, elevAt(current) + 0.001);
        if (!isSea(terrain[current])) {
          terrain[current] = TERRAIN.LAKE;
        }
      }
      current = best;
    }
    return path;
  }

  function tooCloseToRiver(idx, flow, sz, radius) {
    const x = idx % sz;
    const y = (idx / sz) | 0;
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= sz || ny >= sz) continue;
        if (flow[ny * sz + nx] > 0) return true;
      }
    }
    return false;
  }
}

function shuffleInPlace(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = rng.int(0, i);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}
