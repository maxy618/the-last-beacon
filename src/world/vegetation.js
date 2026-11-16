// ---------------------------------------------------------------------------
// Vegetation.
//
// Everything is generated: wind-bent pines, cypress-like spires, gorse,
// heather, bracken and grass. Trees are built as merged low-poly geometry and
// drawn as instanced meshes with per-instance colour and a breeze animation.
// Grass is kept in spatial cells and only the cells near the camera are on.
// ---------------------------------------------------------------------------

import * as THREE from 'three';
import { clamp, clamp01, lerp, smoothstep } from '../core/math.js';
import { makeRng, fbm2, noise2 } from '../core/rng.js';
import { WORLD } from './island.js';

/** Merge a list of BufferGeometries into one, baking world transforms. */
function mergeGeoms(items) {
  let vCount = 0, iCount = 0;
  const geoms = [];
  for (const { geo, matrix, color } of items) {
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    if (matrix) g.applyMatrix4(matrix);
    vCount += g.attributes.position.count;
    geoms.push({ g, color });
  }
  const pos = new Float32Array(vCount * 3);
  const nrm = new Float32Array(vCount * 3);
  const col = new Float32Array(vCount * 3);
  let vo = 0;
  const c = new THREE.Color();
  for (const { g, color } of geoms) {
    const p = g.attributes.position;
    const n = g.attributes.normal;
    c.set(color || 0xffffff);
    for (let i = 0; i < p.count; i++) {
      pos[vo * 3] = p.getX(i); pos[vo * 3 + 1] = p.getY(i); pos[vo * 3 + 2] = p.getZ(i);
      if (n) { nrm[vo * 3] = n.getX(i); nrm[vo * 3 + 1] = n.getY(i); nrm[vo * 3 + 2] = n.getZ(i); }
      col[vo * 3] = c.r; col[vo * 3 + 1] = c.g; col[vo * 3 + 2] = c.b;
      vo++;
    }
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return out;
}

/** A tapered, bending trunk built from stacked rings. */
function trunkGeometry(height, baseR, topR, bendDir, bendAmount, segments = 9, sides = 8) {
  // wind bias grows quadratically along the trunk
  const radial = [];
  for (let s = 0; s <= segments; s++) {
    const t = s / segments;
    const y = t * height;
    const bend = bendAmount * t * t;
    const cx = Math.cos(bendDir) * bend;
    const cz = Math.sin(bendDir) * bend;
    const r = lerp(baseR, topR, Math.pow(t, 1.15));
    const ring = [];
    for (let k = 0; k < sides; k++) {
      const a = (k / sides) * Math.PI * 2;
      ring.push(new THREE.Vector3(cx + Math.cos(a) * r, y, cz + Math.sin(a) * r));
    }
    radial.push(ring);
  }
  const verts = [];
  const idx = [];
  for (const ring of radial) {
    for (const p of ring) verts.push(p.x, p.y, p.z);
  }
  for (let s = 0; s < segments; s++) {
    for (let k = 0; k < sides; k++) {
      const a = s * sides + k, b = s * sides + ((k + 1) % sides);
      const c = (s + 1) * sides + k, d = (s + 1) * sides + ((k + 1) % sides);
      idx.push(a, c, b, b, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** A knobbly canopy blob - a displaced, flattened sphere with a few lobes. */
function canopyGeometry(radius, height, rng, lumps = 5, flattenY = 0.55) {
  const g = new THREE.IcosahedronGeometry(radius, 1);
  const p = g.attributes.position;
  const seeds = [];
  for (let k = 0; k < lumps; k++) {
    seeds.push([rng.range(-0.75, 0.75), rng.range(-0.3, 0.3), rng.range(-0.75, 0.75), rng.range(0.5, 1.1)]);
  }
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const n = Math.hypot(x, y, z) || 1;
    x /= n; y /= n; z /= n;
    let r = 1;
    for (const [sx, sy, sz, amp] of seeds) {
      const d = Math.hypot(x - sx, (y - sy) * 1.4, z - sz);
      r += amp * Math.exp(-d * d * 2.4) * 0.38;
    }
    r *= 1 + (noise2(x * 1.7 + 7, y * 1.7 - 3, 5) - 0.5) * 0.42;
    p.setXYZ(i, x * radius * r, y * radius * r * flattenY, z * radius * r);
  }
  g.computeVertexNormals();
  if (height !== undefined) g.translate(0, height, 0);
  return g;
}

function makePineGeometry(rng, lean, height = 9) {
  const items = [];
  const trunkCol = 0x2e231b;
  const bend = lean;
  const bendDir = rng.range(0, Math.PI * 2);
  const trunk = trunkGeometry(height, 0.32, 0.13, bendDir, bend, 11, 7);
  items.push({ geo: trunk, color: trunkCol });
  // wind-bent crown: several overlapping clumps dense enough to merge into a silhouette
  const green = new THREE.Color().setHSL(0.37 + rng.range(-0.035, 0.03), 0.36, rng.range(0.065, 0.095));
  const clumps = [
    { t: 0.50, r: 1.32, off: 0.75, flat: 0.52 },
    { t: 0.58, r: 1.18, off: 0.85, flat: 0.50 },
    { t: 0.67, r: 1.00, off: 0.95, flat: 0.50 },
    { t: 0.76, r: 0.80, off: 0.8, flat: 0.53 },
    { t: 0.85, r: 0.58, off: 0.6, flat: 0.58 },
    { t: 0.93, r: 0.36, off: 0.28, flat: 0.62 },
  ];
  for (const L of clumps) {
    const bendY = bend * L.t * L.t;
    const nSub = 4;
    for (let s = 0; s < nSub; s++) {
      const rr = L.r * rng.range(0.55, 1.0);
      const c = canopyGeometry(rr, undefined, rng, 6, L.flat);
      const a = (s / nSub) * Math.PI * 2 + rng.range(-0.7, 0.7);
      const rad = L.r * rng.range(0.3, 0.72);
      const m = new THREE.Matrix4();
      m.makeTranslation(
        Math.cos(bendDir) * (bendY + L.off) + Math.cos(a) * rad,
        height * L.t + rng.range(-0.3, 0.3),
        Math.sin(bendDir) * (bendY + L.off) + Math.sin(a) * rad
      );
      items.push({ geo: c, matrix: m, color: green.getHex() });
    }
  }
  return mergeGeoms(items);
}

function makeSpireGeometry(rng, lean, height = 13) {
  const items = [];
  const trunkCol = 0x241c15;
  const bendDir = rng.range(0, Math.PI * 2);
  const trunk = trunkGeometry(height, 0.24, 0.08, bendDir, lean * 1.4, 12, 6);
  items.push({ geo: trunk, color: trunkCol });
  // a shaggy conical crown: stacked overlapping ragged clumps
  const green = new THREE.Color().setHSL(0.35 + rng.range(-0.03, 0.03), 0.32, rng.range(0.05, 0.075));
  const layers = 7;
  for (let k = 0; k < layers; k++) {
    const t = 0.34 + (k / (layers - 1)) * 0.62;
    const r = 1.30 * (1 - t * 0.82) + 0.28;
    const bendY = lean * 1.4 * t * t;
    const nSub = 2;
    for (let s = 0; s < nSub; s++) {
      const rr = r * rng.range(0.75, 1.1);
      const c = canopyGeometry(rr, undefined, rng, 5, 0.62);
      const a = rng.range(0, Math.PI * 2);
      const rad = r * 0.42 * rng.range(0.4, 1.0);
      const m = new THREE.Matrix4();
      m.makeTranslation(
        Math.cos(bendDir) * bendY + Math.cos(a) * rad,
        height * t + rng.range(-0.25, 0.25),
        Math.sin(bendDir) * bendY + Math.sin(a) * rad
      );
      items.push({ geo: c, matrix: m, color: green.getHex() });
    }
  }
  return mergeGeoms(items);
}

function makeGorseGeometry(rng) {
  const items = [];
  const spikes = 90;
  const green = new THREE.Color().setHSL(0.30 + rng.range(-0.04, 0.05), 0.45, rng.range(0.16, 0.22));
  const core = new THREE.IcosahedronGeometry(0.42, 1);
  const cm = new THREE.Matrix4().makeTranslation(0, 0.36, 0);
  items.push({ geo: core, matrix: cm, color: green.clone().multiplyScalar(0.55).getHex() });
  const spikeGeo = new THREE.ConeGeometry(0.05, 1.0, 4, 1);
  for (let i = 0; i < spikes; i++) {
    const th = rng.range(0, Math.PI * 2);
    const ph = rng.range(0.15, Math.PI * 0.52);
    const len = rng.range(0.32, 0.62);
    const dir = new THREE.Vector3(Math.sin(ph) * Math.cos(th), Math.cos(ph), Math.sin(ph) * Math.sin(th));
    const m = new THREE.Matrix4();
    m.makeRotationFromQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir));
    m.setPosition(dir.x * 0.30, 0.36 + dir.y * 0.30, dir.z * 0.30);
    const s = new THREE.Matrix4().makeScale(1, len, 1);
    const mm = new THREE.Matrix4().multiplyMatrices(m, s);
    // the flower specks of gorse
    const col = i % 7 < 2 ? 0x8a7016 : green.getHex();
    items.push({ geo: spikeGeo.clone(), matrix: mm, color: col });
  }
  return mergeGeoms(items);
}

function makeHeatherGeometry(rng) {
  const items = [];
  const col = new THREE.Color().setHSL(0.83 + rng.range(-0.03, 0.03), 0.34, rng.range(0.30, 0.38));
  const core = new THREE.IcosahedronGeometry(0.26, 1);
  core.scale(1, 0.62, 1);
  core.translate(0, 0.13, 0);
  items.push({ geo: core, color: col.clone().multiplyScalar(0.6).getHex() });
  const tip = new THREE.IcosahedronGeometry(0.13, 0);
  for (let i = 0; i < 7; i++) {
    const m = new THREE.Matrix4().makeTranslation(rng.range(-0.22, 0.22), rng.range(0.18, 0.30), rng.range(-0.22, 0.22));
    items.push({ geo: tip.clone(), matrix: m, color: col.getHex() });
  }
  return mergeGeoms(items);
}

function makeBrackenGeometry(rng) {
  const items = [];
  const green = new THREE.Color().setHSL(0.23 + rng.range(-0.03, 0.03), 0.48, rng.range(0.13, 0.19));
  const fronds = 11;
  for (let k = 0; k < fronds; k++) {
    const a = (k / fronds) * Math.PI * 2 + rng.range(-0.3, 0.3);
    const tilt = rng.range(0.55, 1.0);
    const len = rng.range(0.65, 1.15);
    const blade = new THREE.PlaneGeometry(0.17, len, 1, 4);
    // taper and arch the blade
    const p = blade.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const t = (p.getY(i) + len / 2) / len;
      p.setX(i, p.getX(i) * (1 - t * 0.75));
      p.setZ(i, t * t * 0.32);
    }
    blade.translate(0, len / 2, 0);
    blade.computeVertexNormals();
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(-tilt, a, 0, 'YXZ'));
    const m = new THREE.Matrix4().makeRotationFromQuaternion(q);
    items.push({ geo: blade, matrix: m, color: green.getHex() });
  }
  return mergeGeoms(items);
}

export class Vegetation {
  constructor(island, rng, atmos, avoid = []) {
    this.island = island;
    this.rng = rng;
    this.atmos = atmos;
    this.avoid = avoid;
    this.group = new THREE.Group();
    this.group.name = 'vegetation';
    this.wind = { value: 0 };
    this.time = { value: 0 };
    this._makeMaterials();
    this._build();
  }

  _makeMaterials() {
    const atmos = this.atmos;
    const breeze = (mat, strength, speed = 1) => {
      mat.onBeforeCompile = (shader) => {
        shader.uniforms.uTime = this.time;
        shader.uniforms.uWind = { value: strength };
        shader.vertexShader = shader.vertexShader
          .replace('#include <common>', /* glsl */`
            #include <common>
            uniform float uTime;
            uniform float uWind;
          `)
          .replace('#include <begin_vertex>', /* glsl */`
            #include <begin_vertex>
            // sway in world space, scaled by height within the plant
            vec4 wp0 = modelMatrix * vec4(transformed, 1.0);
            float swayAmp = uWind * smoothstep(0.0, 2.6, position.y + 0.15);
            float gust = sin(uTime * 0.55 + wp0.x * 0.014 + wp0.z * 0.011) * 0.65 + 0.35;
            float ph = wp0.x * 0.11 + wp0.z * 0.09;
            transformed.x += sin(uTime * ${speed.toFixed(3)} + ph) * swayAmp * gust;
            transformed.z += cos(uTime * ${(speed * 0.83).toFixed(3)} + ph * 1.7) * swayAmp * gust * 0.8;
          `);
        if (typeof window !== 'undefined') window.__vegShaders = (window.__vegShaders || 0) + 1;
      };
      mat.customProgramCacheKey = () => `veg-${strength}`;
      return mat;
    };

    this.leafMat = breeze(new THREE.MeshStandardMaterial({
      vertexColors: true, roughness: 0.86, metalness: 0.0, flatShading: false,
    }), 0.075, 1.05);
    this.bushMat = breeze(new THREE.MeshStandardMaterial({
      vertexColors: true, roughness: 0.9, metalness: 0.0,
    }), 0.02, 1.6);
    this.trunkMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 });
  }

  /** Is this point cleared of plants? */
  _nearAvoid(x, z) {
    for (const [ax, az, r] of this.avoid) {
      const dx = x - ax, dz = z - az;
      if (dx * dx + dz * dz < r * r) return true;
    }
    return false;
  }

  /** Scatter the island. Deterministic from the seed. */
  _build() {
    const island = this.island, rng = this.rng;
    const S = WORLD.size;
    const tries = 90000;
    const trees = [[], [], [], []];   // pine lean variant A, pine B, spire, young
    const bushes = [[], [], [], []];  // gorse, heather, bracken, rock
    const rockSpots = [];

    for (let i = 0; i < tries; i++) {
      const x = rng.range(-S / 2, S / 2);
      const z = rng.range(-S / 2, S / 2);
      const surf = island.surfaceAt(x, z);
      if (surf.height < 1.2) continue;
      // density: lush in the low sheltered valleys, sparse and bent high up
      const shelter = clamp01(1 - surf.seaDist / 120) * 0.6 + 0.4;
      const heightPenalty = smoothstep(90, 30, surf.height);
      const moisture = surf.moisture;
      const density = clamp01(moisture * 0.8 + 0.25) * shelter * heightPenalty * (1 - surf.slope * 1.15);
      if (density <= 0.02) continue;
      const r = rng();
      if (r > density * 0.075) continue;
      // keep the very centre clear - the player starts near the shore
      if (island.seaDistAt(x, z) < 3) continue;
      if (this._nearAvoid(x, z)) continue;
      const kind = rng.chance(0.56) ? 0 : rng.chance(0.5) ? 1 : rng.chance(0.72) ? 2 : 3;
      trees[kind].push([x, surf.height, z, rng.range(0.72, 1.35), rng.range(0, Math.PI * 2)]);
    }

    // bushes: far more of these
    for (let i = 0; i < 24000; i++) {
      const x = rng.range(-S / 2, S / 2);
      const z = rng.range(-S / 2, S / 2);
      if (this._nearAvoid(x, z)) continue;
      const surf = island.surfaceAt(x, z);
      if (surf.height < 0.7) continue;
      if (surf.slope > 0.34) continue;
      const m = surf.moisture;
      const hot = fbm2(x * 0.008 + 3, z * 0.008 - 7, this.island.seed ^ 0x9911, 3);
      const coast = clamp01(1 - surf.seaDist / 55);
      if (rng() > m * 0.55 + hot * 0.3 + coast * 0.25 + 0.08) continue;
      const kind = hot > 0.62 ? 1 : hot > 0.44 ? (rng.chance(0.6) ? 0 : 2) : (rng.chance(0.5) ? 2 : 0);
      bushes[kind].push([x, surf.height - 0.05, z, rng.range(0.7, 1.6), rng.range(0, Math.PI * 2)]);
    }

    // boulders: scattered, denser near the cliffs
    for (let i = 0; i < 9000; i++) {
      const x = rng.range(-S / 2, S / 2);
      const z = rng.range(-S / 2, S / 2);
      if (this._nearAvoid(x, z)) continue;
      const surf = island.surfaceAt(x, z);
      if (surf.height < 0.4) continue;
      const cliff = smoothstep(0.3, 0.62, surf.slope) + clamp01(1 - surf.seaDist / 22) * 0.35;
      if (rng() > cliff * 0.75 + 0.03) continue;
      rockSpots.push([x, surf.height, z, rng.range(0.35, 2.6), rng.range(0, Math.PI * 2)]);
    }

    this.trees = trees;
    this.bushes = bushes;
    this.rockSpots = rockSpots;

    // --- build the geometries (seeded, so the island is the same every time)
    const geos = {
      0: makePineGeometry(makeRng(101), 2.2, 8.6),
      1: makePineGeometry(makeRng(202), 0.7, 11.5),
      2: makeSpireGeometry(makeRng(303), 1.6, 13.5),
      3: makeSpireGeometry(makeRng(404), 0.3, 7.0),
    };
    this.treeMeshes = [];
    for (let k = 0; k < 4; k++) {
      const list = trees[k];
      if (!list.length) continue;
      const im = new THREE.InstancedMesh(geos[k], this.leafMat, list.length);
      const m = new THREE.Matrix4();
      const q = new THREE.Quaternion();
      const s = new THREE.Vector3();
      const c = new THREE.Color();
      for (let i = 0; i < list.length; i++) {
        const [x, y, z, sc, rot] = list[i];
        q.setFromEuler(new THREE.Euler(0, rot, 0));
        s.set(sc, sc * rng.range(0.9, 1.15), sc);
        m.compose(new THREE.Vector3(x, y - 0.25, z), q, s);
        im.setMatrixAt(i, m);
        c.setHSL(0.34 + rng.range(-0.04, 0.04), 0.42, rng.range(0.42, 0.62));
        im.setColorAt(i, c);
      }
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
      im.castShadow = true;
      im.receiveShadow = true;
      im.frustumCulled = true;
      im.computeBoundingBox(); im.computeBoundingSphere();
      this.group.add(im);
      this.treeMeshes.push(im);
    }

    const bushGeos = { 0: makeGorseGeometry(makeRng(505)), 1: makeHeatherGeometry(makeRng(606)), 2: makeBrackenGeometry(makeRng(707)) };
    this.bushMeshes = [];
    for (let k = 0; k < 3; k++) {
      const list = bushes[k];
      if (!list.length) continue;
      const im = new THREE.InstancedMesh(bushGeos[k], this.bushMat, list.length);
      const m = new THREE.Matrix4();
      const q = new THREE.Quaternion();
      const s = new THREE.Vector3();
      const c = new THREE.Color();
      for (let i = 0; i < list.length; i++) {
        const [x, y, z, sc, rot] = list[i];
        q.setFromEuler(new THREE.Euler(0, rot, 0));
        s.set(sc, sc, sc);
        m.compose(new THREE.Vector3(x, y, z), q, s);
        im.setMatrixAt(i, m);
        c.setHSL(0.32, 0.4, k === 1 ? 0.72 : 0.55);
        im.setColorAt(i, c);
      }
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
      im.castShadow = false;
      im.receiveShadow = true;
      this.group.add(im);
      this.bushMeshes.push(im);
    }

    // rocks: one simple boulder mesh, many instances
    const rockGeo = new THREE.IcosahedronGeometry(1, 1);
    const rp = rockGeo.attributes.position;
    for (let i = 0; i < rp.count; i++) {
      const v = new THREE.Vector3(rp.getX(i), rp.getY(i), rp.getZ(i));
      const n = 1 + (noise2(v.x * 1.7 + 3, v.y * 1.7 - v.z * 1.3 + 8, 9) - 0.5) * 0.55;
      v.multiplyScalar(n * 0.78);
      rp.setXYZ(i, v.x, v.y * 0.82, v.z);
    }
    rockGeo.computeVertexNormals();
    const rockMat = new THREE.MeshStandardMaterial({ color: 0x6f6a62, roughness: 0.95 });
    const rock = new THREE.InstancedMesh(rockGeo, rockMat, rockSpots.length);
    {
      const m = new THREE.Matrix4();
      const q = new THREE.Quaternion();
      const s = new THREE.Vector3();
      const c = new THREE.Color();
      for (let i = 0; i < rockSpots.length; i++) {
        const [x, y, z, sc, rot] = rockSpots[i];
        q.setFromEuler(new THREE.Euler(0, rot, 0));
        s.set(sc, sc * 0.8, sc);
        m.compose(new THREE.Vector3(x, y - sc * 0.22, z), q, s);
        rock.setMatrixAt(i, m);
        c.setHSL(0.08, 0.06, rng.range(0.28, 0.5));
        rock.setColorAt(i, c);
      }
      rock.instanceMatrix.needsUpdate = true;
      if (rock.instanceColor) rock.instanceColor.needsUpdate = true;
      rock.castShadow = true;
      rock.receiveShadow = true;
      this.group.add(rock);
    }
    this.rockMesh = rock;

    this._buildGrass();
  }

  _buildGrass() {
    const island = this.island, rng = this.rng;
    const S = WORLD.size;
    const CELL = 24;
    this.grassCells = new Map();
    const blades = [];
    for (let i = 0; i < 260000; i++) {
      const x = rng.range(-S / 2, S / 2);
      const z = rng.range(-S / 2, S / 2);
      if (this._nearAvoid(x, z)) continue;
      const surf = island.surfaceAt(x, z);
      if (surf.grass <= 0.06) continue;
      const m = surf.moisture;
      const patch = fbm2(x * 0.045 + 9, z * 0.045 - 5, island.seed ^ 0x4141, 3);
      if (rng() > surf.grass * (0.3 + m * 0.6) * (0.5 + patch * 0.8) + 0.02) continue;
      blades.push([x, surf.height - 0.08, z, rng.range(0.5, 1.25), rng.range(0, Math.PI)]);
    }
    for (const b of blades) {
      const cx = Math.floor(b[0] / CELL), cz = Math.floor(b[2] / CELL);
      const k = `${cx},${cz}`;
      let arr = this.grassCells.get(k);
      if (!arr) { arr = []; this.grassCells.set(k, arr); }
      arr.push(b);
    }

    // one instanced mesh per grass type, allocated lazily
    const blade = grassBladeGeometry();
    this.grassMat = new THREE.MeshStandardMaterial({
      vertexColors: true, roughness: 0.8, metalness: 0,
      side: THREE.DoubleSide,
    });
    // gentle wind on the blades
    this.grassMat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = this.time;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uTime;')
        .replace('#include <begin_vertex>', /* glsl */`
          #include <begin_vertex>
          vec4 wp0 = modelMatrix * vec4(transformed, 1.0);
          float t = clamp(position.y / 0.5, 0.0, 1.0);
          float ph = wp0.x * 0.21 + wp0.z * 0.17;
          float gust = sin(uTime * 1.4 + ph) + 0.4 * sin(uTime * 2.9 + ph * 1.6);
          transformed.x += gust * 0.045 * t * t;
          transformed.z += gust * 0.030 * t * t;
        `);
    };
    this.grassMat.customProgramCacheKey = () => 'grass-mat';
    this.grassGeo = blade;
    this.grassInstanced = new Map();
    this.grassDistance = 46;
    this.grassMax = 9000;
    this.grassMesh = new THREE.InstancedMesh(blade, this.grassMat, this.grassMax);
    this.grassMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.grassMesh.frustumCulled = false;
    this.grassMesh.castShadow = false;
    this.grassMesh.receiveShadow = true;
    this.grassMesh.count = 0;
    this.group.add(this.grassMesh);
    this._grassDummy = new THREE.Object3D();
    this._grassColor = new THREE.Color();
    this._grassRng = makeRng(4242);
  }

  update(camera, dt, time) {
    this.time.value = time;
    // grass: only cells near the camera
    const cx = Math.floor(camera.position.x / 24), cz = Math.floor(camera.position.z / 24);
    const R = Math.ceil(this.grassDistance / 24);
    const list = [];
    for (let dz = -R; dz <= R && list.length < this.grassMax * 0.6; dz++) {
      for (let dx = -R; dx <= R; dx++) {
        const cell = this.grassCells.get(`${cx + dx},${cz + dz}`);
        if (cell) for (const b of cell) list.push(b);
      }
    }
    // distance sort: keep the nearest blades
    if (list.length > this.grassMax) {
      const px = camera.position.x, pz = camera.position.z;
      list.sort((a, b) => (a[0] - px) ** 2 + (a[2] - pz) ** 2 - ((b[0] - px) ** 2 + (b[2] - pz) ** 2));
      list.length = this.grassMax;
    }
    const d = this._grassDummy;
    const rngC = this._grassRng;
    for (let i = 0; i < list.length; i++) {
      const b = list[i];
      d.position.set(b[0], b[1], b[2]);
      d.rotation.set(0, b[4], 0);
      d.scale.set(b[3], b[3], b[3]);
      d.updateMatrix();
      this.grassMesh.setMatrixAt(i, d.matrix);
      this._grassColor.setHSL(0.26 + rngC.range(-0.03, 0.03), 0.4, rngC.range(0.23, 0.4));
      this.grassMesh.setColorAt(i, this._grassColor);
    }
    this.grassMesh.count = list.length;
    this.grassMesh.instanceMatrix.needsUpdate = true;
    if (this.grassMesh.instanceColor) this.grassMesh.instanceColor.needsUpdate = true;
  }

  /** Trunk positions the player can walk into. */
  colliders(callback) {
    for (const list of this.trees) {
      for (const [x, y, z, sc] of list) callback(x, y, z, 0.42 * sc);
    }
    for (const list of this.rockSpots) {
      const [x, y, z, sc] = list;
      if (sc > 1.0) callback(x, y - sc * 0.2, z, sc * 0.78);
    }
  }
}

function grassBladeGeometry() {
  // a fan of three tapered blades springing from one root
  const geos = [];
  const angles = [0, 0.7, -0.7];
  for (let b = 0; b < 3; b++) {
    const g = new THREE.PlaneGeometry(0.07, 0.42 + b * 0.08, 1, 2);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const ly = p.getY(i);
      const t = clamp01((ly + 0.25) / 0.5);
      p.setX(i, p.getX(i) * (1 - t * 0.78));
      p.setZ(i, t * t * 0.16);
    }
    g.translate(0.02 * (b - 1), 0.21, 0.02 * (b % 2 ? 1 : -1));
    const m = new THREE.Matrix4().makeRotationY(angles[b]);
    g.applyMatrix4(m);
    geos.push(g);
  }
  const positions = [];
  const normals = [];
  const indices = [];
  const colors = [];
  let base = 0;
  for (const g of geos) {
    const gg = g.toNonIndexed();
    const p = gg.attributes.position, n = gg.attributes.normal;
    for (let i = 0; i < p.count; i++) {
      positions.push(p.getX(i), p.getY(i), p.getZ(i));
      normals.push(n.getX(i), n.getY(i), n.getZ(i));
      const t = clamp01(p.getY(i) / 0.5);
      colors.push(lerp(0.30, 0.80, t), lerp(0.28, 0.82, t), lerp(0.13, 0.52, t));
    }
    const idx = gg.index ? gg.index.array : null;
    const nv = p.count;
    for (let i = 0; i < nv; i++) indices.push(base + i);
    base += nv;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  out.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  out.setIndex(indices);
  return out;
}
