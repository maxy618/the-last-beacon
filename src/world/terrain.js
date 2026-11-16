// ---------------------------------------------------------------------------
// Terrain rendering.
//
// The island heightmap is streamed as a quad tree of chunk meshes. Chunks near
// the player are rebuilt at 1 m resolution, further ones fall back to coarser
// levels, and a skirt around every chunk hides the seams. The material is a
// MeshStandardMaterial with procedural rock, soil, sand and moss injected
// into it, so it still receives real shadows and real lighting.
// ---------------------------------------------------------------------------

import * as THREE from 'three';
import { NOISE_GLSL, ATMOS_GLSL } from '../shaders/common.js';
import { WORLD } from './island.js';
import { clamp, clamp01, lerp, smoothstep } from '../core/math.js';

const WORLD_SIZE = WORLD.size;

const CHUNK = 32;                 // metres
const GRID = 40;                  // chunks per side (40 * 32 = 1280 m)
const LOD_QUADS = [32, 16, 8, 4]; // quads per chunk edge per LOD
const MAX_LOD = LOD_QUADS.length - 1;

// distance (metres) at which a chunk switches to the next coarser level
const LOD_DIST = [58, 150, 360, 760];

const TERRAIN_PARS = /* glsl */`
  // Triplanar normal blending (whiteout style).
  vec3 triplanarNormal(vec3 n, vec3 tx, vec3 ty, vec3 tz, vec3 bw) {
    vec3 nx = vec3(tx.xy + n.zy, abs(tx.z) * n.x);
    vec3 ny = vec3(ty.xy + n.xz, abs(ty.z) * n.y);
    vec3 nz = vec3(tz.xy + n.xy, abs(tz.z) * n.z);
    return normalize(nx.zyx * bw.x + ny.xzy * bw.y + nz.xyz * bw.z);
  }
`;

export class Terrain {
  constructor(island, atmos, quality, detailTex) {
    this.island = island;
    this.atmos = atmos;
    this.group = new THREE.Group();
    this.group.name = 'terrain';
    this.chunks = new Map();       // key -> mesh
    this.cache = new Map();        // "cx,cz,lod" -> geometry
    this.material = makeTerrainMaterial(atmos, island, detailTex);
    this.visible = new Set();
    this._dirty = true;
    this.stats = { chunks: 0, tris: 0 };
  }

  key(cx, cz, lod) { return `${cx},${cz},${lod}`; }

  /** Choose the LOD for a chunk from its distance to the camera. */
  _lodForDistance(d) {
    for (let l = 0; l <= MAX_LOD; l++) if (d < LOD_DIST[l]) return l;
    return -1;
  }

  /**
   * Chunks to display: every chunk whose nearest point is within range gets
   * the LOD that matches its distance.
   */
  _select(camX, camZ) {
    const want = new Map();
    const half = GRID / 2;
    for (let cz = 0; cz < GRID; cz++) {
      for (let cx = 0; cx < GRID; cx++) {
        const minX = (cx - GRID / 2) * CHUNK, maxX = (cx - GRID / 2 + 1) * CHUNK;
        const minZ = (cz - GRID / 2) * CHUNK, maxZ = (cz - GRID / 2 + 1) * CHUNK;
        const dx = Math.max(minX - camX, 0, camX - maxX);
        const dz = Math.max(minZ - camZ, 0, camZ - maxZ);
        const d = Math.hypot(dx, dz);
        const lod = this._lodForDistance(d);
        if (lod < 0) continue;
        want.set(`${cx},${cz}`, lod);
      }
    }
    return want;
  }

  _buildGeometry(cx, cz, lod) {
    const q = LOD_QUADS[lod];
    const step = CHUNK / q;
    const x0 = (cx - GRID / 2) * CHUNK, z0 = (cz - GRID / 2) * CHUNK;
    const H = this.island.height;
    const R = this.island.height.length ? Math.sqrt(H.length) | 0 : 0;

    const n = (q + 1) * (q + 1);
    const pos = new Float32Array(n * 3);
    const nor = new Float32Array(n * 3);
    const splat = new Float32Array(n * 4);
    const extra = new Float32Array(n * 2); // snow, ao

    const hAt = (x, z) => this.island.heightAt(x, z);
    const nAt = (x, z) => this.island.normalAt(x, z);

    // --- vertex heights, normals, splat weights
    for (let j = 0; j <= q; j++) {
      for (let i = 0; i <= q; i++) {
        const x = x0 + i * step, z = z0 + j * step;
        const k = j * (q + 1) + i;
        const h = hAt(x, z);
        pos[k * 3] = x; pos[k * 3 + 1] = h; pos[k * 3 + 2] = z;
        const n = nAt(x, z);
        nor[k * 3] = n[0]; nor[k * 3 + 1] = n[1]; nor[k * 3 + 2] = n[2];
        const s = this.island.surfaceAt(x, z);
        splat[k * 4] = s.sand;
        splat[k * 4 + 1] = s.grass;
        splat[k * 4 + 2] = s.rock;
        splat[k * 4 + 3] = s.moss;
        extra[k * 2] = s.snow;
        extra[k * 2 + 1] = s.ao ?? 1;
      }
    }

    // --- indices
    const idx = new Uint32Array(q * q * 6);
    let t = 0;
    for (let j = 0; j < q; j++) {
      for (let i = 0; i < q; i++) {
        const a = j * (q + 1) + i, b = a + 1, c = a + q + 1, d = c + 1;
        idx[t++] = a; idx[t++] = c; idx[t++] = b;
        idx[t++] = b; idx[t++] = c; idx[t++] = d;
      }
    }

    // --- skirt: a ring of vertices dropped below the edge
    const edge = [];
    for (let i = 0; i <= q; i++) edge.push(i);
    for (let j = 1; j <= q; j++) edge.push(j * (q + 1) + q);
    for (let i = q - 1; i >= 0; i--) edge.push(q * (q + 1) + i);
    for (let j = q - 1; j >= 1; j--) edge.push(j * (q + 1));
    const E = edge.length;

    const skirtDrop = step * 2.4 + 2.0;
    const totalV = n + E * 2;
    const p2 = new Float32Array(totalV * 3);
    const n2 = new Float32Array(totalV * 3);
    const s2 = new Float32Array(totalV * 4);
    const e2 = new Float32Array(totalV * 2);
    p2.set(pos); n2.set(nor); s2.set(splat); e2.set(extra);

    for (let e = 0; e < E; e++) {
      const src = edge[e];
      const top = n + e, bot = n + E + e;
      for (const [dst, drop] of [[top, 0], [bot, skirtDrop]]) {
        p2[dst * 3] = p2[src * 3];
        p2[dst * 3 + 1] = p2[src * 3 + 1] - drop;
        p2[dst * 3 + 2] = p2[src * 3 + 2];
        n2[dst * 3] = n2[src * 3];
        n2[dst * 3 + 1] = n2[src * 3 + 1];
        n2[dst * 3 + 2] = n2[src * 3 + 2];
        s2[dst * 4] = s2[src * 4]; s2[dst * 4 + 1] = s2[src * 4 + 1];
        s2[dst * 4 + 2] = s2[src * 4 + 2]; s2[dst * 4 + 3] = s2[src * 4 + 3];
        e2[dst * 2] = e2[src * 2]; e2[dst * 2 + 1] = e2[src * 2 + 1];
      }
    }

    const idx2 = new Uint32Array(idx.length + E * 6);
    idx2.set(idx);
    let t2 = idx.length;
    for (let e = 0; e < E; e++) {
      const e2i = (e + 1) % E;
      const aTop = n + e, aBot = n + E + e;
      const bTop = n + e2i, bBot = n + E + e2i;
      idx2[t2++] = aTop; idx2[t2++] = aBot; idx2[t2++] = bTop;
      idx2[t2++] = bTop; idx2[t2++] = aBot; idx2[t2++] = bBot;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(p2, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(n2, 3));
    geo.setAttribute('aSplat', new THREE.BufferAttribute(s2, 4));
    geo.setAttribute('aExtra', new THREE.BufferAttribute(e2, 2));
    geo.setIndex(new THREE.BufferAttribute(idx2, 1));
    geo.computeBoundingSphere();
    geo.computeBoundingBox();
    return geo;
  }

  _geometry(cx, cz, lod) {
    const k = this.key(cx, cz, lod);
    let g = this.cache.get(k);
    if (!g) {
      g = this._buildGeometry(cx, cz, lod);
      if (this.cache.size > 900) {
        // drop the oldest quarter
        const keys = [...this.cache.keys()].slice(0, Math.floor(this.cache.size / 4));
        for (const kk of keys) { const gg = this.cache.get(kk); gg.dispose(); this.cache.delete(kk); }
      }
      this.cache.set(k, g);
    }
    return g;
  }

  /** Refresh the visible chunk set. Call once per frame; work is budgeted. */
  update(camX, camZ, budgetMs = 3) {
    const want = this._select(camX, camZ);
    // remove chunks that are no longer wanted
    for (const [k, mesh] of this.chunks) {
      const [cx, cz] = k.split(',').map(Number);
      if (!want.has(`${cx},${cz}`)) {
        this.group.remove(mesh);
        this.chunks.delete(k);
      }
    }
    // add missing ones, nearest first
    const missing = [];
    for (const [k, lod] of want) {
      if (this.chunks.has(k)) {
        const mesh = this.chunks.get(k);
        if (mesh.userData.lod !== lod) { this.group.remove(mesh); this.chunks.delete(k); missing.push([k, lod]); }
      } else missing.push([k, lod]);
    }
    missing.sort((a, b) => {
      const [ax, az] = a[0].split(',').map(Number);
      const [bx, bz] = b[0].split(',').map(Number);
      const da = Math.hypot((ax + 0.5) * CHUNK - camX, (az + 0.5) * CHUNK - camZ);
      const db = Math.hypot((bx + 0.5) * CHUNK - camX, (bz + 0.5) * CHUNK - camZ);
      return da - db;
    });
    const t0 = performance.now();
    for (const [k, lod] of missing) {
      const [cx, cz] = k.split(',').map(Number);
      const geo = this._geometry(cx, cz, lod);
      const mesh = new THREE.Mesh(geo, this.material);
      mesh.userData.lod = lod;
      mesh.castShadow = lod <= 1;
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      this.group.add(mesh);
      this.chunks.set(k, mesh);
      if (performance.now() - t0 > budgetMs) break;
    }
    let tris = 0;
    for (const m of this.chunks.values()) tris += m.geometry.index.count / 3;
    this.stats.chunks = this.chunks.size;
    this.stats.tris = tris;
  }
}

function edgeCountUnused() {}

/** A standard material with procedural rock / soil / sand / moss on top. */
export function makeTerrainMaterial(atmos, island, detailTex) {
  const mat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.95,
    metalness: 0.0,
    dithering: true,
  });

  // --- the island's own baked shadow in the sun's direction
  let shadowTex = null;
  if (island) {
    const res = 512;
    const data = island.bakeSunShadow(atmos.sunDir, res);
    shadowTex = new THREE.DataTexture(data, res, res, THREE.RedFormat, THREE.UnsignedByteType);
    shadowTex.needsUpdate = true;
    shadowTex.minFilter = THREE.LinearFilter;
    shadowTex.magFilter = THREE.LinearFilter;
    shadowTex.wrapS = shadowTex.wrapT = THREE.ClampToEdgeWrapping;
  }

  mat.customProgramCacheKey = () => 'terrain-proc-v2';
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uAtmos = atmos.uAtmos;
    shader.uniforms.uCamPos = atmos.uCamPos;
    shader.uniforms.tSunShadow = { value: shadowTex };
    shader.uniforms.tDetail = { value: detailTex };
    shader.uniforms.uWorldSize = { value: WORLD_SIZE };
    shader.uniforms.uDebugSplat = { value: (typeof location !== 'undefined' && location.hash === '#debugsplat') ? 1 : 0 };

    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', /* glsl */`
        #include <common>
        attribute vec4 aSplat;
        attribute vec2 aExtra;
        varying vec4 vSplat;
        varying vec2 vExtra;
        varying vec3 vWorld;
        varying vec3 vWN;
      `)
      .replace('#include <begin_vertex>', /* glsl */`
        #include <begin_vertex>
        vSplat = aSplat;
        vExtra = aExtra;
        vWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
        vWN = normal;
      `);

    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', /* glsl */`
        #include <common>
        varying vec4 vSplat;
        varying vec2 vExtra;
        varying vec3 vWorld;
        varying vec3 vWN;
        uniform vec4 uAtmos[6];
        uniform vec3 uCamPos;
        uniform sampler2D tSunShadow;
        uniform sampler2D tDetail;
        uniform float uWorldSize;
        uniform float uDebugSplat;
        ${NOISE_GLSL}
        ${ATMOS_GLSL}
        ${TERRAIN_PARS}
      `)
      .replace('#include <map_fragment>', /* glsl */`
        // the island's baked sun shadow (whole map, not just around the player)
        float sunShadowFactor = texture2D(tSunShadow, vWorld.xz / uWorldSize + 0.5).r;

        vec2 wp = vWorld.xz;
        float slope = 1.0 - clamp(vWN.y, 0.0, 1.0);

        float det = fbm2(wp * 0.085, 4) * 0.9 + ridge2(wp * 0.24, 3) * 0.35;
        float soilH = fbm2(wp * 0.42, 4);
        float patchH = fbm2(wp * 0.11 + 13.0, 3);
        float sandH = fbm2(wp * 1.7, 2);
        float mossH = fbm2(wp * 0.85 + 31.0, 3);
        float lichenH = fbm2(wp * 2.6 + 77.0, 3);

        // --- sand and shingle
        vec3 sandC = mix(vec3(0.70, 0.63, 0.49), vec3(0.84, 0.78, 0.63), sandH);
        sandC *= 0.88 + 0.24 * fbm2(wp * 7.0, 2);
        // --- turf: deep green, drier and browner on the ridges
        vec3 turfA = vec3(0.115, 0.215, 0.062);
        vec3 turfB = vec3(0.225, 0.300, 0.088);
        vec3 turfC = vec3(0.315, 0.300, 0.115);
        vec3 grassC = mix(turfA, turfB, soilH);
        grassC = mix(grassC, turfC, smoothstep(0.45, 0.85, patchH) * 0.75);
        grassC *= 0.88 + 0.26 * fbm2(wp * 4.1, 2);
        // --- rock: cool grey with warm bedding planes
        vec3 rockA = vec3(0.245, 0.245, 0.255);
        vec3 rockB = vec3(0.395, 0.375, 0.335);
        vec3 rockC2 = mix(rockA, rockB, det * 0.7 + 0.3);
        float strata = sin(vWorld.y * 0.62 + det * 2.6 + patchH * 2.0) * 0.5 + 0.5;
        rockC2 *= 0.82 + 0.30 * strata;
        rockC2 = mix(rockC2, vec3(0.255, 0.205, 0.150), fbm2(wp * 0.11 + 7.0, 2) * 0.40);
        // lichen and moss on the rock
        rockC2 = mix(rockC2, vec3(0.30, 0.33, 0.22), smoothstep(0.55, 0.85, lichenH) * 0.42);
        // --- moss
        vec3 mossC = mix(vec3(0.070, 0.155, 0.055), vec3(0.135, 0.245, 0.085), mossH);

        vec3 alb = sandC * vSplat.x + grassC * vSplat.y + rockC2 * vSplat.z + mossC * vSplat.w;
        if (uDebugSplat > 0.5) alb = vec3(vSplat.x, vSplat.y, vSplat.z);

        // detail texture: cracks, mottling and a hint of damp in the hollows
        vec4 dtl = texture2D(tDetail, wp * 0.55);
        vec4 dtl2 = texture2D(tDetail, wp * 0.13 + 0.37);
        float camDist = length(vWorld - uCamPos);
        float dtlFade = 1.0 - smoothstep(15.0, 60.0, camDist);
        float crack = (1.0 - dtl.b) * dtlFade;
        float mott = dtl.a * 0.6 + dtl2.a * 0.4;
        alb *= 0.86 + 0.26 * mott;
        alb *= 1.0 - crack * 0.11 * vSplat.z;
        // exposed rock on steep faces: cooler, bluer, faintly banded
        float banded = smoothstep(0.3, 0.8, vSplat.z * slope) * (0.5 + 0.5 * sin(vWorld.y * 0.30 + det * 2.2));
        alb *= 1.0 - banded * 0.22;
        // sand and turf are smoother than bare rock
        alb *= mix(1.0, 0.90, vSplat.x);

        // snow on the high flats
        alb = mix(alb, vec3(0.86, 0.90, 0.96), clamp(vExtra.x, 0.0, 1.0) * smoothstep(0.40, 0.12, slope));

        // subtle large-scale colour drift so the island does not look tiled
        alb *= 0.92 + 0.16 * fbm2(wp * 0.017 + 91.0, 3);

        diffuseColor.rgb *= alb;
      `)
      .replace('#include <roughnessmap_fragment>', /* glsl */`
        float roughnessFactor = roughness;
        {
          vec2 wp2 = vWorld.xz;
          float wet = smoothstep(0.55, 0.9, fbm2(wp2 * 0.035 + 4.0, 3));
          roughnessFactor = mix(0.98, 0.72, wet * 0.5);
          roughnessFactor = mix(roughnessFactor, 0.55, vSplat.x * 0.35);
        }
      `)
      .replace('#include <normal_fragment_maps>', /* glsl */`
        {
          // triplanar detail from the baked rock texture
          vec3 nw = normalize(vWN);
          vec3 bw = pow(abs(nw), vec3(4.0));
          bw /= (bw.x + bw.y + bw.z);

          float s1 = 0.42;   // ~2.4 m per tile
          float s2 = 0.115;  // ~8.7 m per tile
          vec3 dX = texture2D(tDetail, vWorld.zy * s1).rgb * 2.0 - 1.0;
          vec3 dY = texture2D(tDetail, vWorld.xz * s1).rgb * 2.0 - 1.0;
          vec3 dZ = texture2D(tDetail, vWorld.xy * s1).rgb * 2.0 - 1.0;
          vec3 nDetail = triplanarNormal(nw, dX, dY, dZ, bw);

          vec3 fX = texture2D(tDetail, vWorld.zy * s2 + 0.37).rgb * 2.0 - 1.0;
          vec3 fY = texture2D(tDetail, vWorld.xz * s2 + 0.37).rgb * 2.0 - 1.0;
          vec3 fZ = texture2D(tDetail, vWorld.xy * s2 + 0.37).rgb * 2.0 - 1.0;
          vec3 nFar = triplanarNormal(nw, fX, fY, fZ, bw);

          float near = 1.0 - smoothstep(25.0, 90.0, length(vWorld - uCamPos));
          vec3 wN = normalize(mix(nFar, nDetail, near));
          // turf is smoother than bare rock
          wN = normalize(mix(wN, nw, vSplat.y * 0.45 + vSplat.x * 0.35));
          normal = normalize((viewMatrix * vec4(wN, 0.0)).xyz);
        }
      `)
      .replace('directionalLight = directionalLights[ i ];', /* glsl */`
        directionalLight = directionalLights[ i ];
        directionalLight.color *= sunShadowFactor;
      `)
      .replace('#include <fog_fragment>', /* glsl */`
        gl_FragColor.rgb = applyFog(gl_FragColor.rgb, vWorld);
      `);
    if (typeof window !== 'undefined') { window.__terrainFrag = shader.fragmentShader; }
  };
  return mat;
}
