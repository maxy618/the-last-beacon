// ---------------------------------------------------------------------------
// Procedural building materials.
//
// Everything is painted onto canvases at load time: lime-washed plaster,
// random-rubble stone, brick, slate, and wood planks. No image files.
// ---------------------------------------------------------------------------

import * as THREE from 'three';

function canvas(size = 512) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return c;
}

function rngOf(seed) {
  let a = seed >>> 0 || 1;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function toTex(c, repeat = 1) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  t.needsUpdate = true;
  return t;
}

function noiseOn(ctx, size, salt, alpha = 0.16, dark = 0) {
  const img = ctx.getImageData(0, 0, size, size);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = Math.sin(i * 0.023 + salt) * 43758.5453;
    const f = 1 - alpha / 2 + (n - Math.floor(n)) * alpha;
    d[i] = d[i] * f - dark; d[i + 1] = d[i + 1] * f - dark; d[i + 2] = d[i + 2] * f - dark;
  }
  ctx.putImageData(img, 0, 0);
}

/** Limewashed plaster with damp stains and crazing. */
export function plasterTexture(seed = 5, size = 512, tint = [232, 226, 214]) {
  const c = canvas(size), ctx = c.getContext('2d');
  const rng = rngOf(seed);
  ctx.fillStyle = `rgb(${tint[0]},${tint[1]},${tint[2]})`;
  ctx.fillRect(0, 0, size, size);
  // broad, soft mottling
  for (let k = 0; k < 22; k++) {
    const g = ctx.createRadialGradient(rng() * size, rng() * size, 10, rng() * size, rng() * size, 40 + rng() * 150);
    g.addColorStop(0, `rgba(${120 + rng() * 60},${118 + rng() * 50},${110 + rng() * 45},${0.10 + rng() * 0.16})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  }
  // fine horizontal lime bands (from the house being limewashed several times)
  ctx.globalAlpha = 0.05 + rng() * 0.05;
  for (let y = 0; y < size; y += 2) {
    if (rng() < 0.3) { ctx.fillStyle = '#8d867a'; ctx.fillRect(0, y, size, 1); }
  }
  ctx.globalAlpha = 1;
  // crazing: thin dark hairlines
  ctx.strokeStyle = 'rgba(88,84,78,0.35)'; ctx.lineWidth = 1;
  for (let k = 0; k < 26; k++) {
    ctx.beginPath();
    let x = rng() * size, y = rng() * size;
    ctx.moveTo(x, y);
    for (let s = 0; s < 12; s++) { x += (rng() - 0.5) * 70; y += (rng() - 0.5) * 70; ctx.lineTo(x, y); }
    ctx.stroke();
  }
  noiseOn(ctx, size, seed, 0.18);
  return toTex(c);
}

/** Random rubble stone with lime mortar lines. */
export function stoneTexture(seed = 8, size = 512) {
  const c = canvas(size), ctx = c.getContext('2d');
  const rng = rngOf(seed);
  ctx.fillStyle = '#8f8a80';
  ctx.fillRect(0, 0, size, size);
  // mortar bed
  ctx.fillStyle = '#a9a498';
  ctx.fillRect(0, 0, size, size);
  const courses = 9;
  for (let r = 0; r < courses; r++) {
    const y = (r / courses) * size;
    const h = size / courses;
    let x = -rng() * 30;
    while (x < size) {
      const w = 22 + rng() * 46;
      const jitter = (rng() - 0.5) * 6;
      const g = 92 + rng() * 70;
      const warm = rng() < 0.3;
      ctx.fillStyle = warm ? `rgb(${g + 16},${g + 4},${g - 18})` : `rgb(${g},${g},${g - 4})`;
      ctx.beginPath();
      ctx.roundRect(x + 1, y + jitter + 1, w - 2, h - 2, 4 + rng() * 6);
      ctx.fill();
      // a highlight on the top edge
      ctx.fillStyle = 'rgba(255,255,255,0.10)';
      ctx.beginPath(); ctx.roundRect(x + 2, y + jitter + 2, w - 4, 4, 3); ctx.fill();
      // a shadow along the bottom edge
      ctx.fillStyle = 'rgba(0,0,0,0.22)';
      ctx.beginPath(); ctx.roundRect(x + 2, y + jitter + h - 6, w - 4, 4, 3); ctx.fill();
      x += w;
    }
  }
  noiseOn(ctx, size, seed + 2, 0.24);
  return toTex(c);
}

/** Coursed brick. */
export function brickTexture(seed = 9, size = 512, base = [138, 66, 44]) {
  const c = canvas(size), ctx = c.getContext('2d');
  const rng = rngOf(seed);
  ctx.fillStyle = '#9a938a';
  ctx.fillRect(0, 0, size, size);
  const bh = size / 12, bw = size / 5.4;
  for (let r = 0; r < 12; r++) {
    const off = (r % 2) * bw * 0.5;
    for (let x = -bw; x < size + bw; x += bw) {
      const g = 0.78 + rng() * 0.4;
      ctx.fillStyle = `rgb(${Math.floor(base[0] * g)},${Math.floor(base[1] * g)},${Math.floor(base[2] * g)})`;
      ctx.fillRect(x + off + 2, r * bh + 2, bw - 4, bh - 4);
      if (rng() < 0.22) { ctx.fillStyle = 'rgba(0,0,0,0.28)'; ctx.fillRect(x + off + 2, r * bh + 2, bw - 4, bh - 4); }
    }
  }
  noiseOn(ctx, size, seed + 3, 0.22);
  return toTex(c);
}

/** Slate roofing: coursed, weathered. */
export function slateTexture(seed = 11, size = 512) {
  const c = canvas(size), ctx = c.getContext('2d');
  const rng = rngOf(seed);
  ctx.fillStyle = '#2b2b30';
  ctx.fillRect(0, 0, size, size);
  const rows = 10;
  for (let r = 0; r < rows; r++) {
    const y = (r / rows) * size, h = size / rows;
    const off = (r % 2) * 40;
    for (let x = -100; x < size + 100; x += 44) {
      const g = 44 + rng() * 60;
      const blue = rng() < 0.3;
      ctx.fillStyle = `rgb(${Math.floor(g * (blue ? 0.75 : 0.92))},${Math.floor(g * (blue ? 0.78 : 0.92))},${Math.floor(g * (blue ? 1.35 : 0.95))})`;
      ctx.beginPath();
      ctx.roundRect(x + off, y + 1, 42, h - 2, 3);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.05)';
      ctx.fillRect(x + off, y + 1, 42, 3);
    }
  }
  noiseOn(ctx, size, seed + 5, 0.28, 8);
  return toTex(c);
}

/** Wooden planks. */
export function plankTexture(seed = 13, size = 512, base = [86, 62, 38]) {
  const c = canvas(size), ctx = c.getContext('2d');
  const rng = rngOf(seed);
  ctx.fillStyle = `rgb(${base[0]},${base[1]},${base[2]})`;
  ctx.fillRect(0, 0, size, size);
  const rows = 6;
  for (let r = 0; r < rows; r++) {
    const y = (r / rows) * size;
    const g = 0.82 + rng() * 0.35;
    ctx.fillStyle = `rgb(${Math.floor(base[0] * g)},${Math.floor(base[1] * g)},${Math.floor(base[2] * g)})`;
    ctx.fillRect(0, y, size, size / rows - 3);
    // grain
    ctx.strokeStyle = 'rgba(0,0,0,0.22)';
    for (let k = 0; k < 4; k++) {
      ctx.beginPath();
      const gy = y + rng() * (size / rows);
      ctx.moveTo(0, gy);
      ctx.bezierCurveTo(size * 0.3, gy + (rng() - 0.5) * 9, size * 0.7, gy + (rng() - 0.5) * 9, size, gy);
      ctx.stroke();
    }
    // knots
    if (rng() < 0.7) {
      const kx = rng() * size, ky = y + rng() * (size / rows);
      ctx.fillStyle = 'rgba(18,11,5,0.55)';
      ctx.beginPath(); ctx.ellipse(kx, ky, 4 + rng() * 5, 3 + rng() * 3, 0, 0, Math.PI * 2); ctx.fill();
    }
  }
  noiseOn(ctx, size, seed + 6, 0.2);
  return toTex(c);
}

/** Rough dark ground with pebbles, used under buildings and in sheds. */
export function dirtTexture(seed = 17, size = 512) {
  const c = canvas(size), ctx = c.getContext('2d');
  const rng = rngOf(seed);
  ctx.fillStyle = '#4a4034';
  ctx.fillRect(0, 0, size, size);
  for (let k = 0; k < 900; k++) {
    const r = rng();
    const g = 52 + rng() * 78;
    ctx.fillStyle = r < 0.12 ? `rgb(${g + 20},${g + 12},${g + 4})` : `rgb(${g},${g * 0.88},${g * 0.72})`;
    ctx.beginPath();
    ctx.ellipse(rng() * size, rng() * size, 1.5 + rng() * 5.5, 1.5 + rng() * 4, rng() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }
  noiseOn(ctx, size, seed + 7, 0.3, 10);
  return toTex(c);
}
