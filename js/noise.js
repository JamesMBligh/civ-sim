// Seeded 2D value noise with fractal (fBm) layering. Self-contained so the
// project has no external dependencies.

class ValueNoise {
  constructor(rng, gridSize = 256) {
    this.gridSize = gridSize;
    // Lattice of random values, wrapped with a permutation-free modulo.
    this.values = new Float32Array(gridSize * gridSize);
    for (let i = 0; i < this.values.length; i++) {
      this.values[i] = rng.random();
    }
  }

  latticeValue(ix, iy) {
    const gs = this.gridSize;
    const x = ((ix % gs) + gs) % gs;
    const y = ((iy % gs) + gs) % gs;
    return this.values[y * gs + x];
  }

  // Smoothstep-interpolated noise in [0, 1]
  sample(x, y) {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const fx = x - x0;
    const fy = y - y0;
    // Quintic fade for smooth derivatives
    const u = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
    const v = fy * fy * fy * (fy * (fy * 6 - 15) + 10);

    const v00 = this.latticeValue(x0, y0);
    const v10 = this.latticeValue(x0 + 1, y0);
    const v01 = this.latticeValue(x0, y0 + 1);
    const v11 = this.latticeValue(x0 + 1, y0 + 1);

    const top = v00 + (v10 - v00) * u;
    const bottom = v01 + (v11 - v01) * u;
    return top + (bottom - top) * v;
  }

  // Fractal Brownian motion: layered octaves of noise, in [0, 1]
  fbm(x, y, octaves = 5, lacunarity = 2.0, gain = 0.5) {
    let amplitude = 1;
    let frequency = 1;
    let sum = 0;
    let norm = 0;
    for (let i = 0; i < octaves; i++) {
      sum += amplitude * this.sample(x * frequency, y * frequency);
      norm += amplitude;
      amplitude *= gain;
      frequency *= lacunarity;
    }
    return sum / norm;
  }
}
