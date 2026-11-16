// ---------------------------------------------------------------------------
// THE LAST BEACON - entry point.
// ---------------------------------------------------------------------------

import * as THREE from 'three';
import { Engine, QUALITY } from './core/engine.js';
import { Input } from './core/input.js';
import { makeRng, seedFromString } from './core/rng.js';
import { clamp, clamp01, lerp } from './core/math.js';
import { Island } from './world/island.js';
import { Atmosphere } from './world/atmosphere.js';
import { Terrain } from './world/terrain.js';
import { Ocean } from './world/water.js';
import { CollisionWorld } from './play/collision.js';
import { Player } from './play/player.js';
import { Hud } from './ui/hud.js';

const $ = (id) => document.getElementById(id);

const bootBar = $('bootBar');
const bootMsg = $('bootMsg');
let bootProgress = 0;
function boot(msg, to) {
  bootMsg.textContent = msg;
  bootProgress = to;
  bootBar.style.width = `${to * 100}%`;
  return new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
}

class Game {
  constructor() {
    this.canvas = $('c');
    this.hud = new Hud();
    this.input = new Input(this.canvas);
    this.clock = new THREE.Clock();
    this.time = 0;
    this.running = false;
    this.paused = true;
    this.pausedForMenu = true;
    this.quality = localStorage.getItem('tlb.quality') || 'high';
    this.seedText = localStorage.getItem('tlb.seed') || '';
    this.drawDistanceScale = 1;
    this.frameTimes = [];
    this.adaptTimer = 0;
  }

  async start() {
    await boot('waking the graphics device', 0.04);
    this.engine = new Engine(this.canvas, this.quality);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(68, innerWidth / innerHeight, 0.08, 6000);
    this.scene.add(this.camera);

    // ---- lights
    this.sun = new THREE.DirectionalLight(0xffffff, 3);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(this.engine.q.shadowSize, this.engine.q.shadowSize);
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 520;
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.05;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);
    this.hemi = new THREE.HemisphereLight(0x9fc4e8, 0x4a4436, 1.1);
    this.scene.add(this.hemi);

    await boot('surveying the coast', 0.14);
    const seed = this.seedText ? seedFromString(this.seedText) : (Math.random() * 0xffffffff) >>> 0;
    this.seed = seed;
    const rng = makeRng(seed);
    this.rng = rng;

    await boot('raising the island', 0.28);
    this.island = new Island(seed);

    await boot('hanging the weather', 0.5);
    this.atmos = new Atmosphere(rng);
    this.scene.add(this.atmos.sky);
    this._applyLightColors();

    await boot('laying the ground', 0.62);
    this.terrain = new Terrain(this.island, this.atmos, this.engine.q);
    this.scene.add(this.terrain.group);

    await boot('flooding the bay', 0.78);
    this.ocean = new Ocean(this.island, this.atmos);
    this.scene.add(this.ocean.mesh);

    await boot('finding your feet', 0.9);
    this.collision = new CollisionWorld(this.island);
    this.player = new Player(this.island, this.collision, this.camera);
    const start = this._pickLanding(rng);
    this.player.teleport(start[0], Math.max(this.island.heightAt(start[0], start[1]), 0.4) + 0.2, start[1]);
    this.player.yaw = Math.atan2(-(0 - start[0]), -(0 - start[1]));

    await boot('letting the light in', 1.0);
    this.terrain.update(this.player.pos.x, this.player.pos.z, 30);
    this.engine.renderer.shadowMap.needsUpdate = true;
    this._updateSun();

    $('boot').classList.add('gone');
    setTimeout(() => { const b = $('boot'); if (b) b.remove(); }, 1000);
    this.showMenu();
    this._loop();
  }

  /** A sheltered beach on the seaward side of the island, looking inland. */
  _pickLanding(rng) {
    const candidates = [];
    for (let i = 0; i < 900; i++) {
      const a = rng() * Math.PI * 2;
      const r = rng.range(200, 470);
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      const h = this.island.heightAt(x, z);
      if (h < 0.6 || h > 5.5) continue;
      const slope = this.island.slopeAt(x, z);
      if (slope > 0.16) continue;
      const inland = this.island.heightAt(x * 0.86, z * 0.86);
      if (inland < 6) continue;
      candidates.push([x, z, slope + Math.abs(h - 1.6) * 0.05]);
    }
    if (!candidates.length) return this.island.findShore(rng, { flat: true }) || [0, 0];
    candidates.sort((a, b) => a[2] - b[2]);
    return [candidates[0][0], candidates[0][1]];
  }

  _applyLightColors() {
    const sc = this.atmos.sunColor;
    const mx = Math.max(sc.r, sc.g, sc.b, 1e-3);
    this.sun.color.setRGB(sc.r / mx, sc.g / mx, sc.b / mx);
    this.sun.intensity = mx * 2.9;
    const sa = this.atmos.skyAmbient;
    const hm = Math.max(sa.r, sa.g, sa.b, 1e-3);
    this.hemi.color.setRGB(sa.r / hm, sa.g / hm, sa.b / hm);
    this.hemi.intensity = hm * 1.15;
    const gb = this.atmos.groundBounce;
    this.hemi.groundColor.setRGB(gb.r / 1.4, gb.g / 1.4, gb.b / 1.4);
  }

  _updateSun() {
    const p = this.player.pos;
    const d = this.atmos.sunDir;
    const dist = this.engine.q.shadowDistance;
    const texel = (2 * dist) / this.engine.q.shadowSize;
    const sx = Math.round(p.x / texel) * texel;
    const sz = Math.round(p.z / texel) * texel;
    const sy = Math.round(p.y / texel) * texel;
    this.sun.target.position.set(sx, sy, sz);
    this.sun.position.set(sx + d.x * 220, sy + d.y * 220, sz + d.z * 220);
    const c = this.sun.shadow.camera;
    c.left = -dist; c.right = dist; c.top = dist; c.bottom = -dist;
    c.near = 1; c.far = 520;
    c.updateProjectionMatrix();
  }

  showMenu() {
    this.pausedForMenu = true;
    document.body.className = '';
    $('menu').classList.remove('hidden');
    $('menuSeed').textContent = this.seedText ? `chart ${this.seedText}` : `chart ${this.seed.toString(16).padStart(8, '0')}`;
  }

  begin() {
    $('menu').classList.add('hidden');
    this.pausedForMenu = false;
    this.paused = false;
    document.body.className = 'playing';
    this.input.requestLock();
    this.clock.getDelta();
  }

  _loop() {
    requestAnimationFrame(() => this._loop());
    const dt = Math.min(this.clock.getDelta(), 0.1);
    this.time += dt;

    if (!this.paused) {
      this._update(dt);
    }
    this._render(dt);
    this.input.endFrame();
  }

  _update(dt) {
    const input = this.input;
    if (input.locked) {
      this.player.look(input.mouseDX, input.mouseDY, this.input.sensitivity, false);
    }
    if (this.photo) {
      const p = this.photo;
      this.camera.position.set(p.x, p.y, p.z);
      this.camera.rotation.set(0, 0, 0);
      this.camera.rotateY(p.yaw);
      this.camera.rotateX(p.pitch);
    } else {
      const r = this.player.update(dt, input);
      this._lastStep = r;
    }
    this.atmos.update(this.camera, this.time, dt);
    this.ocean.update(this.time);
    this.terrain.update(this.camera.position.x, this.camera.position.z, 2.5);
    this._updateSun();
    this.engine.renderer.shadowMap.needsUpdate = true;
    this.hud.update(dt);
  }

  /** Place the camera freely (development and screenshot tooling). */
  setPhoto(x, y, z, yaw, pitch) {
    this.photo = { x, y, z, yaw, pitch };
  }
  clearPhoto() { this.photo = null; }

  _render(dt) {
    // sun position on screen for the shaft effect
    const sunWorld = this.player.pos.clone().add(this.atmos.sunDir.clone().multiplyScalar(500));
    const p = sunWorld.project(this.camera);
    const visible = p.z < 1 && this.atmos.sunDir.y > -0.05;
    this.engine.sunScreen.set(p.x * 0.5 + 0.5, p.y * 0.5 + 0.5);
    this.engine.render(this.scene, this.camera, {
      time: this.time,
      sunScreen: this.engine.sunScreen,
      sunVisible: visible,
    });
  }
}

const game = new Game();
window.__game = game;
game.start().catch((e) => {
  console.error(e);
  bootMsg.textContent = 'Failed to start: ' + e.message;
});

// menu wiring
$('btnPlay').onclick = () => game.begin();
$('btnNew').onclick = () => {
  localStorage.removeItem('tlb.seed');
  location.reload();
};
$('btnSettings').onclick = () => {
  const p = $('menuPanel');
  p.classList.toggle('show');
  if (p.classList.contains('show') && !p.childElementCount) buildSettings(p, game);
};

function buildSettings(panel, game) {
  panel.innerHTML = '';
  const card = (title, rows) => {
    const c = document.createElement('div');
    c.className = 'optCard';
    c.innerHTML = `<h3>${title}</h3>`;
    for (const r of rows) c.appendChild(r);
    panel.appendChild(c);
    return c;
  };
  const seg = (options, current, onPick) => {
    const row = document.createElement('div');
    row.className = 'row';
    const s = document.createElement('div');
    s.className = 'seg';
    options.forEach((o, i) => {
      const b = document.createElement('button');
      b.textContent = o;
      if (i === current) b.className = 'on';
      b.onclick = () => {
        [...s.children].forEach((c) => c.classList.remove('on'));
        b.classList.add('on');
        onPick(i);
      };
      s.appendChild(b);
    });
    row.appendChild(s);
    return row;
  };

  card('Graphics', [
    seg(['Low', 'Medium', 'High'], ['low', 'medium', 'high'].indexOf(game.quality), (i) => {
      game.quality = ['low', 'medium', 'high'][i];
      localStorage.setItem('tlb.quality', game.quality);
      game.engine.setQuality(game.quality);
      game.sun.shadow.mapSize.set(game.engine.q.shadowSize, game.engine.q.shadowSize);
      if (game.sun.shadow.map) { game.sun.shadow.map.dispose(); game.sun.shadow.map = null; }
    }),
    (() => {
      const row = document.createElement('div');
      row.className = 'row';
      row.innerHTML = '<span>Render scale</span>';
      const r = document.createElement('input');
      r.type = 'range'; r.min = '40'; r.max = '100'; r.value = String(game.engine.renderScale * 100);
      r.oninput = () => game.engine.setRenderScale(Number(r.value) / 100);
      row.appendChild(r);
      return row;
    })(),
  ]);

  card('Controls', [
    (() => {
      const row = document.createElement('div');
      row.className = 'row';
      row.innerHTML = '<span>Look sensitivity</span>';
      const r = document.createElement('input');
      r.type = 'range'; r.min = '4'; r.max = '40'; r.value = String(game.input.sensitivity * 1000);
      r.oninput = () => { game.input.sensitivity = Number(r.value) / 1000; localStorage.setItem('tlb.sens', r.value); };
      row.appendChild(r);
      return row;
    })(),
    (() => {
      const row = document.createElement('div');
      row.className = 'row';
      const l = document.createElement('span'); l.textContent = 'Invert look';
      const s = document.createElement('div');
      s.className = 'seg';
      const b = document.createElement('button'); b.textContent = 'Off';
      b.onclick = () => { b.classList.add('on'); game.input.invertY = false; };
      const b2 = document.createElement('button'); b2.textContent = 'On';
      b2.onclick = () => { b2.classList.add('on'); game.input.invertY = true; };
      s.appendChild(b); s.appendChild(b2);
      row.appendChild(s);
      return row;
    })(),
  ]);

  card('World', [
    (() => {
      const row = document.createElement('div');
      row.className = 'row';
      const l = document.createElement('span'); l.textContent = 'Chart name';
      const i = document.createElement('input');
      i.type = 'text'; i.value = game.seedText; i.placeholder = 'any words';
      i.style.cssText = 'pointer-events:auto;background:rgba(0,0,0,.35);border:1px solid rgba(255,255,255,.16);color:#e8e2d4;padding:6px 9px;font-family:var(--sans);font-size:12px;width:130px;border-radius:2px';
      i.onchange = () => { localStorage.setItem('tlb.seed', i.value.trim()); };
      row.appendChild(i);
      return row;
    })(),
    (() => {
      const row = document.createElement('div');
      row.className = 'row';
      const b = document.createElement('button');
      b.className = 'btn'; b.style.padding = '8px 16px'; b.textContent = 'Chart this island';
      b.onclick = () => { localStorage.setItem('tlb.seed', i.value.trim()); location.reload(); };
      row.appendChild(b);
      return row;
    })(),
  ]);
}
