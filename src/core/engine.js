// ---------------------------------------------------------------------------
// Renderer, HDR pipeline and post-processing chain.
//
// The scene is drawn into a half-float target, then bloomed and graded on the
// way to the screen. Everything is tuned to hold a stable frame time: the
// render scale and the draw distance are the two knobs the adaptive quality
// controller turns.
// ---------------------------------------------------------------------------

import * as THREE from 'three';
import { FS_QUAD_VS, BLOOM_DOWN_FS, BLOOM_UP_FS, COMPOSITE_FS } from '../shaders/post.js';

export const QUALITY = {
  low: {
    name: 'Low',
    renderScale: 0.68, msaa: 0, shadowSize: 1024, shadowDistance: 90,
    bloomLevels: 4, bloomStrength: 0.5, grassDensity: 0.22, treeDensity: 0.55,
    drawDistance: 320, aa: 0, ssao: 0, godrays: 0, anisotropy: 1, softShadow: 0,
  },
  medium: {
    name: 'Medium',
    renderScale: 0.85, msaa: 0, shadowSize: 2048, shadowDistance: 130,
    bloomLevels: 5, bloomStrength: 0.58, grassDensity: 0.55, treeDensity: 0.8,
    drawDistance: 480, aa: 1, ssao: 0, godrays: 0.6, anisotropy: 4, softShadow: 1,
  },
  high: {
    name: 'High',
    renderScale: 1.0, msaa: 4, shadowSize: 4096, shadowDistance: 175,
    bloomLevels: 6, bloomStrength: 0.62, grassDensity: 1.0, treeDensity: 1.0,
    drawDistance: 700, aa: 1, ssao: 1, godrays: 1.0, anisotropy: 8, softShadow: 1,
  },
};

const BLOOM_MIPS = 6;

export class Engine {
  constructor(canvas, qualityKey = 'high') {
    this.canvas = canvas;
    this.quality = QUALITY[qualityKey] ? qualityKey : 'high';
    this.q = QUALITY[this.quality];

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      alpha: false,
      stencil: false,
      depth: true,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: true,
    });
    this.renderer.setPixelRatio(1);
    this.renderer.autoClear = true;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.shadowMap.autoUpdate = false;
    this.renderer.info.autoReset = false;

    this.renderScale = this.q.renderScale;
    this.width = 1;
    this.height = 1;

    // Fullscreen quad machinery
    this.quadGeo = new THREE.BufferGeometry();
    this.quadGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
    this.quadGeo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 0, 2, 0, 0, 2]), 2));
    this.quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.quadScene = new THREE.Scene();
    this.quadMesh = new THREE.Mesh(this.quadGeo, null);
    this.quadMesh.frustumCulled = false;
    this.quadScene.add(this.quadMesh);

    this._makeTargets();

    this.exposure = 1.0;
    this.vignette = 0.55;
    this.grain = 0.018;
    this.saturation = 1.06;
    this.lift = new THREE.Vector3(0.004, 0.005, 0.010);
    this.gain = new THREE.Vector3(1.02, 1.0, 0.985);
    this.bloomStrength = this.q.bloomStrength;
    this.bloomThreshold = 1.05;
    this.bloomKnee = 0.55;
    this.flash = 0;
    this.sunScreen = new THREE.Vector2(0.5, 0.9);
    this.shaftStrength = 0;

    this._makeMaterials();

    this._resize();
    addEventListener('resize', () => this._resize());
  }

  _makeTargets() {
    const r = this.renderer;
    const samples = this.q.msaa;
    this.sceneRT = new THREE.WebGLRenderTarget(2, 2, {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: true,
      stencilBuffer: false,
      samples,
    });
    this.sceneRT.texture.colorSpace = THREE.NoColorSpace;
    this.sceneRT.depthTexture = null;

    this.bloomRTs = [];
    for (let i = 0; i < BLOOM_MIPS; i++) {
      const t = new THREE.WebGLRenderTarget(2, 2, {
        type: THREE.HalfFloatType,
        format: THREE.RGBAFormat,
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        depthBuffer: false,
      });
      t.texture.colorSpace = THREE.NoColorSpace;
      this.bloomRTs.push(t);
    }
  }

  _makeMaterials() {
    this.downMat = new THREE.ShaderMaterial({
      vertexShader: FS_QUAD_VS,
      fragmentShader: BLOOM_DOWN_FS,
      depthTest: false, depthWrite: false,
      uniforms: {
        tSrc: { value: null },
        texel: { value: new THREE.Vector2() },
        threshold: { value: this.bloomThreshold },
        knee: { value: this.bloomKnee },
        firstPass: { value: 0 },
      },
    });
    this.upMat = new THREE.ShaderMaterial({
      vertexShader: FS_QUAD_VS,
      fragmentShader: BLOOM_UP_FS,
      depthTest: false, depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        tSrc: { value: null },
        texel: { value: new THREE.Vector2() },
        radius: { value: 1.15 },
      },
    });
    this.compositeMat = new THREE.ShaderMaterial({
      vertexShader: FS_QUAD_VS,
      fragmentShader: COMPOSITE_FS,
      depthTest: false, depthWrite: false,
      uniforms: {
        tScene: { value: this.sceneRT.texture },
        tBloom0: { value: this.bloomRTs[0].texture },
        tBloom1: { value: this.bloomRTs[1].texture },
        tBloom2: { value: this.bloomRTs[2].texture },
        tBloom3: { value: this.bloomRTs[3].texture },
        bloomStrength: { value: this.bloomStrength },
        exposure: { value: this.exposure },
        vignette: { value: this.vignette },
        grain: { value: this.grain },
        time: { value: 0 },
        sunScreen: { value: new THREE.Vector2() },
        shaftStrength: { value: 0 },
        shaftDecay: { value: 0.93 },
        saturation: { value: this.saturation },
        lift: { value: this.lift },
        gain: { value: this.gain },
        aa: { value: this.q.aa },
        flash: { value: 0 },
        resolution: { value: new THREE.Vector2() },
      },
    });
  }

  _resize() {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const cssW = this.canvas.clientWidth || innerWidth;
    const cssH = this.canvas.clientHeight || innerHeight;
    const w = Math.max(2, Math.round(cssW * dpr));
    const h = Math.max(2, Math.round(cssH * dpr));
    this.cssWidth = cssW;
    this.cssHeight = cssH;
    this.outWidth = w;
    this.outHeight = h;

    const rw = Math.max(2, Math.round(w * this.renderScale));
    const rh = Math.max(2, Math.round(h * this.renderScale));
    this.width = rw;
    this.height = rh;

    this.renderer.setSize(w, h, false);
    this.sceneRT.setSize(rw, rh);
    for (let i = 0; i < BLOOM_MIPS; i++) {
      const bw = Math.max(2, rw >> (i + 1));
      const bh = Math.max(2, rh >> (i + 1));
      this.bloomRTs[i].setSize(bw, bh);
    }
    this.compositeMat.uniforms.resolution.value.set(rw, rh);
  }

  setRenderScale(s) {
    s = Math.max(0.4, Math.min(1.25, s));
    if (Math.abs(s - this.renderScale) < 0.01) return;
    this.renderScale = s;
    this._resize();
  }

  setQuality(key) {
    if (!QUALITY[key]) return;
    this.quality = key;
    this.q = QUALITY[key];
    this.bloomStrength = this.q.bloomStrength;
    this.compositeMat.uniforms.bloomStrength.value = this.bloomStrength;
    this.compositeMat.uniforms.aa.value = this.q.aa;
    this.renderScale = this.q.renderScale;
    this._makeTargets();
    this._resize();
  }

  _blit(material, target) {
    this.quadMesh.material = material;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.quadScene, this.quadCam);
  }

  /**
   * @param {THREE.Scene} scene
   * @param {THREE.Camera} camera
   * @param {object} opts  { sunScreen, sunVisible, dt, time }
   */
  render(scene, camera, opts = {}) {
    const r = this.renderer;
    r.info.reset();

    r.setRenderTarget(this.sceneRT);
    r.clear(true, true, false);
    r.render(scene, camera);

    // ---- bloom chain
    const levels = Math.min(this.q.bloomLevels, BLOOM_MIPS);
    this.downMat.uniforms.threshold.value = this.bloomThreshold;
    this.downMat.uniforms.knee.value = this.bloomKnee;
    let src = this.sceneRT.texture;
    for (let i = 0; i < levels; i++) {
      const dst = this.bloomRTs[i];
      this.downMat.uniforms.tSrc.value = src;
      this.downMat.uniforms.texel.value.set(1 / src.image.width, 1 / src.image.height);
      this.downMat.uniforms.firstPass.value = i === 0 ? 1 : 0;
      this._blit(this.downMat, dst);
      src = dst.texture;
    }
    r.autoClear = false;
    for (let i = levels - 1; i > 0; i--) {
      this.upMat.uniforms.tSrc.value = this.bloomRTs[i].texture;
      this.upMat.uniforms.texel.value.set(1 / this.bloomRTs[i].texture.image.width, 1 / this.bloomRTs[i].texture.image.height);
      this._blit(this.upMat, this.bloomRTs[i - 1]);
    }
    r.autoClear = true;

    // ---- composite
    const u = this.compositeMat.uniforms;
    u.tScene.value = this.sceneRT.texture;
    u.bloomStrength.value = this.bloomStrength;
    u.exposure.value = this.exposure;
    u.vignette.value = this.vignette;
    u.grain.value = this.grain;
    u.saturation.value = this.saturation;
    u.lift.value.copy(this.lift);
    u.gain.value.copy(this.gain);
    u.time.value = opts.time || 0;
    u.flash.value = this.flash;
    u.aa.value = this.q.aa;
    if (opts.sunScreen) u.sunScreen.value.copy(opts.sunScreen);
    const shaft = this.q.godrays * (opts.sunVisible ? 1 : 0) * (opts.shaftStrength ?? 1);
    u.shaftStrength.value = shaft;

    this.quadMesh.material = this.compositeMat;
    r.setRenderTarget(null);
    r.render(this.quadScene, this.quadCam);

    this.stats = {
      calls: r.info.render.calls,
      triangles: r.info.render.triangles,
      programs: r.info.programs ? r.info.programs.length : 0,
    };
  }

  dispose() {
    this.sceneRT.dispose();
    for (const t of this.bloomRTs) t.dispose();
    this.renderer.dispose();
  }
}
