// ---------------------------------------------------------------------------
// The sea.
//
// One large polar disc carries the ocean: dense inside the island's own
// footprint, stretching out to the horizon. Gerstner swell moves the surface,
// the fragment shader adds fine ripples, and a shore-distance map gives the
// water its depth colour and its foam.
// ---------------------------------------------------------------------------

import * as THREE from 'three';
import { NOISE_GLSL, ATMOS_GLSL, ATMOS_UNIFORMS } from '../shaders/common.js';
import { WORLD } from './island.js';
import { clamp01, smoothstep } from '../core/math.js';

const OCEAN_VS = /* glsl */`
precision highp float;

uniform float uTime;
uniform vec3 uCamPos;
uniform vec3 uSunDir;

varying vec3 vWorld;
varying vec3 vNormalW;
varying float vFoam;
varying float vDepth;

// three Gerstner waves
const vec2 D1 = vec2(0.86, 0.51);
const vec2 D2 = vec2(-0.42, 0.91);
const vec2 D3 = vec2(0.31, -0.95);

void main() {
  vec3 p = position;
  vec3 world = (modelMatrix * vec4(p, 1.0)).xyz;
  vec2 xz = world.xz;
  float t = uTime;

  // wavelength, amplitude, steepness
  float a1 = 0.62, a2 = 0.34, a3 = 0.17;
  float l1 = 71.0, l2 = 37.0, l3 = 19.0;
  float k1 = 6.2831853 / l1, k2 = 6.2831853 / l2, k3 = 6.2831853 / l3;
  float s1 = 0.62, s2 = 0.5, s3 = 0.38;

  float ph1 = dot(D1, xz) * k1 + t * 1.05;
  float ph2 = dot(D2, xz) * k2 + t * 1.45;
  float ph3 = dot(D3, xz) * k3 + t * 2.05;

  float h = a1 * sin(ph1) + a2 * sin(ph2) + a3 * sin(ph3);
  float dhdx = a1 * k1 * D1.x * cos(ph1) + a2 * k2 * D2.x * cos(ph2) + a3 * k3 * D3.x * cos(ph3);
  float dhdz = a1 * k1 * D1.y * cos(ph1) + a2 * k2 * D2.y * cos(ph2) + a3 * k3 * D3.y * cos(ph3);

  // displacement (horizontal pinch)
  float dx = -(s1 * a1 * D1.x * cos(ph1) + s2 * a2 * D2.x * cos(ph2) + s3 * a3 * D3.x * cos(ph3));
  float dz = -(s1 * a1 * D1.y * cos(ph1) + s2 * a2 * D2.y * cos(ph2) + s3 * a3 * D3.y * cos(ph3));

  world.y += h;
  world.x += dx;
  world.z += dz;

  vec3 n = normalize(vec3(-dhdx, 1.0, -dhdz));
  vNormalW = n;
  vWorld = world;
  vFoam = clamp(a1 * sin(ph1) * 0.5 + 0.5, 0.0, 1.0);
  vDepth = 1.0;

  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
}
`;

const OCEAN_FS = /* glsl */`
precision highp float;

varying vec3 vWorld;
varying vec3 vNormalW;
varying float vFoam;
varying float vDepth;

uniform sampler2D tShore;
uniform float uWorldSize;
uniform vec3 uDeepColor;
uniform vec3 uShallowColor;
uniform vec3 uFoamColor;
uniform float uTime;
uniform float uWindScale;

${ATMOS_UNIFORMS}
${NOISE_GLSL}
${ATMOS_GLSL}

void main() {
  vec3 V = normalize(uCamPos - vWorld);
  float dist = length(uCamPos - vWorld);

  // --- fine ripples, faded out with distance to stop aliasing
  vec2 uv = vWorld.xz;
  float detailFade = 1.0 - smoothstep(60.0, 400.0, dist);
  float e = 0.55;
  float n0 = fbm2(uv * 0.42 + vec2(uTime * 0.16, uTime * 0.11), 4);
  float nx = fbm2((uv + vec2(e, 0.0)) * 0.42 + vec2(uTime * 0.16, uTime * 0.11), 4);
  float nz = fbm2((uv + vec2(0.0, e)) * 0.42 + vec2(uTime * 0.16, uTime * 0.11), 4);
  float n1 = fbm2(uv * 1.35 - vec2(uTime * 0.22, uTime * 0.09), 3);
  float nx1 = fbm2((uv + vec2(e, 0.0)) * 1.35 - vec2(uTime * 0.22, uTime * 0.09), 3);
  float nz1 = fbm2((uv + vec2(0.0, e)) * 1.35 - vec2(uTime * 0.22, uTime * 0.09), 3);
  vec3 ripple = vec3((n0 - nx) * 0.55 + (n1 - nx1) * 0.22, 0.0, (n0 - nz) * 0.55 + (n1 - nz1) * 0.22);
  vec3 N = normalize(vNormalW + ripple * uWindScale * detailFade);

  // --- shore distance: how deep is the water here
  vec2 suv = vWorld.xz / uWorldSize + 0.5;
  float shore = texture2D(tShore, clamp(suv, 0.001, 0.999)).r;
  // shore: 0 at the water line, 1 in deep water (metres/40)
  float depth = clamp(shore * 40.0, 0.0, 40.0);

  // --- reflection of the sky
  vec3 R = reflect(-V, N);
  float up = clamp(R.y, 0.0, 1.0);
  vec3 skyRefl = mix(horizonColor(), mix(horizonColor(), uAtmos[2].rgb * 1.4, 0.7), pow(up, 0.5));
  vec3 L = sunDir();
  float sunSpec = pow(max(dot(R, L), 0.0), 420.0);
  float sunGlow = pow(max(dot(R, L), 0.0), 22.0) * 0.35;
  skyRefl += sunColor() * (sunSpec * 3.4 + sunGlow);

  // --- water body colour
  vec3 body = mix(uShallowColor, uDeepColor, clamp(depth / 22.0, 0.0, 1.0));
  // light scattering through the wave crests
  float sss = pow(max(0.0, 1.0 - abs(N.y)), 2.0) * 0.8;
  body += uShallowColor * sss * 0.5 * max(dot(L, vec3(0.0, 1.0, 0.0)), 0.0);

  float fres = 0.02 + 0.98 * pow(1.0 - max(dot(N, V), 0.0), 5.0);
  fres *= smoothstep(0.0, 0.35, depth);

  vec3 col = mix(body, skyRefl, clamp(fres, 0.0, 1.0));

  // --- foam: at the shore, on the wave crests, and where the water is shallow
  float shoreline = 1.0 - smoothstep(0.0, 2.6, depth);
  float waveFoam = smoothstep(0.72, 0.97, vFoam) * smoothstep(1.5, 6.0, depth) * 0.35;
  float rip = fbm2(uv * 0.9 + vec2(uTime * 0.25, -uTime * 0.2), 3);
  float foam = clamp(shoreline * (0.55 + rip * 0.9) + waveFoam, 0.0, 1.0);
  foam *= smoothstep(0.0, 0.35, depth);
  col = mix(col, uFoamColor, foam * 0.85);

  // --- specular highlight from the sun
  vec3 H = normalize(V + L);
  col += sunColor() * pow(max(dot(N, H), 0.0), 900.0) * 2.4 * detailFade;

  gl_FragColor = vec4(applyFog(col, vWorld), 1.0);
}
`;

export class Ocean {
  constructor(island, atmos) {
    this.island = island;
    this.atmos = atmos;

    // --- shore distance map (metres of water depth, normalised)
    const N = 256;
    const data = new Uint8Array(N * N);
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const x = ((i + 0.5) / N - 0.5) * WORLD.size;
        const z = ((j + 0.5) / N - 0.5) * WORLD.size;
        const h = island.heightAt(x, z);
        data[j * N + i] = Math.round(clamp01(-h / 40) * 255);
      }
    }
    const tex = new THREE.DataTexture(data, N, N, THREE.RedFormat, THREE.UnsignedByteType);
    tex.needsUpdate = true;
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    this.shoreTex = tex;

    this.uniforms = {
      uTime: { value: 0 },
      uCamPos: atmos.uCamPos,
      uAtmos: atmos.uAtmos,
      tShore: { value: tex },
      uWorldSize: { value: WORLD.size },
      uDeepColor: { value: new THREE.Color(0.016, 0.055, 0.075) },
      uShallowColor: { value: new THREE.Color(0.055, 0.135, 0.145) },
      uFoamColor: { value: new THREE.Color(0.82, 0.86, 0.88) },
      uSunDir: { value: atmos.sunDir },
      uWindScale: { value: 0.9 },
    };

    const mat = new THREE.ShaderMaterial({
      vertexShader: OCEAN_VS,
      fragmentShader: OCEAN_FS,
      uniforms: this.uniforms,
      side: THREE.FrontSide,
      transparent: false,
    });

    this.mesh = new THREE.Mesh(buildDisc(15000, 170, 150), mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -5;
    this.mesh.receiveShadow = false;
  }

  update(time) {
    this.uniforms.uTime.value = time;
  }
}

/** A polar disc: dense in the middle, coarse towards the horizon. */
function buildDisc(radius, rings, segments) {
  const verts = [];
  const idx = [];
  verts.push(0, 0, 0);
  for (let r = 1; r <= rings; r++) {
    // exponential spacing: fine in the centre, stretched out at the rim
    const t = r / rings;
    const rad = radius * (Math.pow(t, 3.1) * 0.86 + t * 0.14);
    for (let s = 0; s < segments; s++) {
      const a = (s / segments) * Math.PI * 2;
      verts.push(Math.cos(a) * rad, 0, Math.sin(a) * rad);
    }
  }
  for (let s = 0; s < segments; s++) {
    idx.push(0, 1 + s, 1 + ((s + 1) % segments));
  }
  for (let r = 1; r < rings; r++) {
    const base = 1 + (r - 1) * segments;
    const next = 1 + r * segments;
    for (let s = 0; s < segments; s++) {
      const s2 = (s + 1) % segments;
      idx.push(base + s, next + s, base + s2);
      idx.push(base + s2, next + s, next + s2);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), radius);
  return geo;
}
