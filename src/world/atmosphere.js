// ---------------------------------------------------------------------------
// Atmosphere: the sky dome and the lighting model that every material shares.
//
// One place decides where the sun is, what colour it is, how thick the haze
// is and what the sky contributes to ambient light. Everything else reads
// from it.
// ---------------------------------------------------------------------------

import * as THREE from 'three';
import { NOISE_GLSL } from '../shaders/common.js';
import { clamp, clamp01, lerp, smoothstep } from '../core/math.js';

export const WEATHERS = {
  clear:    { label: 'Clear',        cloud: 0.26, sunI: 1.00, haze: 0.22, rain: 0,    wind: 0.35, exposure: 1.00 },
  fair:     { label: 'Fair',         cloud: 0.45, sunI: 0.92, haze: 0.34, rain: 0,    wind: 0.5,  exposure: 1.02 },
  hazy:     { label: 'Hazy',         cloud: 0.58, sunI: 0.78, haze: 0.58, rain: 0,    wind: 0.4,  exposure: 1.06 },
  overcast: { label: 'Overcast',     cloud: 0.92, sunI: 0.30, haze: 0.62, rain: 0.05, wind: 0.65, exposure: 1.12 },
  drizzle:  { label: 'Drizzle',      cloud: 0.85, sunI: 0.42, haze: 0.70, rain: 0.55, wind: 0.7,  exposure: 1.10 },
  squall:   { label: 'Squall',       cloud: 0.98, sunI: 0.50, haze: 0.66, rain: 0.9,  wind: 1.0,  exposure: 1.08 },
};

const SKY_VS = /* glsl */`
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_Position.z = gl_Position.w;   // always at the far plane
}
`;

const SKY_FS = /* glsl */`
precision highp float;
varying vec3 vDir;

uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uSeaHaze;
uniform float uSunDisc;
uniform float uCloud;
uniform float uCloudSharp;
uniform float uTime;
uniform vec2 uCloudDrift;
uniform float uHaze;
uniform vec3 uCamPos;
uniform float uLightning;

${NOISE_GLSL}

// cheap two-octave curl to break up the cloud field
vec2 curl(vec2 p) {
  float e = 0.35;
  float n1 = vnoise2(p + vec2(0.0, e));
  float n2 = vnoise2(p - vec2(0.0, e));
  float n3 = vnoise2(p + vec2(e, 0.0));
  float n4 = vnoise2(p - vec2(e, 0.0));
  return vec2(n1 - n2, n3 - n4) * 0.5;
}

float cloudField(vec2 uv) {
  vec2 p = uv + curl(uv * 0.6) * 0.25 + uCloudDrift;
  float f = fbm2(p, 5);
  float d = smoothstep(0.62 - uCloud * 0.45, 0.92 - uCloud * 0.42, f);
  // wispy edges
  float w = fbm2(p * 3.1 + 21.0, 3);
  d = clamp(d + (w - 0.5) * 0.22 * (1.0 - uCloudSharp), 0.0, 1.0);
  return d;
}

void main() {
  vec3 dir = normalize(vDir);
  float h = dir.y;

  // --- base gradient
  float up = clamp(h, 0.0, 1.0);
  vec3 sky = mix(uHorizon, uZenith, pow(up, 0.42));
  sky = mix(uSeaHaze, sky, smoothstep(-0.14, 0.015, h));

  // --- sun
  float cosT = dot(dir, uSunDir);
  float glow = pow(max(cosT, 0.0), 2200.0) * 4.0
             + pow(max(cosT, 0.0), 90.0) * 0.16
             + pow(max(cosT, 0.0), 7.0) * 0.035;
  sky += uSunColor * glow * (1.0 - uCloud * 0.75);
  float disc = smoothstep(1.0 - uSunDisc, 1.0 - uSunDisc * 0.35, cosT);
  sky += uSunColor * disc * 26.0 * (1.0 - uCloud * 0.9);

  // --- clouds on a plane above the island
  if (h > 0.012) {
    float t = (1500.0 - uCamPos.y) / h;
    vec2 uv = (uCamPos.xz + dir.xz * t) * 0.00042;
    float d = cloudField(uv);
    if (d > 0.001) {
      // light the cloud from the sun side by sampling slightly toward it
      vec2 sunOff = normalize(uSunDir.xz + 1e-5) * 0.006;
      float ds = cloudField(uv + sunOff);
      float lit = clamp((d - ds) * 2.2 + 0.55, 0.0, 1.0);
      float rim = pow(max(cosT, 0.0), 12.0);
      vec3 cloudCol = mix(uZenith * 0.85, uSunColor * 1.25, lit);
      cloudCol = mix(cloudCol, uSunColor * 1.9, rim * 0.55 * lit);
      cloudCol = mix(cloudCol * 0.55, cloudCol, lit);
      float fade = smoothstep(0.012, 0.10, h);
      sky = mix(sky, cloudCol, d * fade * (0.55 + 0.45 * uCloud));
    }
  }

  // --- haze near the horizon
  float hazeBand = pow(1.0 - clamp(abs(h) * 3.4, 0.0, 1.0), 2.0);
  sky = mix(sky, uHorizon * 1.04, hazeBand * uHaze * 0.55);

  sky += vec3(0.9, 0.95, 1.0) * uLightning;

  gl_FragColor = vec4(sky, 1.0);
}
`;

export class Atmosphere {
  constructor(rng) {
    this.rng = rng;
    const keys = Object.keys(WEATHERS);
    this.weatherKey = rng.pick(['clear', 'clear', 'fair', 'fair', 'hazy', 'overcast', 'drizzle', 'squall']);
    this.weather = WEATHERS[this.weatherKey];
    this.hour = rng.range(15.2, 19.4);

    // sun direction from the hour: a low, angled sun reads best
    const az = rng.range(-0.9, 0.9);
    const elev = lerp(0.30, 0.075, clamp01((this.hour - 14.5) / 5.2)) * rng.range(0.85, 1.15);
    this.sunDir = new THREE.Vector3(
      Math.cos(elev) * Math.sin(az),
      Math.sin(elev),
      Math.cos(elev) * Math.cos(az)
    ).normalize();

    this.sunColor = new THREE.Color();
    this.zenith = new THREE.Color();
    this.horizon = new THREE.Color();
    this.seaHaze = new THREE.Color();
    this.fogColor = new THREE.Color();
    this.skyAmbient = new THREE.Color();
    this.groundBounce = new THREE.Color();
    this._computeColors();

    // shared uniform values (one array reused by every material)
    this.uAtmos = {
      value: [
        new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4(),
        new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4(),
      ],
    };
    this.uCamPos = { value: new THREE.Vector3() };

    this._buildSky();
    this._sync();
  }

  _computeColors() {
    const h = this.hour;
    const t = clamp01((h - 14.0) / 6.0);       // 0 afternoon -> 1 dusk
    const w = this.weather;
    const overcast = clamp01(w.cloud * 0.85 + w.haze * 0.3);

    // sun colour: warm and dim at low elevation, neutral high up
    const warm = new THREE.Color(1.0, 0.62, 0.34);
    const noon = new THREE.Color(1.0, 0.96, 0.88);
    this.sunColor.copy(noon).lerp(warm, Math.pow(t, 0.85));
    const strength = w.sunI * lerp(1.0, 0.42, t) * lerp(1.0, 0.45, overcast);
    this.sunColor.multiplyScalar(2.55 * strength);

    // sky
    const dayZen = new THREE.Color(0.16, 0.33, 0.62);
    const duskZen = new THREE.Color(0.10, 0.17, 0.36);
    this.zenith.copy(dayZen).lerp(duskZen, t).lerp(new THREE.Color(0.30, 0.33, 0.36), overcast * 0.72);

    const dayHor = new THREE.Color(0.60, 0.72, 0.86);
    const duskHor = new THREE.Color(0.86, 0.50, 0.30);
    this.horizon.copy(dayHor).lerp(duskHor, Math.pow(t, 1.25)).lerp(new THREE.Color(0.55, 0.57, 0.60), overcast * 0.65);

    this.seaHaze.copy(this.horizon).multiplyScalar(0.55).lerp(new THREE.Color(0.05, 0.09, 0.13), 0.4);

    this.fogColor.copy(this.horizon).lerp(this.zenith, 0.34).multiplyScalar(0.82);

    // ambient: hemispherical light from the sky, scaled by weather
    this.skyAmbient.copy(this.zenith).lerp(this.horizon, 0.45).multiplyScalar(1.55 * lerp(1, 0.55, overcast));
    this.groundBounce.copy(this.horizon).lerp(new THREE.Color(0.20, 0.20, 0.17), 0.55).multiplyScalar(0.42 * lerp(1, 0.6, overcast));

    this.fogDensity = lerp(0.00075, 0.0032, w.haze) * lerp(1, 1.25, t);
    this.fogHeightFalloff = lerp(0.022, 0.009, w.haze);
    this.fogSunBoost = lerp(0.85, 0.28, overcast);
  }

  _buildSky() {
    const geo = new THREE.SphereGeometry(1, 40, 24);
    this.skyUniforms = {
      uSunDir: { value: this.sunDir },
      uSunColor: { value: new THREE.Vector3(this.sunColor.r, this.sunColor.g, this.sunColor.b) },
      uZenith: { value: new THREE.Vector3(this.zenith.r, this.zenith.g, this.zenith.b) },
      uHorizon: { value: new THREE.Vector3(this.horizon.r, this.horizon.g, this.horizon.b) },
      uSeaHaze: { value: new THREE.Vector3(this.seaHaze.r, this.seaHaze.g, this.seaHaze.b) },
      uSunDisc: { value: 0.0022 },
      uCloud: { value: this.weather.cloud },
      uCloudSharp: { value: 0.5 },
      uTime: { value: 0 },
      uCloudDrift: { value: new THREE.Vector2() },
      uHaze: { value: this.weather.haze },
      uCamPos: { value: this.uCamPos.value },
      uLightning: { value: 0 },
    };
    const mat = new THREE.ShaderMaterial({
      vertexShader: SKY_VS,
      fragmentShader: SKY_FS,
      uniforms: this.skyUniforms,
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: false,
      fog: false,
      toneMapped: false,
    });
    this.sky = new THREE.Mesh(geo, mat);
    this.sky.frustumCulled = false;
    this.sky.renderOrder = -1000;
    this.sky.scale.setScalar(1);
  }

  _sync() {
    const u = this.uAtmos.value;
    u[0].set(this.sunDir.x, this.sunDir.y, this.sunDir.z, this.sunColor.r * 0.4 + this.sunColor.g * 0.4 + this.sunColor.b * 0.2);
    u[1].set(this.sunColor.r, this.sunColor.g, this.sunColor.b, 1);
    u[2].set(this.skyAmbient.r, this.skyAmbient.g, this.skyAmbient.b, this.fogDensity);
    u[3].set(this.groundBounce.r, this.groundBounce.g, this.groundBounce.b, this.fogHeightFalloff);
    u[4].set(this.fogColor.r, this.fogColor.g, this.fogColor.b, this.fogSunBoost);
    u[5].set(this.horizon.r, this.horizon.g, this.horizon.b, 0);
  }

  update(camera, time, dt) {
    this._sync();
    this.uAtmos.value[5].w = time;
    this.uCamPos.value.copy(camera.position);
    this.sky.position.copy(camera.position);
    this.sky.scale.setScalar(Math.max(200, camera.far * 0.45));
    const s = this.skyUniforms;
    s.uTime.value = time;
    s.uCloudDrift.value.set(time * 0.0016 * (0.4 + this.weather.wind), time * 0.0009 * (0.4 + this.weather.wind));
    s.uSunColor.value.set(this.sunColor.r, this.sunColor.g, this.sunColor.b);
    s.uZenith.value.set(this.zenith.r, this.zenith.g, this.zenith.b);
    s.uHorizon.value.set(this.horizon.r, this.horizon.g, this.horizon.b);
    s.uSeaHaze.value.set(this.seaHaze.r, this.seaHaze.g, this.seaHaze.b);
  }

  flash(v) { this.skyUniforms.uLightning.value = v; }
}
