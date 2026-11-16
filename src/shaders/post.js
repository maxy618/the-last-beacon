// ---------------------------------------------------------------------------
// Post-processing shaders: bloom chain, god rays, final grade.
// ---------------------------------------------------------------------------

export const FS_QUAD_VS = /* glsl */`
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

/** Bright-pass + 13-tap downsample (Jimenez / CoD style). */
export const BLOOM_DOWN_FS = /* glsl */`
precision highp float;
varying vec2 vUv;
uniform sampler2D tSrc;
uniform vec2 texel;
uniform float threshold;
uniform float knee;
uniform float firstPass;

vec3 prefilter(vec3 c) {
  float br = max(c.r, max(c.g, c.b));
  float soft = br - threshold + knee;
  soft = clamp(soft, 0.0, 2.0 * knee);
  soft = soft * soft / (4.0 * knee + 1e-4);
  float contrib = max(soft, br - threshold) / max(br, 1e-4);
  return c * contrib;
}

void main() {
  vec2 t = texel;
  vec3 a = texture2D(tSrc, vUv + t * vec2(-2.0, -2.0)).rgb;
  vec3 b = texture2D(tSrc, vUv + t * vec2( 0.0, -2.0)).rgb;
  vec3 c = texture2D(tSrc, vUv + t * vec2( 2.0, -2.0)).rgb;
  vec3 d = texture2D(tSrc, vUv + t * vec2(-2.0,  0.0)).rgb;
  vec3 e = texture2D(tSrc, vUv).rgb;
  vec3 f = texture2D(tSrc, vUv + t * vec2( 2.0,  0.0)).rgb;
  vec3 g = texture2D(tSrc, vUv + t * vec2(-2.0,  2.0)).rgb;
  vec3 h = texture2D(tSrc, vUv + t * vec2( 0.0,  2.0)).rgb;
  vec3 i = texture2D(tSrc, vUv + t * vec2( 2.0,  2.0)).rgb;
  vec3 j = texture2D(tSrc, vUv + t * vec2(-1.0, -1.0)).rgb;
  vec3 k = texture2D(tSrc, vUv + t * vec2( 1.0, -1.0)).rgb;
  vec3 l = texture2D(tSrc, vUv + t * vec2(-1.0,  1.0)).rgb;
  vec3 m = texture2D(tSrc, vUv + t * vec2( 1.0,  1.0)).rgb;

  vec3 res = e * 0.125;
  res += (a + c + g + i) * 0.03125;
  res += (b + d + f + h) * 0.0625;
  res += (j + k + l + m) * 0.125;

  if (firstPass > 0.5) res = prefilter(res);
  gl_FragColor = vec4(res, 1.0);
}
`;

/** 9-tap tent upsample, additive into the destination. */
export const BLOOM_UP_FS = /* glsl */`
precision highp float;
varying vec2 vUv;
uniform sampler2D tSrc;
uniform vec2 texel;
uniform float radius;
void main() {
  vec2 t = texel * radius;
  vec3 s = texture2D(tSrc, vUv + t * vec2(-1.0, -1.0)).rgb * 1.0;
  s += texture2D(tSrc, vUv + t * vec2( 0.0, -1.0)).rgb * 2.0;
  s += texture2D(tSrc, vUv + t * vec2( 1.0, -1.0)).rgb * 1.0;
  s += texture2D(tSrc, vUv + t * vec2(-1.0,  0.0)).rgb * 2.0;
  s += texture2D(tSrc, vUv).rgb * 4.0;
  s += texture2D(tSrc, vUv + t * vec2( 1.0,  0.0)).rgb * 2.0;
  s += texture2D(tSrc, vUv + t * vec2(-1.0,  1.0)).rgb * 1.0;
  s += texture2D(tSrc, vUv + t * vec2( 0.0,  1.0)).rgb * 2.0;
  s += texture2D(tSrc, vUv + t * vec2( 1.0,  1.0)).rgb * 1.0;
  gl_FragColor = vec4(s / 16.0, 1.0);
}
`;

/**
 * Final composite: scene + bloom, sun shafts through the shadow map, ACES
 * tonemap, grade, vignette, grain, FXAA.
 */
export const COMPOSITE_FS = /* glsl */`
precision highp float;
varying vec2 vUv;

uniform sampler2D tScene;
uniform sampler2D tBloom0;
uniform sampler2D tBloom1;
uniform sampler2D tBloom2;
uniform sampler2D tBloom3;
uniform float bloomStrength;
uniform float exposure;
uniform float vignette;
uniform float grain;
uniform float time;
uniform vec2 sunScreen;
uniform float shaftStrength;
uniform float shaftDecay;
uniform float saturation;
uniform vec3 lift;
uniform vec3 gain;
uniform float aa;
uniform float flash;
uniform vec2 resolution;

vec3 aces(vec3 x) {
  const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

void main() {
  vec3 col = texture2D(tScene, vUv).rgb;

  // --- bloom
  vec3 bl = texture2D(tBloom0, vUv).rgb * 0.42
          + texture2D(tBloom1, vUv).rgb * 0.28
          + texture2D(tBloom2, vUv).rgb * 0.19
          + texture2D(tBloom3, vUv).rgb * 0.13;
  col += bl * bloomStrength;

  // --- sun shafts: a cheap radial smear of the brightest pixels near the sun
  if (shaftStrength > 0.001) {
    vec2 dir = (vUv - sunScreen) * 0.28;
    vec3 acc = vec3(0.0);
    float w = 1.0;
    float total = 0.0;
    vec2 uv = vUv;
    for (int i = 0; i < 10; i++) {
      uv -= dir / 10.0;
      vec3 s = texture2D(tScene, uv).rgb;
      float lum = dot(s, vec3(0.299, 0.587, 0.114));
      float m = smoothstep(0.9, 3.0, lum);
      acc += s * m * w;
      total += w;
      w *= shaftDecay;
    }
    float fall = 1.0 - smoothstep(0.0, 0.85, length(vUv - sunScreen));
    col += acc / max(total, 1e-4) * shaftStrength * fall;
  }

  // --- exposure and tonemap
  col *= exposure;
  col = aces(col);

  // --- grade
  float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = mix(vec3(lum), col, saturation);
  col = col * gain + lift;

  // --- vignette
  vec2 q = vUv - 0.5;
  float v = 1.0 - dot(q, q) * vignette;
  col *= clamp(v, 0.0, 1.0);

  // --- damage flash
  col = mix(col, vec3(0.42, 0.04, 0.03), flash);

  // --- FXAA (luma based, cheap)
  if (aa > 0.5) {
    vec2 px = 1.0 / resolution;
    vec3 rgbNW = texture2D(tScene, vUv + vec2(-1.0, -1.0) * px).rgb;
    vec3 rgbNE = texture2D(tScene, vUv + vec2( 1.0, -1.0) * px).rgb;
    vec3 rgbSW = texture2D(tScene, vUv + vec2(-1.0,  1.0) * px).rgb;
    vec3 rgbSE = texture2D(tScene, vUv + vec2( 1.0,  1.0) * px).rgb;
    vec3 rgbM  = texture2D(tScene, vUv).rgb;
    float lNW = dot(rgbNW, vec3(0.299, 0.587, 0.114));
    float lNE = dot(rgbNE, vec3(0.299, 0.587, 0.114));
    float lSW = dot(rgbSW, vec3(0.299, 0.587, 0.114));
    float lSE = dot(rgbSE, vec3(0.299, 0.587, 0.114));
    float lM  = dot(rgbM,  vec3(0.299, 0.587, 0.114));
    float lMin = min(lM, min(min(lNW, lNE), min(lSW, lSE)));
    float lMax = max(lM, max(max(lNW, lNE), max(lSW, lSE)));
    vec2 dir = vec2(-((lNW + lNE) - (lSW + lSE)), ((lNW + lSW) - (lNE + lSE)));
    float dirReduce = max((lNW + lNE + lSW + lSE) * 0.25 * 0.125, 1.0 / 128.0);
    float rcpDirMin = 1.0 / (min(abs(dir.x), abs(dir.y)) + dirReduce);
    dir = clamp(dir * rcpDirMin, -8.0, 8.0) * px;
    vec3 rgbA = 0.5 * (texture2D(tScene, vUv + dir * (1.0 / 3.0 - 0.5)).rgb +
                       texture2D(tScene, vUv + dir * (2.0 / 3.0 - 0.5)).rgb);
    vec3 rgbB = rgbA * 0.5 + 0.25 * (texture2D(tScene, vUv - dir * 0.5).rgb +
                                     texture2D(tScene, vUv + dir * 0.5).rgb);
    float lB = dot(rgbB, vec3(0.299, 0.587, 0.114));
    col = (lB < lMin || lB > lMax) ? rgbA : rgbB;
  }

  // --- sRGB encode
  col = max(col, vec3(0.0));
  vec3 lo = col * 12.92;
  vec3 hi = 1.055 * pow(col, vec3(1.0 / 2.4)) - 0.055;
  col = mix(hi, lo, step(col, vec3(0.0031308)));

  // --- grain
  float n = hash12(vUv * resolution + time * 60.0);
  col += (n - 0.5) * grain;

  gl_FragColor = vec4(col, 1.0);
}
`;
