// ---------------------------------------------------------------------------
// Buildings.
//
// Every structure on the island is assembled from boxes and prisms with
// procedural textures. Each has real interiors: rooms, doors, stairs and
// furniture. Collision AABBs are emitted as the geometry is placed,
// so the player can walk everywhere.
//
// Coordinate convention per building, local space:
//   +x : along the front wall (length axis), +z : towards the back
//   The whole building is rotated by `yaw` about Y.
// ---------------------------------------------------------------------------

import * as THREE from 'three';
import { clamp, clamp01, lerp } from '../core/math.js';
import { makeRng } from '../core/rng.js';
import { plasterTexture, stoneTexture, brickTexture, slateTexture, plankTexture, dirtTexture } from './textures.js';

let _tex;
function tex() {
  if (_tex) return _tex;
  _tex = {
    stone: stoneTexture(8),
    slate: slateTexture(11),
    plank: plankTexture(13),
    dirt: dirtTexture(17),
    brick: brickTexture(9),
    plasterA: plasterTexture(5),
    plasterB: plasterTexture(23, undefined, [212, 207, 194]),
    plasterC: plasterTexture(31, undefined, [233, 231, 223]),
  };
  return _tex;
}

export class Buildings {
  constructor(scene, island, collision, atmos, rng) {
    this.scene = scene;
    this.island = island;
    this.collision = collision;
    this.atmos = atmos;
    this.rng = rng;
    this.group = new THREE.Group();
    this.group.name = 'buildings';
    this.doors = [];            // {pivot, collider, open, target, x, z, w}
    this.pointsOfInterest = [];
    this._materials();
  }

  _materials() {
    const t = tex();
    this.matPlaster = new THREE.MeshStandardMaterial({ map: t.plasterA, roughness: 0.94 });
    this.matPlaster2 = new THREE.MeshStandardMaterial({ map: t.plasterB, roughness: 0.94 });
    this.matWhitewash = new THREE.MeshStandardMaterial({ map: t.plasterC, roughness: 0.9 });
    this.matStone = new THREE.MeshStandardMaterial({ map: t.stone, roughness: 0.97 });
    this.matBrick = new THREE.MeshStandardMaterial({ map: t.brick, roughness: 0.95 });
    this.matSlate = new THREE.MeshStandardMaterial({ map: t.slate, roughness: 0.84, metalness: 0.04 });
    this.matPlank = new THREE.MeshStandardMaterial({ map: t.plank, roughness: 0.88 });
    this.matDirt = new THREE.MeshStandardMaterial({ map: t.dirt, roughness: 1.0 });
    this.matGlass = new THREE.MeshStandardMaterial({ color: 0x25313a, roughness: 0.14, metalness: 0.72, emissive: 0x070c10, emissiveIntensity: 0.8 });
    this.matGlassLit = new THREE.MeshStandardMaterial({ color: 0xd8b878, roughness: 0.5, emissive: 0xffb254, emissiveIntensity: 1.9 });
    this.matIron = new THREE.MeshStandardMaterial({ color: 0x2b2b2f, roughness: 0.5, metalness: 0.8 });
    this.matRed = new THREE.MeshStandardMaterial({ color: 0xb0392b, roughness: 0.9 });
    this.matBeam = new THREE.MeshStandardMaterial({ color: 0x3c2a1c, roughness: 0.9 });
  }

  _mesh(geo, mat, x, y, z, yaw = 0, parent = this.group) {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.rotation.y = yaw;
    m.castShadow = true;
    m.receiveShadow = true;
    parent.add(m);
    return m;
  }

  _box(x, y, z, w, h, d, mat, yaw = 0, cast = true) {
    return this._mesh(new THREE.BoxGeometry(w, h, d), mat, x, y, z, yaw);
  }

  /** World AABB from local building coords. */
  _aabb(x, z, yaw, lx, lz, w, h, d, y, tag) {
    const c = Math.cos(yaw), s = Math.sin(yaw);
    const wx = x + lx * c + lz * s;
    const wz = z - lx * s + lz * c;
    const ex = (Math.abs(w * c) + Math.abs(d * s)) / 2;
    const ez = (Math.abs(w * s) + Math.abs(d * c)) / 2;
    return this.collision.addBox(wx - ex, y - h / 2, wz - ez, wx + ex, y + h / 2, wz + ez, { tag });
  }

  /**
   * A wall in local space. Holes are rectangular openings with `x` as the
   * offset along the wall's length. `axis` is 'x' (wall runs along local x)
   * or 'z' (runs along local z).
   */
  _wall(parent, yaw, x, yBase, z, lx, lz, len, h, holes, mat, tag, axis = 'x') {
    const spans = (holes || []).map((o) => ({ a: o.x - o.w / 2, b: o.x + o.w / 2, y0: o.y0 ?? 0, y1: o.y1 ?? h, kind: o.kind || '' }));
    spans.sort((p, q) => p.a - q.a);
    const parts = [];
    let cursor = -len / 2;
    for (const s of spans) {
      if (s.a > cursor + 0.01) parts.push({ x: (cursor + s.a) / 2, w: s.a - cursor, y0: 0, y1: h });
      if (s.y0 > 0.02) parts.push({ x: (s.a + s.b) / 2, w: s.b - s.a, y0: 0, y1: s.y0 });
      if (s.y1 < h - 0.02) parts.push({ x: (s.a + s.b) / 2, w: s.b - s.a, y0: s.y1, y1: h });
      cursor = Math.max(cursor, s.b);
    }
    if (cursor < len / 2 - 0.01) parts.push({ x: (cursor + len / 2) / 2, w: len / 2 - cursor, y0: 0, y1: h });

    const c = Math.cos(yaw), s = Math.sin(yaw);
    for (const p of parts) {
      const bh = p.y1 - p.y0;
      if (bh <= 0.02 || p.w <= 0.02) continue;
      let ox = lx, oz = lz, wBox, dBox;
      if (axis === 'x') { ox = lx + p.x; wBox = p.w; dBox = 0.22; }
      else { oz = lz + p.x; wBox = 0.22; dBox = p.w; }
      const wx = x + ox * c + oz * s;
      const wz = z - ox * s + oz * c;
      const wy = yBase + p.y0 + bh / 2;
      const m = new THREE.Mesh(new THREE.BoxGeometry(wBox, bh, dBox), mat);
      m.position.set(wx, wy, wz);
      m.rotation.y = yaw;
      m.castShadow = true;
      m.receiveShadow = true;
      (parent || this.group).add(m);
      this._aabb(x, z, yaw, ox, oz, wBox, bh, dBox, wy, tag);
    }
  }

  /** A gable roof prism built in a rotated group. */
  _prism(x, y, z, yaw, W, D, H, mat, parent) {
    const g = new THREE.Group();
    g.position.set(x, y, z);
    g.rotation.y = yaw;
    const slopeLen = Math.hypot(D / 2, H);
    const ang = Math.atan2(H, D / 2);
    for (const side of [-1, 1]) {
      const geo = new THREE.BoxGeometry(W + 0.65, 0.12, slopeLen + 0.3);
      const m = new THREE.Mesh(geo, mat);
      m.position.set(0, H / 2, side * D / 4);
      m.rotation.x = -side * ang;
      m.castShadow = true;
      m.receiveShadow = true;
      g.add(m);
    }
    // ridge cap
    const ridge = new THREE.Mesh(new THREE.BoxGeometry(W + 0.66, 0.09, 0.34), mat);
    ridge.position.set(0, H + 0.02, 0);
    g.add(ridge);
    // gable triangles (plaster)
    const tri = new THREE.Shape();
    tri.moveTo(-D / 2, 0);
    tri.lineTo(D / 2, 0);
    tri.lineTo(0, H);
    tri.closePath();
    const tGeo = new THREE.ShapeGeometry(tri);
    for (const side of [-1, 1]) {
      const t = new THREE.Mesh(tGeo, this.matPlaster);
      t.rotation.y = side * Math.PI / 2;
      t.position.set(side * W / 2, 0, 0);
      t.castShadow = false;
      t.receiveShadow = true;
      g.add(t);
    }
    (parent || this.group).add(g);
    return g;
  }

  /** A window: recess, frame, glass, mullions and a sill. */
  _window(x, y, z, yaw, w = 0.8, h = 0.94, lit = false) {
    const g = new THREE.Group();
    g.position.set(x, y, z);
    g.rotation.y = yaw;
    // frame
    const fw = 0.07;
    const mk = (bw, bh, bz, bx, by) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, 0.2), this.matPlank);
      m.position.set(bx, by, bz);
      m.receiveShadow = true;
      g.add(m);
    };
    mk(w + fw * 2, fw, 0, 0, h / 2 + fw / 2);
    mk(w + fw * 2, fw, 0, 0, -h / 2 - fw / 2);
    mk(fw, h, 0, -w / 2 - fw / 2, 0);
    mk(fw, h, 0, w / 2 + fw / 2, 0);
    // glass
    const glass = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.03), lit ? this.matGlassLit : this.matGlass);
    glass.position.set(0, 0, 0.04);
    g.add(glass);
    // mullions
    const mv = new THREE.Mesh(new THREE.BoxGeometry(0.045, h, 0.02), this.matPlank);
    mv.position.set(0, 0, 0.06);
    g.add(mv);
    const mh = new THREE.Mesh(new THREE.BoxGeometry(w, 0.045, 0.02), this.matPlank);
    mh.position.set(0, 0, 0.06);
    g.add(mh);
    // stone sill
    const sill = new THREE.Mesh(new THREE.BoxGeometry(w + 0.34, 0.07, 0.17), this.matStone);
    sill.position.set(0, -h / 2 - fw - 0.035, 0.02);
    sill.castShadow = true;
    g.add(sill);
    this.group.add(g);
  }

  /** A door that swings open with E. */
  _door(x, y, z, yaw, w = 0.98, h = 2.06, mat = this.matPlank) {
    const pivot = new THREE.Group();
    pivot.position.set(x, y, z);
    pivot.rotation.y = yaw;
    const panel = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.09), mat);
    panel.position.set(w / 2, h / 2, 0);
    panel.castShadow = true;
    panel.receiveShadow = true;
    pivot.add(panel);
    const braceMat = this.matPlank;
    for (const by of [h * 0.72, h * 0.3]) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(w * 0.88, 0.13, 0.02), braceMat);
      b.position.set(w / 2, by, -0.055);
      pivot.add(b);
    }
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), this.matIron);
    knob.position.set(w - 0.13, h * 0.46, -0.065);
    pivot.add(knob);
    this.group.add(pivot);
    const c = this.collision.addOriented(x, y + h / 2, z, w, h, 0.18, yaw, { tag: 'door' });
    const door = { pivot, collider: c, open: false, angle: 0, swing: 0, x, z, w, h, baseYaw: yaw };
    pivot.userData.baseYaw = yaw;
    pivot.userData.door = door;
    this.doors.push(door);
    return door;
  }

  /** Frame posts around a doorway. */
  _frame(x, y, z, yaw, w, h) {
    const c = Math.cos(yaw), s = Math.sin(yaw);
    this._box(x - c * (w / 2), y + h / 2, z + s * (w / 2), 0.1, h + 0.1, 0.18, this.matPlank, yaw);
    this._box(x + c * (w / 2), y + h / 2, z - s * (w / 2), 0.1, h + 0.1, 0.18, this.matPlank, yaw);
    this._box(x, y + h + 0.05, z, w + 0.22, 0.1, 0.18, this.matPlank, yaw);
  }

  // --- furniture ---------------------------------------------------------
  _table(x, y, z, yaw) {
    const c = Math.cos(yaw), s = Math.sin(yaw);
    this._box(x, y + 0.74, z, 1.3, 0.06, 0.8, this.matPlank, yaw);
    for (const [dx, dz] of [[-0.56, -0.33], [0.56, -0.33], [-0.56, 0.33], [0.56, 0.33]]) {
      this._aabb(x, z, yaw, dx, dz, 0.09, 0.72, 0.09, y + 0.36, 'tableleg');
      this._box(x + dx * c + dz * s, y + 0.36, z - dx * s + dz * c, 0.09, 0.72, 0.09, this.matPlank, yaw);
    }
    this._aabb(x, z, yaw, 0, 0, 1.3, 0.06, 0.8, y + 0.74, 'table');
  }

  _stool(x, y, z) {
    this._box(x, y + 0.24, z, 0.38, 0.48, 0.38, this.matPlank);
    this._aabb(x, z, 0, 0, 0, 0.38, 0.48, 0.38, y + 0.24, 'stool');
  }

  _chair(x, y, z, yaw) {
    const c = Math.cos(yaw), s = Math.sin(yaw);
    this._box(x, y + 0.44, z, 0.42, 0.06, 0.42, this.matPlank, yaw);
    this._box(x, y + 0.66, z + Math.sin(yaw) * 0.19 - Math.cos(yaw) * 0, 0.42, 0.5, 0.06, this.matPlank, yaw);
    this._aabb(x, z, yaw, 0, 0, 0.42, 0.5, 0.42, y + 0.46, 'chair');
  }

  _bed(x, y, z, yaw) {
    const c = Math.cos(yaw), s = Math.sin(yaw);
    this._box(x, y + 0.32, z, 0.95, 0.34, 2.05, this.matPlank, yaw);
    const mat = new THREE.Mesh(new THREE.BoxGeometry(0.88, 0.16, 1.95), new THREE.MeshStandardMaterial({ color: 0x5f5346, roughness: 1 }));
    mat.position.set(x, y + 0.55, z);
    mat.rotation.y = yaw;
    this.group.add(mat);
    const pil = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.11, 0.36), new THREE.MeshStandardMaterial({ color: 0xb9b0a2, roughness: 1 }));
    pil.position.set(x - Math.sin(yaw) * 0.7, y + 0.68, z - Math.cos(yaw) * 0.7);
    pil.rotation.y = yaw;
    this.group.add(pil);
    this._aabb(x, z, yaw, 0, 0, 0.95, 0.6, 2.05, y + 0.32, 'bed');
  }

  _crate(x, y, z, size, yaw) {
    this._box(x, y + size * 0.36, z, size, size * 0.72, size, this.matPlank, yaw);
    this._aabb(x, z, yaw, 0, 0, size, size * 0.72, size, y + size * 0.36, 'crate');
  }

  _barrel(x, y, z, r) {
    const c = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 0.88, r * 2.5, 10), this.matPlank);
    c.position.set(x, y + r * 1.25, z);
    c.castShadow = true; c.receiveShadow = true;
    this.group.add(c);
    // iron hoops
    for (const hy of [-r * 0.55, r * 0.5]) {
      const hoop = new THREE.Mesh(new THREE.TorusGeometry(r * 0.97, 0.028, 5, 12), this.matIron);
      hoop.rotation.x = Math.PI / 2;
      hoop.position.set(x, y + r * 1.25 + hy, z);
      this.group.add(hoop);
    }
    this._aabb(x, z, 0, 0, 0, r * 1.75, r * 2.5, r * 1.75, y + r * 1.25, 'barrel');
  }

  /** Stairs built of solid steps, using the player's step-up allowance. */
  _stairs(x, y, z, yaw, totalRise, steps, run, width) {
    const c = Math.cos(yaw), s = Math.sin(yaw);
    const rise = totalRise / steps;
    for (let i = 0; i < steps; i++) {
      const along = (i + 0.5) * (run / steps);
      const h = (i + 1) * rise;
      const wx = x + c * along, wz = z - s * along;
      this._aabb(wx, wz, yaw, 0, 0, width, h, run / steps + 0.08, y + h / 2, 'stair');
      this._box(wx, y + h / 2, wz, width, h, run / steps + 0.08, this.matPlank, yaw);
    }
  }

  /** Loose clutter: scattered planks, stones, nets. */
  _clutter(x, y, z, kind) {
    if (kind === 'crate') this._crate(x, y, z, 0.52, this.rng() * 3);
    else if (kind === 'barrel') this._barrel(x, y, z, 0.26);
    else if (kind === 'stool') this._stool(x, y, z);
  }
}
