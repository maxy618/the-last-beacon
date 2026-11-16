// ---------------------------------------------------------------------------
// Deterministic randomness and coherent noise.
// Everything in the world derives from a single integer seed, so the same
// seed always rebuilds the same island.
// ---------------------------------------------------------------------------

/** mulberry32 - small, fast, decent quality PRNG. */
export function makeRng(seed) {
  let a = (seed >>> 0) || 0x9e3779b9;
  const rng = () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  rng.range = (lo, hi) => lo + (hi - lo) * rng();
  rng.int = (lo, hi) => Math.floor(lo + (hi - lo + 1) * rng()) | 0;
  rng.pick = (arr) => arr[Math.floor(rng() * arr.length) % arr.length];
  rng.chance = (p) => rng() < p;
  rng.sign = () => (rng() < 0.5 ? -1 : 1);
  /** Gaussian-ish via the sum of three uniforms. */
  rng.gauss = (mean = 0, sd = 1) => mean + ((rng() + rng() + rng()) / 1.5 - 1) * sd;
  rng.shuffle = (arr) => {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  };
  return rng;
}

/** A seed derived from a string, so seeds can be memorable words. */
export function seedFromString(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// ---- integer hash noise ---------------------------------------------------

function hash2i(x, y, seed) {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(seed | 0, 1274126177)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function hash3i(x, y, z, seed) {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(z | 0, 1274126177) + Math.imul(seed | 0, 2654435761)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Smooth value noise in 2D, output 0..1 */
export function noise2(x, y, seed = 0) {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
  const a = hash2i(ix, iy, seed);
  const b = hash2i(ix + 1, iy, seed);
  const c = hash2i(ix, iy + 1, seed);
  const d = hash2i(ix + 1, iy + 1, seed);
  return (a + (b - a) * ux) + ((c + (d - c) * ux) - (a + (b - a) * ux)) * uy;
}

/** Smooth value noise in 3D, output 0..1 */
export function noise3(x, y, z, seed = 0) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const fx = x - ix, fy = y - iy, fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy), uz = fz * fz * (3 - 2 * fz);
  const c000 = hash3i(ix, iy, iz, seed), c100 = hash3i(ix + 1, iy, iz, seed);
  const c010 = hash3i(ix, iy + 1, iz, seed), c110 = hash3i(ix + 1, iy + 1, iz, seed);
  const c001 = hash3i(ix, iy, iz + 1, seed), c101 = hash3i(ix + 1, iy, iz + 1, seed);
  const c011 = hash3i(ix, iy + 1, iz + 1, seed), c111 = hash3i(ix + 1, iy + 1, iz + 1, seed);
  const x00 = c000 + (c100 - c000) * ux, x10 = c010 + (c110 - c010) * ux;
  const x01 = c001 + (c101 - c001) * ux, x11 = c011 + (c111 - c011) * ux;
  const y0 = x00 + (x10 - x00) * uy, y1 = x01 + (x11 - x01) * uy;
  return y0 + (y1 - y0) * uz;
}

/** Fractional Brownian motion over value noise. Output roughly 0..1 */
export function fbm2(x, y, seed = 0, octaves = 5, lacunarity = 2.02, gain = 0.5) {
  let amp = 1, freq = 1, sum = 0, norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * noise2(x * freq, y * freq, seed + i * 1013);
    norm += amp;
    amp *= gain; freq *= lacunarity;
    x = x * lacunarity + 13.71; y = y * lacunarity + 7.31;
  }
  return sum / norm;
}

/** Ridged multifractal - gives sharp mountain crests. Output 0..1 */
export function ridged2(x, y, seed = 0, octaves = 5, lacunarity = 2.04, gain = 0.5) {
  let amp = 1, freq = 1, sum = 0, norm = 0, prev = 1;
  for (let i = 0; i < octaves; i++) {
    let n = 1 - Math.abs(noise2(x * freq, y * freq, seed + i * 7919) * 2 - 1);
    n *= n;
    sum += amp * n * prev;
    prev = n;
    norm += amp;
    amp *= gain; freq *= lacunarity;
    x = x * lacunarity + 4.19; y = y * lacunarity + 9.71;
  }
  return sum / norm;
}

/** Domain-warped fbm - kills the grid-aligned look of plain fbm. */
export function warpedFbm2(x, y, seed = 0, octaves = 5, warp = 0.6) {
  const wx = fbm2(x + 5.2, y + 1.3, seed + 91, 3) - 0.5;
  const wy = fbm2(x + 9.7, y + 7.9, seed + 233, 3) - 0.5;
  return fbm2(x + wx * warp * 4, y + wy * warp * 4, seed, octaves);
}

/** Worley / cellular noise. Returns {f1, f2, id} distances in cell units. */
export function worley2(x, y, seed = 0) {
  const ix = Math.floor(x), iy = Math.floor(y);
  let f1 = 9e9, f2 = 9e9, id = 0;
  for (let oy = -1; oy <= 1; oy++) {
    for (let ox = -1; ox <= 1; ox++) {
      const cx = ix + ox, cy = iy + oy;
      const px = cx + hash2i(cx, cy, seed);
      const py = cy + hash2i(cx, cy, seed + 7919);
      const dx = px - x, dy = py - y;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < f1) { f2 = f1; f1 = d; id = hash2i(cx, cy, seed + 104729); }
      else if (d < f2) f2 = d;
    }
  }
  return { f1, f2, id };
}

/** Poisson-ish blue-noise point set in a unit square, deterministic. */
export function blueNoise(count, seed, minDist = 0.06) {
  const rng = makeRng(seed);
  const pts = [];
  const cell = minDist / Math.SQRT2;
  const grid = new Map();
  const key = (x, y) => `${Math.floor(x / cell)},${Math.floor(y / cell)}`;
  let tries = 0;
  while (pts.length < count && tries < count * 60) {
    tries++;
    const x = rng(), y = rng();
    let ok = true;
    const gx = Math.floor(x / cell), gy = Math.floor(y / cell);
    for (let oy = -2; oy <= 2 && ok; oy++) {
      for (let ox = -2; ox <= 2 && ok; ox++) {
        const arr = grid.get(`${gx + ox},${gy + oy}`);
        if (!arr) continue;
        for (const p of arr) {
          const dx = p[0] - x, dy = p[1] - y;
          if (dx * dx + dy * dy < minDist * minDist) { ok = false; break; }
        }
      }
    }
    if (ok) {
      pts.push([x, y]);
      const k = key(x, y);
      if (!grid.has(k)) grid.set(k, []);
      grid.get(k).push([x, y]);
    }
  }
  return pts;
}
