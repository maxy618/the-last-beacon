// ---------------------------------------------------------------------------
// Procedural surface detail.
//
// A tiling rock texture is generated once at load time: a normal map, a height
// field and a mottling mask, all packed into one RGBA image. It is sampled
// triplanar by the terrain and by the stonework, which gives close-up surface
// detail without any image files.
// ---------------------------------------------------------------------------

import * as THREE from 'three';
import { fbm2, ridged2, worley2, noise2 } from '../core/rng.js';
import { clamp, clamp01, smoothstep } from '../core/math.js';

export function makeRockDetail(size = 512, seed = 7) {
  const h = new Float32Array(size * size);
  const crack = new Float32Array(size * size);
  const mott = new Float32Array(size * size);

  // height: layered fbm plus sharp bedding cracks
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const u = i / size, v = j / size;
      let e = fbm2(u * 9, v * 9, seed, 5) * 1.0;
      e += ridged2(u * 5.5, v * 5.5, seed + 11, 4) * 0.55;
      e += fbm2(u * 26, v * 26, seed + 23, 3) * 0.22;
      h[j * size + i] = e;
      // cracks: the ridges of a cellular noise, pinched
      const w = worley2(u * 7, v * 7, seed + 37);
      const c = 1 - smoothstep(0.0, 0.16, w.f2 - w.f1);
      crack[j * size + i] = c;
      mott[j * size + i] = fbm2(u * 3.1 + 5, v * 3.1 - 2, seed + 51, 4);
    }
  }

  const data = new Uint8Array(size * size * 4);
  const at = (x, y) => h[((y + size) % size) * size + ((x + size) % size)];
  const atC = (x, y) => crack[((y + size) % size) * size + ((x + size) % size)];
  const atM = (x, y) => mott[((y + size) % size) * size + ((x + size) % size)];

  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const o = (j * size + i) * 4;
      // height with the cracks cut in
      const hh = at(i, j) - atC(i, j) * 0.42;
      const strength = 1.5;
      const dx = (at(i + 1, j) - atC(i + 1, j) * 0.42 - hh) * strength;
      const dy = (at(i, j + 1) - atC(i, j + 1) * 0.42 - hh) * strength;
      let nx = -dx, ny = -dy, nz = 1;
      const l = Math.hypot(nx, ny, nz);
      nx /= l; ny /= l; nz /= l;
      data[o] = Math.round((nx * 0.5 + 0.5) * 255);
      data[o + 1] = Math.round((ny * 0.5 + 0.5) * 255);
      data[o + 2] = Math.round(clamp01(hh * 0.45 + 0.35) * 255);
      data[o + 3] = Math.round(clamp01(atM(i, j)) * 255);
    }
  }

  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  return tex;
}

/** A tiling foliage texture: a soft blob of leaves with alpha. */
export function makeLeafTexture(size = 256, seed = 3, kind = 0) {
  const data = new Uint8Array(size * size * 4);
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const u = i / size, v = j / size;
      // a cluster of small leaves drawn procedurally
      let a = 0, shade = 0;
      const cells = kind === 0 ? 26 : 40;
      for (let k = 0; k < cells; k++) {
        const cx = hash2(i * 31 + k, j * 17, seed);
        const cy = hash2(i * 13 - k, j * 47 + k, seed);
        const r = 0.06 + hash2(k, i + j, seed) * 0.055;
        const dx = u - cx, dy = v - cy;
        const d = Math.hypot(dx, dy);
        if (d > r) continue;
        // an oval leaf, tilted
        const ang = hash2(k + 91, i * 7, seed) * Math.PI;
        const rx = Math.cos(ang) * dx + Math.sin(ang) * dy;
        const ry = -Math.sin(ang) * dx + Math.cos(ang) * dy;
        const e = Math.pow(rx / r, 2) + Math.pow(ry / (r * 1.9), 2);
        if (e > 1) continue;
        const cover = (1 - e) * 0.9;
        if (cover > a) { a = cover; shade = 0.55 + 0.45 * (1 - Math.abs(ry) / (r * 1.9)); }
      }
      // soften the edges
      a = clamp01(a * 1.6);
      const o = (j * size + i) * 4;
      const g = 0.45 + 0.55 * shade;
      data[o] = Math.round(255 * g);
      data[o + 1] = Math.round(255 * g * (kind === 0 ? 1.0 : 0.92));
      data[o + 2] = Math.round(255 * g * (kind === 0 ? 0.85 : 0.8));
      data[o + 3] = Math.round(a * 255);
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

function hash2(x, y, seed) {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(seed | 0, 1274126177)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
