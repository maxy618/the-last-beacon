// ---------------------------------------------------------------------------
// Shared GLSL: hashes, noise, and the atmosphere model (height fog with sun
// in-scattering) that every opaque material uses.
// ---------------------------------------------------------------------------

export const NOISE_GLSL = /* glsl */`
float hash11(float p) {
  p = fract(p * 0.1031);
  p *= p + 33.33;
  p *= p + p;
  return fract(p);
}
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
vec2 hash22(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}
float hash13(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}
float vnoise2(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash12(i);
  float b = hash12(i + vec2(1.0, 0.0));
  float c = hash12(i + vec2(0.0, 1.0));
  float d = hash12(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float vnoise3(vec3 p) {
  vec3 i = floor(p), f = fract(p);
  vec3 u = f * f * (3.0 - 2.0 * f);
  float n000 = hash13(i);
  float n100 = hash13(i + vec3(1.0, 0.0, 0.0));
  float n010 = hash13(i + vec3(0.0, 1.0, 0.0));
  float n110 = hash13(i + vec3(1.0, 1.0, 0.0));
  float n001 = hash13(i + vec3(0.0, 0.0, 1.0));
  float n101 = hash13(i + vec3(1.0, 0.0, 1.0));
  float n011 = hash13(i + vec3(0.0, 1.0, 1.0));
  float n111 = hash13(i + vec3(1.0, 1.0, 1.0));
  return mix(mix(mix(n000, n100, u.x), mix(n010, n110, u.x), u.y),
             mix(mix(n001, n101, u.x), mix(n011, n111, u.x), u.y), u.z);
}
float fbm2(vec2 p, int oct) {
  float a = 0.5, s = 0.0, n = 0.0;
  for (int i = 0; i < 8; i++) {
    if (i >= oct) break;
    s += a * vnoise2(p);
    n += a;
    p = p * 2.03 + vec2(17.1, 31.7);
    a *= 0.5;
  }
  return s / max(n, 1e-4);
}
float fbm3(vec3 p, int oct) {
  float a = 0.5, s = 0.0, n = 0.0;
  for (int i = 0; i < 8; i++) {
    if (i >= oct) break;
    s += a * vnoise3(p);
    n += a;
    p = p * 2.03 + vec3(17.1, 31.7, 5.3);
    a *= 0.5;
  }
  return s / max(n, 1e-4);
}
float ridge2(vec2 p, int oct) {
  float a = 0.5, s = 0.0, n = 0.0, prev = 1.0;
  for (int i = 0; i < 8; i++) {
    if (i >= oct) break;
    float v = 1.0 - abs(vnoise2(p) * 2.0 - 1.0);
    v *= v;
    s += a * v * prev;
    prev = v;
    n += a;
    p = p * 2.07 + vec2(5.3, 11.9);
    a *= 0.5;
  }
  return s / max(n, 1e-4);
}
float worley2(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  float d = 8.0;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 g = vec2(float(x), float(y));
      vec2 o = hash22(i + g);
      vec2 r = g + o - f;
      d = min(d, dot(r, r));
    }
  }
  return sqrt(d);
}
`;

/**
 * Atmosphere: uniform block shared by every material plus the fog routine.
 * `uAtmos` is a vec4 array:
 *   0: sunDir.xyz, sunIntensity
 *   1: sunColor.rgb, shadowStrength
 *   2: skyAmbient.rgb, fogDensity
 *   3: groundBounce.rgb, fogHeightFalloff
 *   4: fogColor.rgb, fogSunBoost
 *   5: horizonColor.rgb, time
 */
export const ATMOS_UNIFORMS = /* glsl */`
uniform vec4 uAtmos[6];
uniform vec3 uCamPos;
`;

export const ATMOS_GLSL = /* glsl */`
vec3 sunDir() { return uAtmos[0].xyz; }
float sunIntensity() { return uAtmos[0].w; }
vec3 sunColor() { return uAtmos[1].rgb; }
vec3 skyAmbient() { return uAtmos[2].rgb; }
float fogDensity() { return uAtmos[2].w; }
vec3 groundBounce() { return uAtmos[3].rgb; }
float fogHeightFalloff() { return uAtmos[3].w; }
vec3 fogColor() { return uAtmos[4].rgb; }
float fogSunBoost() { return uAtmos[4].w; }
vec3 horizonColor() { return uAtmos[5].rgb; }
float atmosTime() { return uAtmos[5].w; }

// Hemispheric ambient: sky above, bounced ground light below.
vec3 ambientAt(vec3 n) {
  float up = n.y * 0.5 + 0.5;
  return mix(groundBounce(), skyAmbient(), up * up);
}

// Analytic height fog with a directional in-scattering lobe.
vec3 applyFog(vec3 color, vec3 worldPos) {
  vec3 toFrag = worldPos - uCamPos;
  float dist = length(toFrag);
  if (dist < 0.001) return color;
  vec3 rd = toFrag / dist;
  float b = fogHeightFalloff();
  float dy = rd.y;
  float d0 = fogDensity() * exp(-b * (uCamPos.y - 1.0));
  float integral;
  if (abs(dy) < 1e-4) {
    integral = d0 * dist;
  } else {
    integral = d0 * (1.0 - exp(-b * dy * dist)) / (b * dy);
  }
  float f = 1.0 - exp(-max(integral, 0.0));
  float mu = max(dot(rd, sunDir()), 0.0);
  vec3 fc = mix(fogColor(), fogColor() * 1.35 + sunColor() * 0.55, pow(mu, 5.0) * fogSunBoost());
  fc = mix(fc, horizonColor(), 0.18);
  return mix(color, fc, clamp(f, 0.0, 1.0));
}
`;
