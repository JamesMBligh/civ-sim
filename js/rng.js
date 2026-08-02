// Seeded pseudo-random number generator so every map is reproducible from
// its seed string. Uses xmur3 to hash the seed and mulberry32 as the PRNG.

function xmur3(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return function () {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return h >>> 0;
  };
}

function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

class RNG {
  constructor(seedString) {
    this.seedString = seedString;
    const hash = xmur3(seedString);
    this.next = mulberry32(hash());
  }

  // Float in [0, 1)
  random() {
    return this.next();
  }

  // Integer in [min, max] inclusive
  int(min, max) {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  // Float in [min, max)
  range(min, max) {
    return min + this.next() * (max - min);
  }

  // Pick a random element from an array
  pick(arr) {
    return arr[this.int(0, arr.length - 1)];
  }

  // Derive an independent RNG stream (e.g. one for terrain, one for rivers)
  // so adding a new consumer doesn't change every other stream's output.
  fork(label) {
    return new RNG(this.seedString + ':' + label);
  }
}

function randomSeedString() {
  const words = ['ash', 'brook', 'crag', 'dale', 'elm', 'fen', 'glen', 'heath',
    'isle', 'loch', 'moor', 'ness', 'oak', 'peak', 'reed', 'shore',
    'tarn', 'vale', 'wold', 'yew'];
  const a = words[Math.floor(Math.random() * words.length)];
  const b = words[Math.floor(Math.random() * words.length)];
  const n = Math.floor(Math.random() * 1000);
  return `${a}-${b}-${n}`;
}
