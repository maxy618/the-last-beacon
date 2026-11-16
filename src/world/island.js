// ---------------------------------------------------------------------------
// Island generation.
//
// A heightmap is sculpted from layered noise, then given a coast with real
// beaches and real cliffs, eroded into ridges and valleys, drained by rivers
// and finally annotated with the places the story needs: a headland for the
// lighthouse, a sheltered bay for the village, a plateau for the station.
//
// Everything is a pure function of the integer seed.
// ---------------------------------------------------------------------------

import { clamp, clamp01, lerp, smoothstep } from '../core/math.js';
import { makeRng, fbm2, ridged2, noise2, warpedFbm2 } from '../core/rng.js';

export const WORLD = {
  size: 1280,       // metres across
  res: 1024,        // heightmap samples per side (1.25 m per sample)
  seaLevel: 0,
  maxHeight: 150,
};

const IDX = (x, y, n) => x + n * y;

/** Build a low-res scalar field and return a bilinear sampler for it. */
function field(res, fn) {
  const a = new Float32Array(res * res);
  for (let j = 0; j < res; j++) {
    for (let i = 0; i < res; i++) a[IDX(i, j, res)] = fn(i / res, j / res);
  }
  return {
    a, res,
    at(u, v) {
      const x = clamp(u * res - 0.5, 0, res - 1.001);
      const y = clamp(v * res - 0.5, 0, res - 1.001);
      const ix = x | 0, iy = y | 0, fx = x - ix, fy = y - iy;
      const i0 = IDX(ix, iy, res), i1 = IDX(ix + 1, iy, res);
      const i2 = IDX(ix, iy + 1, res), i3 = IDX(ix + 1, iy + 1, res);
      const t = a[i0] + (a[i1] - a[i0]) * fx;
      const b = a[i2] + (a[i3] - a[i2]) * fx;
      return t + (b - t) * fy;
    },
  };
}

export class Island {
  constructor(seed) {
    this.seed = seed >>> 0;
    const rng = makeRng(this.seed);
    this.rng = rng;
    const R = WORLD.res, S = WORLD.size;

    // --- shape parameters, varied per island ------------------------------
    const aspect = rng.range(0.78, 1.28);          // the island is rarely round
    const rot = rng.range(0, Math.PI);
    const coastR = rng.range(0.445, 0.505);     // fraction of the map
    const cliffiness = rng.range(0.25, 0.85);
    const relief = rng.range(0.82, 1.22);
    this.aspect = aspect;
    this.coastR = coastR;

    // --- low frequency fields ---------------------------------------------
    const fCoast = field(256, (u, v) => {
      // perturbed radius: headlands and bays
      const dx = u - 0.5, dy = v - 0.5;
      const c = Math.cos(rot), s = Math.sin(rot);
      const px = (dx * c - dy * s) * aspect, py = (dx * s + dy * c);
      const r = Math.hypot(px, py) * 2;
      const warp = fbm2(u * 5.1 + 11, v * 5.1 + 3, this.seed ^ 0x1234, 4) - 0.5;
      const warp2 = fbm2(u * 11.3 + 41, v * 11.3 + 19, this.seed ^ 0x9876, 3) - 0.5;
      return r + warp * 0.30 + warp2 * 0.10;
    });
    const fMassif = field(192, (u, v) =>
      clamp01(fbm2(u * 2.3 + 5, v * 2.3 + 9, this.seed ^ 0x51ab, 4) * 1.5 - 0.28));
    const fCliff = field(256, (u, v) =>
      clamp01(fbm2(u * 3.7 + 31, v * 3.7 + 61, this.seed ^ 0x77c1, 4) * 1.35 - 0.18));
    const fRidge = field(384, (u, v) =>
      clamp01(ridged2(u * 4.6 + 3, v * 4.6 + 7, this.seed ^ 0x2f0d, 6, 2.07, 0.5) * 1.95));
    const fBase = field(384, (u, v) =>
      warpedFbm2(u * 3.4 + 17, v * 3.4 + 23, this.seed ^ 0xa13d, 5, 0.75));
    const fDetail = field(512, (u, v) =>
      fbm2(u * 15.5 + 3, v * 15.5 + 7, this.seed ^ 0xbb21, 3) - 0.5);

    // --- heightmap --------------------------------------------------------
    const H = new Float32Array(R * R);
    const landMask = new Float32Array(R * R);
    const step = S / R;
    for (let j = 0; j < R; j++) {
      const v = (j + 0.5) / R;
      for (let i = 0; i < R; i++) {
        const u = (i + 0.5) / R;
        const d = fCoast.at(u, v);                  // 0 centre .. 1 outside
        const cliff = fCliff.at(u, v);
        const band = lerp(0.30, 0.055, clamp01(cliff * 1.25 + cliffiness * 0.35 - 0.2));
        const land = smoothstep(coastR + band, coastR - band * 0.25, d);
        const massif = fMassif.at(u, v);
        const ridge = fRidge.at(u, v);
        const base = fBase.at(u, v);
        const detail = fDetail.at(u, v);

        const edge = smoothstep(0.0, 0.42, land);
        let elev = (base - 0.34) * 30 * relief;
        elev += Math.pow(ridge, 1.25) * massif * 195 * relief;
        elev *= 0.22 + 0.78 * edge;
        elev += detail * 5.0 * edge;

        // valley incision: the same ridge field inverted carves V-shaped gorges
        const valley = Math.pow(fRidge.at(u * 1.9 + 4.7, v * 1.9 - 2.3), 3.0);
        elev -= valley * 17 * edge * massif;

        let h = elev * land - 31 * Math.pow(1 - land, 1.45);

        H[IDX(i, j, R)] = h;
        landMask[IDX(i, j, R)] = land;
      }
    }

    this.height = H;
    this.landMask = landMask;
    this.step = step;

    this._erode(3, 0.95);
    this._smooth(1);
    this._addFineRelief();
    this._computeSeaDistance();

    this._carveRivers();
    this._buildCoastline();
  }

  // -- erosion ------------------------------------------------------------
  _erode(passes, talus) {
    const R = WORLD.res, H = this.height;
    const tmp = new Float32Array(H.length);
    const idx = (i, j) => IDX(clamp(i, 0, R - 1), clamp(j, 0, R - 1), R);
    for (let p = 0; p < passes; p++) {
      tmp.set(H);
      for (let j = 1; j < R - 1; j++) {
        for (let i = 1; i < R - 1; i++) {
          const c = idx(i, j);
          const h = tmp[c];
          const n0 = tmp[idx(i - 1, j)], n1 = tmp[idx(i + 1, j)];
          const n2 = tmp[idx(i, j - 1)], n3 = tmp[idx(i, j + 1)];
          const d0 = Math.max(0, h - n0), d1 = Math.max(0, h - n1);
          const d2 = Math.max(0, h - n2), d3 = Math.max(0, h - n3);
          const dmax = Math.max(d0, d1, d2, d3);
          const sum = d0 + d1 + d2 + d3;
          if (dmax > talus && sum > 1e-6) {
            // move half of the excess down to the lower neighbours, shared
            // out in proportion to how much lower each one is
            const move = (dmax - talus) * 0.30;
            H[c] -= move;
            const k = move / sum;
            if (d0 > 0) H[idx(i - 1, j)] += d0 * k;
            if (d1 > 0) H[idx(i + 1, j)] += d1 * k;
            if (d2 > 0) H[idx(i, j - 1)] += d2 * k;
            if (d3 > 0) H[idx(i, j + 1)] += d3 * k;
          }
        }
      }
    }
    // nothing may leave this range
    for (let i = 0; i < H.length; i++) H[i] = clamp(H[i], -34, 165);
  }

  /**
   * Metre-scale relief, added after the erosion so it survives it.
   * Ridges get rough flanks; the turf stays smoother.
   */
  _addFineRelief() {
    const R = WORLD.res, S = WORLD.size, H = this.height;
    for (let j = 0; j < R; j++) {
      const wz = (j + 0.5) / R * S - S / 2;
      for (let i = 0; i < R; i++) {
        const c = IDX(i, j, R);
        const h = H[c];
        if (h < 0.4) continue;
        const wx = (i + 0.5) / R * S - S / 2;
        const rough = 0.30 + 0.70 * fbm2(wx * 0.0055 + 44, wz * 0.0055 - 19, this.seed ^ 0x5b1f, 3);
        const hf = fbm2(wx * 0.055 + 5.5, wz * 0.055 - 2.5, this.seed ^ 0x3c9d, 4) - 0.5;
        const hf2 = fbm2(wx * 0.27 - 1.5, wz * 0.27 + 4.5, this.seed ^ 0x71b3, 2) - 0.5;
        // gullies: ridged noise carves down into the slopes
        const gully = Math.pow(ridged2(wx * 0.038 + 8.5, wz * 0.038 - 3.5, this.seed ^ 0x2c4e, 4), 2.4);
        const amp = 2.4 * rough * smoothstep(1.5, 12, h);
        H[c] = h + (hf * 3.0 + hf2 * 0.8 - gully * 2.0) * amp * 0.55;
      }
    }
  }

  _smooth(passes) {
    const R = WORLD.res, H = this.height;
    const tmp = new Float32Array(H.length);
    for (let p = 0; p < passes; p++) {
      for (let j = 0; j < R; j++) {
        for (let i = 0; i < R; i++) {
          const c = IDX(i, j, R);
          const x0 = i > 0 ? c - 1 : c, x1 = i < R - 1 ? c + 1 : c;
          const y0 = j > 0 ? c - R : c, y1 = j < R - 1 ? c + R : c;
          tmp[c] = (H[x0] + H[x1] + H[y0] + H[y1]) * 0.25;
        }
      }
      H.set(tmp);
    }
  }

  /** Chamfer distance (in metres) to the nearest sea cell. */
  _computeSeaDistance() {
    const R = WORLD.res, H = this.height;
    const D = new Float32Array(R * R);
    const BIG = 1e6;
    for (let i = 0; i < D.length; i++) D[i] = H[i] <= 0.001 ? 0 : BIG;
    const d1 = 1, d2 = 1.41421;
    // forward
    for (let j = 0; j < R; j++) {
      for (let i = 0; i < R; i++) {
        const c = IDX(i, j, R);
        let v = D[c];
        if (i > 0) v = Math.min(v, D[c - 1] + d1);
        if (j > 0) v = Math.min(v, D[c - R] + d1);
        if (i > 0 && j > 0) v = Math.min(v, D[c - R - 1] + d2);
        if (i < R - 1 && j > 0) v = Math.min(v, D[c - R + 1] + d2);
        D[c] = v;
      }
    }
    // backward
    for (let j = R - 1; j >= 0; j--) {
      for (let i = R - 1; i >= 0; i--) {
        const c = IDX(i, j, R);
        let v = D[c];
        if (i < R - 1) v = Math.min(v, D[c + 1] + d1);
        if (j < R - 1) v = Math.min(v, D[c + R] + d1);
        if (i < R - 1 && j < R - 1) v = Math.min(v, D[c + R + 1] + d2);
        if (i > 0 && j < R - 1) v = Math.min(v, D[c + R - 1] + d2);
        D[c] = v;
      }
    }
    this.seaDist = D;
  }

  // -- rivers --------------------------------------------------------------
  _carveRivers() {
    const rng = this.rng;
    const R = WORLD.res, H = this.height, S = WORLD.size;
    const toGrid = (x) => clamp(Math.round((x / S + 0.5) * R - 0.5), 0, R - 1);
    const toWorld = (g) => (g + 0.5) / R * S - S / 2;

    this.rivers = [];
    const wantRivers = rng.int(2, 3);
    let guard = 0;
    while (this.rivers.length < wantRivers && guard++ < 60) {
      // start from a high, reasonably flat spot
      let start = null;
      for (let tries = 0; tries < 4000; tries++) {
        const gx = rng.int(40, R - 40), gy = rng.int(40, R - 40);
        const h = H[IDX(gx, gy, R)];
        if (h < 26 || h > 110) continue;
        if (this.seaDist[IDX(gx, gy, R)] < 70) continue;
        let flat = true;
        for (let k = -2; k <= 2 && flat; k++)
          for (let m = -2; m <= 2 && flat; m++)
            if (Math.abs(H[IDX(gx + k, gy + m, R)] - h) > 5) flat = false;
        if (!flat) continue;
        start = [gx, gy];
        break;
      }
      if (!start) continue;

      // steepest descent to the sea, smoothed afterwards
      const path = [];
      let gx = start[0], gy = start[1];
      const seen = new Set();
      for (let step = 0; step < 2600; step++) {
        const c = IDX(gx, gy, R);
        if (seen.has(c)) break;
        seen.add(c);
        path.push([gx, gy]);
        if (H[c] <= 0.05) break;
        let bx = gx, by = gy, bh = H[c];
        for (let dj = -1; dj <= 1; dj++) {
          for (let di = -1; di <= 1; di++) {
            if (!di && !dj) continue;
            const x = clamp(gx + di, 0, R - 1), y = clamp(gy + dj, 0, R - 1);
            const hh = H[IDX(x, y, R)];
            if (hh < bh) { bh = hh; bx = x; by = y; }
          }
        }
        if (bx === gx && by === gy) break;
        gx = bx; gy = by;
      }
      if (path.length < 25) continue;

      // smooth the path (Chaikin) so the river does not zig-zag
      let pts = path.map(([x, y]) => [toWorld(x), H[IDX(x, y, R)], toWorld(y)]);
      for (let s = 0; s < 5; s++) {
        const out = [pts[0]];
        for (let i = 0; i < pts.length - 1; i++) {
          const a = pts[i], b = pts[i + 1];
          out.push([lerp(a[0], b[0], 0.25), lerp(a[1], b[1], 0.25), lerp(a[2], b[2], 0.25)]);
          out.push([lerp(a[0], b[0], 0.75), lerp(a[1], b[1], 0.75), lerp(a[2], b[2], 0.75)]);
        }
        out.push(pts[pts.length - 1]);
        pts = out;
      }
      // resample to even spacing
      const resampled = [];
      let acc = 0;
      resampled.push(pts[0]);
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1], b = pts[i];
        const d = Math.hypot(b[0] - a[0], b[2] - a[2]);
        acc += d;
        if (acc > 3.0) { resampled.push(b); acc = 0; }
      }
      if (resampled.length < 8) continue;

      const river = {
        points: resampled,
        width: rng.range(1.6, 3.4),
        depth: rng.range(1.1, 2.2),
      };
      this.rivers.push(river);
      this._carveChannel(river);
    }
    this._findWaterfalls();
  }

  _carveChannel(river) {
    const R = WORLD.res, H = this.height, S = WORLD.size;
    const toGrid = (x) => clamp(Math.round((x / S + 0.5) * R - 0.5), 0, R - 1);
    const depth = river.depth;
    for (const p of river.points) {
      const gx = toGrid(p[0]), gy = toGrid(p[2]);
      const rad = Math.ceil(river.width * 2.4);
      for (let j = -rad; j <= rad; j++) {
        for (let i = -rad; i <= rad; i++) {
          const x = gx + i, y = gy + j;
          if (x < 0 || y < 0 || x >= R || y >= R) continue;
          const wx = (x + 0.5) / R * S - S / 2, wz = (y + 0.5) / R * S - S / 2;
          const d = Math.hypot(wx - p[0], wz - p[2]);
          const t = 1 - smoothstep(river.width * 0.4, river.width * 2.4, d);
          const c = IDX(x, y, R);
          H[c] = lerp(H[c], Math.min(H[c], p[1] - depth * t), t * 0.95);
        }
      }
    }
  }

  _findWaterfalls() {
    this.waterfalls = [];
    for (const river of this.rivers) {
      const p = river.points;
      for (let i = 2; i < p.length - 2; i++) {
        const drop = p[i - 2][1] - p[i + 2][1];
        const run = Math.hypot(p[i + 2][0] - p[i - 2][0], p[i + 2][2] - p[i - 2][2]);
        if (drop > 6.5 && run < 9 && drop / Math.max(run, 0.5) > 0.75) {
          const dirx = p[i + 2][0] - p[i - 2][0], dirz = p[i + 2][2] - p[i - 2][2];
          const l = Math.hypot(dirx, dirz) || 1;
          this.waterfalls.push({
            x: p[i][0], y: p[i][1], z: p[i][2],
            top: p[i][1], bottom: p[i][1] - drop,
            width: river.width * 1.5,
            dir: [dirx / l, dirz / l],
          });
        }
      }
    }
  }

  /** A polyline of the shoreline, used to place jetties, wrecks and boats. */
  _buildCoastline() {
    const R = WORLD.res, H = this.height, S = WORLD.size;
    const ring = [];
    const N = 720;
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2;
      let best = null, bestD = 1e9;
      // march outward from the centre to find the water line
      for (let t = 0.08; t < 0.62; t += 0.0035) {
        const x = Math.cos(a) * t * S * 0.5, z = Math.sin(a) * t * S * 0.5;
        const gx = clamp(Math.round((x / S + 0.5) * R - 0.5), 0, R - 1);
        const gy = clamp(Math.round((z / S + 0.5) * R - 0.5), 0, R - 1);
        const h = H[IDX(gx, gy, R)];
        if (h <= 0.02) { best = [x, z]; break; }
        bestD = Math.min(bestD, h);
      }
      if (best) ring.push(best);
    }
    this.coastRing = ring;
  }

  /**
   * Bake the island's own shadow in the sun's direction.
   *
   * A dynamic shadow map only covers the few metres around the player, which
   * leaves distant mountains looking flat and unlit. Marching the heightmap
   * towards the sun once, at load time, gives the whole island the long
   * shadows it should have - for free, at runtime.
   */
  bakeSunShadow(sunDir, res = 512) {
    const R = WORLD.res, S = WORLD.size, H = this.height;
    const step = S / res;
    const hl = Math.hypot(sunDir.x, sunDir.z) || 1e-4;
    const ux = sunDir.x / hl, uz = sunDir.z / hl;
    const tanE = sunDir.y / hl;
    const cell = S / R;
    const out = new Uint8Array(res * res);
    const clampI = (v) => (v < 0 ? 0 : v > R - 1 ? R - 1 : v);
    for (let j = 0; j < res; j++) {
      const wz = (j + 0.5) * step - S / 2;
      const gj = clampI(Math.round((wz / S + 0.5) * R - 0.5));
      for (let i = 0; i < res; i++) {
        const wx = (i + 0.5) * step - S / 2;
        const gi = clampI(Math.round((wx / S + 0.5) * R - 0.5));
        const h0 = H[gi + R * gj];
        let pen = 1e9;
        for (let s = 2; s <= 120; s++) {
          const t = s * 3.2;
          const px = gi + (ux * t) / cell;
          const pz = gj + (uz * t) / cell;
          if (px < 0 || pz < 0 || px > R - 1 || pz > R - 1) break;
          const hh = H[(px | 0) + R * (pz | 0)];
          const need = h0 + tanE * t;
          const d = need - hh;
          if (d < pen) pen = d;
          if (pen < -4) break;
        }
        const shade = 1 - smoothstep(-3.0, 0.0, pen);
        out[j * res + i] = Math.round((1 - shade) * 255);
      }
    }
    return out;
  }

  // -- sampling ------------------------------------------------------------
  _gridToWorld(g) { return (g + 0.5) / WORLD.res * WORLD.size - WORLD.size / 2; }

  heightAt(x, z) {
    const R = WORLD.res, S = WORLD.size;
    const gx = (x / S + 0.5) * R - 0.5, gy = (z / S + 0.5) * R - 0.5;
    const ix = clamp(Math.floor(gx), 0, R - 2), iy = clamp(Math.floor(gy), 0, R - 2);
    const fx = clamp01(gx - ix), fy = clamp01(gy - iy);
    const H = this.height;
    const h00 = H[IDX(ix, iy, R)], h10 = H[IDX(ix + 1, iy, R)];
    const h01 = H[IDX(ix, iy + 1, R)], h11 = H[IDX(ix + 1, iy + 1, R)];
    return lerp(lerp(h00, h10, fx), lerp(h01, h11, fx), fy);
  }

  seaDistAt(x, z) {
    const R = WORLD.res, S = WORLD.size;
    const gx = clamp(Math.round((x / S + 0.5) * R - 0.5), 0, R - 1);
    const gy = clamp(Math.round((z / S + 0.5) * R - 0.5), 0, R - 1);
    return this.seaDist[IDX(gx, gy, R)] * this.step;
  }

  normalAt(x, z, e = 1.2) {
    const hL = this.heightAt(x - e, z), hR = this.heightAt(x + e, z);
    const hD = this.heightAt(x, z - e), hU = this.heightAt(x, z + e);
    const nx = hL - hR, nz = hD - hU, ny = 2 * e;
    const l = Math.hypot(nx, ny, nz) || 1;
    return [nx / l, ny / l, nz / l];
  }

  slopeAt(x, z) { return 1 - this.normalAt(x, z)[1]; }

  /**
   * Cheap ambient occlusion: how much of the sky this point can see.
   * Compares the height against the average of the surroundings at three radii.
   */
  aoAt(x, z) {
    const h = this.heightAt(x, z);
    let occ = 0, w = 0;
    const radii = [3, 9, 26];
    const weights = [1.0, 0.6, 0.3];
    for (let r = 0; r < radii.length; r++) {
      const rad = radii[r];
      let sum = 0, cnt = 0;
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * Math.PI * 2 + r;
        const hx = this.heightAt(x + Math.cos(a) * rad, z + Math.sin(a) * rad);
        sum += hx; cnt++;
      }
      const avg = sum / cnt;
      const diff = Math.max(0, avg - h);
      occ += Math.min(1, diff / (rad * 0.55)) * weights[r];
      w += weights[r];
    }
    return clamp01(1 - (occ / w) * 1.35);
  }

  /**
   * Ground classification at a point.
   * Returns weights for sand, shingle, grass, rock, moss, scree and snow.
   */
  surfaceAt(x, z) {
    const h = this.heightAt(x, z);
    const n = this.normalAt(x, z);
    const slope = 1 - n[1];
    const sd = this.seaDistAt(x, z);
    const moist = clamp01(fbm2(x * 0.012 + 3.3, z * 0.012 - 7.1, this.seed ^ 0x3311, 4) * 1.6 - 0.25);
    const alt = clamp01((h - 42) / 60);
    const alt2 = clamp01((h - 88) / 34);

    const sandW = clamp01(smoothstep(4.5, 0.8, h) * (1 - smoothstep(0.20, 0.44, slope)));
    const shingleW = clamp01(smoothstep(9.0, 2.5, h) * (1 - smoothstep(0.26, 0.52, slope))) * (1 - sandW * 0.8);
    const grassW = clamp01((1 - sandW) * (1 - shingleW * 0.6) * smoothstep(0.46, 0.20, slope) * (1 - alt2 * 0.85) * (0.55 + 0.45 * moist));
    const mossW = clamp01(moist * (1 - sandW) * smoothstep(0.55, 0.28, slope) * (1 - alt * 0.6) * 0.75);
    const screeW = clamp01(smoothstep(0.40, 0.68, slope) * smoothstep(0.12, 0.45, alt) * (1 - alt2));
    let rockW = clamp01(smoothstep(0.30, 0.62, slope) + smoothstep(0.5, 0.85, slope) + screeW * 0.6);
    // the weights always cover the surface: whatever is not grass or sand is rock
    rockW = Math.max(rockW, 1 - (sandW + shingleW * 0.4 + grassW + mossW));
    const snow = clamp01(alt2 * alt2 * smoothstep(0.55, 0.28, slope));
    const wSand = clamp01(sandW + shingleW * 0.4);
    const wGrass = clamp01(grassW);
    const wRock = clamp01(rockW);
    const wMoss = clamp01(mossW);
    const sum = wSand + wGrass + wRock + wMoss || 1;
    return {
      height: h, normal: n, slope, seaDist: sd, moisture: moist,
      sand: wSand / sum, grass: wGrass / sum, rock: wRock / sum, moss: wMoss / sum,
      snow, ao: this.aoAt(x, z),
    };
  }

  /** Is this point inside the island's land area? */
  isLand(x, z) { return this.heightAt(x, z) > 0.25; }

  /** Find a point on the shore with the given properties. */
  findShore(rng, opts = {}) {
    const wantFlat = opts.flat !== false;
    let best = null, bestScore = -1e9;
    for (let i = 0; i < 6000; i++) {
      const a = rng() * Math.PI * 2;
      const x = Math.cos(a) * rng.range(180, 460);
      const z = Math.sin(a) * rng.range(180, 460);
      const h = this.heightAt(x, z);
      if (h > 3.2 || h < -1.6) continue;
      const sd = this.seaDistAt(x, z);
      let score = 0;
      if (wantFlat) score -= this.slopeAt(x, z) * 220;
      score -= Math.abs(sd - 12) * 0.6;
      score += rng() * 6;
      if (score > bestScore) { bestScore = score; best = [x, z]; }
    }
    return best;
  }
}
