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
import { NOISE_GLSL, ATMOS_GLSL } from '../shaders/common.js';import { clamp, clamp01, lerp, smoothstep } from '../core/math.js';

const CHUNK = 32;                 // metres
const GRID = 40;                  // chunks per side (40 * 32 = 1280 m)
const LOD_QUADS = [32, 16, 8, 4]; // quads per chunk edge per LOD
const MAX_LOD = LOD_QUADS.length - 1;

// distance (metres) at which a chunk switches to the next coarser level
const LOD_DIST = [58, 150, 360, 760];

const TERRAIN_PARS = /* glsl */`
  // Fills the surface with procedural strata, soil, sand and moss.
  float terrainHeight(vec2 p) {
    float h = fbm2(p * 0.085, 4) * 1.35;
    h += ridge2(p * 0.22, 3) * 0.55;
    h += fbm2(p * 0.9, 2) * 0.12;
    return h;
  }
`;

export class Terrain {
  constructor(island, atmos, quality) {
    this.island = island;
    this.atmos = atmos;
    this.group = new THREE.Group();
    this.group.name = 'terrain';
    this.chunks = new Map();       // key -> mesh
    this.cache = new Map();        // "cx,cz,lod" -> geometry
    this.material = makeTerrainMaterial(atmos);
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
export function makeTerrainMaterial(atmos) {
  const mat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.95,
    metalness: 0.0,
    dithering: true,
  });
  mat.customProgramCacheKey = () => 'terrain-proc-v1';
  mat.onBeforeCompile = (shader) => {
    if (typeof window !== 'undefined') { window.__terrainFrag = shader.fragmentShader; console.log('TERRAINFRAG', shader.fragmentShader.length); }
    shader.uniforms.uAtmos = atmos.uAtmos;
    shader.uniforms.uCamPos = atmos.uCamPos;

    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', /* glsl */`
        #include <common>
        attribute vec4 aSplat;
        attribute vec2 aExtra;
        varying vec4 vSplat;
        varying vec2 vExtra;
        varying vec3 vWorld;
      `)
      .replace('#include <begin_vertex>', /* glsl */`
        #include <begin_vertex>
        vSplat = aSplat;
        vExtra = aExtra;
        vWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
      `);

    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', /* glsl */`
        #include <common>
        varying vec4 vSplat;
        varying vec2 vExtra;
        varying vec3 vWorld;
        uniform vec4 uAtmos[6];
        uniform vec3 uCamPos;
        ${NOISE_GLSL}
        ${ATMOS_GLSL}
        ${TERRAIN_PARS}
      `)
      .replace('#include <map_fragment>', /* glsl */`
        vec2 wp = vWorld.xz;
        float slope = 1.0 - clamp(vNormal.y, 0.0, 1.0);
        // triplanar weights
        vec3 bw = normalize(abs(vNormal) + 1e-4);
        bw = pow(bw, vec3(4.0));
        bw /= (bw.x + bw.y + bw.z);

        float det = terrainHeight(wp);
        float rockH = det;
        float soilH = fbm2(wp * 0.55, 3);
        float sandH = fbm2(wp * 1.6, 2);
        float mossH = fbm2(wp * 0.9 + 31.0, 3);

        vec3 sandC = mix(vec3(0.76, 0.68, 0.53), vec3(0.86, 0.80, 0.66), sandH);
        sandC *= 0.86 + 0.28 * fbm2(wp * 6.0, 2);

        vec3 grassC = mix(vec3(0.16, 0.26, 0.09), vec3(0.30, 0.36, 0.13), soilH);
        grassC = mix(grassC, vec3(0.24, 0.30, 0.11), fbm2(wp * 0.22, 3));
        grassC *= 0.85 + 0.3 * fbm2(wp * 3.3, 2);

        vec3 rockC = mix(vec3(0.29, 0.29, 0.30), vec3(0.44, 0.41, 0.36), rockH);
        // horizontal strata
        float strata = sin(vWorld.y * 0.85 + rockH * 2.2) * 0.5 + 0.5;
        rockC *= 0.86 + 0.26 * strata;
        rockC = mix(rockC, vec3(0.30, 0.26, 0.21), fbm2(wp * 0.13 + 7.0, 2) * 0.45);

        vec3 mossC = mix(vec3(0.10, 0.19, 0.09), vec3(0.17, 0.28, 0.11), mossH);

        vec3 alb = sandC * vSplat.x + grassC * vSplat.y + rockC * vSplat.z + mossC * vSplat.w;
        // normalise the blend so the weights always sum to one
        float wsum = vSplat.x + vSplat.y + vSplat.z + vSplat.w;
        alb = mix(rockC, alb, clamp(wsum, 0.0, 1.0));
        // snow on the high flats
        alb = mix(alb, vec3(0.88, 0.91, 0.96), clamp(vExtra.x, 0.0, 1.0) * smoothstep(0.35, 0.1, slope));

        // subtle large-scale colour drift so the island does not look tiled
        alb *= 0.9 + 0.2 * fbm2(wp * 0.021 + 91.0, 3);

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
          // procedural bump: finite differences of the detail height field
          vec2 wp3 = vWorld.xz;
          float e = 0.35;
          float h0 = terrainHeight(wp3);
          float hx = terrainHeight(wp3 + vec2(e, 0.0));
          float hz = terrainHeight(wp3 + vec2(0.0, e));
          float amp = 0.55 * (1.0 - vSplat.x * 0.6);
          vec3 bump = vec3((h0 - hx) / e, 0.0, (h0 - hz) / e) * amp;
          // flatten the bump on steep rock faces
          bump *= mix(1.0, 0.35, smoothstep(0.35, 0.75, 1.0 - vNormal.y));
          normal = normalize(normal + bump * 0.55);
        }
      `)
      .replace('#include <fog_fragment>', /* glsl */`
        gl_FragColor.rgb = applyFog(gl_FragColor.rgb, vWorld);
      `);
    if (typeof window !== 'undefined') { window.__terrainFrag = shader.fragmentShader; console.log('TERRAINFRAG', shader.fragmentShader.length); }
  };
  return mat;
}
