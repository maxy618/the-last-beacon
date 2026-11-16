// ---------------------------------------------------------------------------
// Collision.
//
// The world is made of axis-aligned boxes (walls, floors, doors, furniture)
// plus the terrain heightfield. A vertical cylinder stands in for the player
// and is pushed out of anything it overlaps, with a step-up allowance so
// stairs and thresholds work without special cases.
//
// Boxes are indexed in a flat XZ grid for broad phase.
// ---------------------------------------------------------------------------

import { clamp, clamp01 } from '../core/math.js';

const CELL = 8;

export class CollisionWorld {
  constructor(island) {
    this.island = island;
    this.boxes = [];         // {x0,y0,z0,x1,y1,z1, id, solid, enabled, tag}
    this.grid = new Map();
    this.dirty = true;
  }

  _key(cx, cz) { return cx * 73856093 ^ cz * 19349663; }

  /** Add an axis aligned box. Returns its index. */
  addBox(x0, y0, z0, x1, y1, z1, opts = {}) {
    const b = {
      x0: Math.min(x0, x1), y0: Math.min(y0, y1), z0: Math.min(z0, z1),
      x1: Math.max(x0, x1), y1: Math.max(y0, y1), z1: Math.max(z0, z1),
      id: opts.id ?? this.boxes.length,
      enabled: opts.enabled !== false,
      tag: opts.tag || '',
      data: opts.data || null,
      slope: !!opts.slope,
    };
    this.boxes.push(b);
    this.dirty = true;
    return b;
  }

  addBoxCentered(cx, cy, cz, sx, sy, sz, opts) {
    return this.addBox(cx - sx / 2, cy - sy / 2, cz - sz / 2, cx + sx / 2, cy + sy / 2, cz + sz / 2, opts);
  }

  /** A rotated box is approximated by its enclosing axis aligned box. */
  addOriented(cx, cy, cz, sx, sy, sz, yaw, opts) {
    const c = Math.abs(Math.cos(yaw)), s = Math.abs(Math.sin(yaw));
    const ex = (sx * c + sz * s) / 2, ez = (sx * s + sz * c) / 2;
    return this.addBox(cx - ex, cy - sy / 2, cz - ez, cx + ex, cy + sy / 2, cz + ez, opts);
  }

  rebuild() {
    this.grid.clear();
    for (let i = 0; i < this.boxes.length; i++) {
      const b = this.boxes[i];
      const cx0 = Math.floor(b.x0 / CELL), cx1 = Math.floor(b.x1 / CELL);
      const cz0 = Math.floor(b.z0 / CELL), cz1 = Math.floor(b.z1 / CELL);
      for (let cz = cz0; cz <= cz1; cz++) {
        for (let cx = cx0; cx <= cx1; cx++) {
          const k = this._key(cx, cz);
          let a = this.grid.get(k);
          if (!a) { a = []; this.grid.set(k, a); }
          a.push(i);
        }
      }
    }
    this.dirty = false;
  }

  _near(x0, z0, x1, z1, out) {
    if (this.dirty) this.rebuild();
    out.length = 0;
    const cx0 = Math.floor(x0 / CELL), cx1 = Math.floor(x1 / CELL);
    const cz0 = Math.floor(z0 / CELL), cz1 = Math.floor(z1 / CELL);
    const seen = new Set();
    for (let cz = cz0; cz <= cz1; cz++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const a = this.grid.get(this._key(cx, cz));
        if (!a) continue;
        for (const i of a) {
          if (seen.has(i)) continue;
          seen.add(i);
          out.push(this.boxes[i]);
        }
      }
    }
    return out;
  }

  /**
   * Highest solid surface under a point, at or below `maxY`.
   * Includes the terrain.
   */
  supportHeight(x, z, radius, maxY) {
    let best = -Infinity;
    const th = this.island ? this.island.heightAt(x, z) : -1e9;
    if (th <= maxY) best = th;
    const list = this._near(x - radius, z - radius, x + radius, z + radius, this._tmp || (this._tmp = []));
    for (const b of list) {
      if (!b.enabled) continue;
      if (b.y1 > maxY + 1e-4) continue;
      if (b.y1 <= best) continue;
      // the cylinder has to overlap the box footprint
      const dx = Math.max(b.x0 - x, 0, x - b.x1);
      const dz = Math.max(b.z0 - z, 0, z - b.z1);
      if (dx * dx + dz * dz <= radius * radius) best = b.y1;
    }
    return best;
  }

  /**
   * Push a vertical cylinder out of every box it overlaps.
   * Returns {x, y, z, hit, hitBox, groundY}.
   */
  resolve(x, y, z, radius, height, stepHeight = 0.42) {
    const res = { x, y, z, hit: false, hitBox: null, grounded: false, groundY: -Infinity };
    const list = this._near(x - radius - 0.2, z - radius - 0.2, x + radius + 0.2, z + radius + 0.2, this._tmp2 || (this._tmp2 = []));
    const feet = y, head = y + height;
    for (let iter = 0; iter < 3; iter++) {
      let moved = false;
      for (const b of list) {
        if (!b.enabled) continue;
        if (b.y1 <= feet + 0.02 || b.y0 >= head - 0.02) continue;
        // cylinder vs AABB in XZ
        const cx = clamp(res.x, b.x0, b.x1);
        const cz = clamp(res.z, b.z0, b.z1);
        const dx = res.x - cx, dz = res.z - cz;
        const d2 = dx * dx + dz * dz;
        if (d2 >= radius * radius) continue;
        // step up: if the box top is a small step above the feet, lift instead
        const stepTop = b.y1;
        if (stepTop - feet <= stepHeight && stepTop > feet - 0.05) {
          res.y = stepTop;
          res.groundY = Math.max(res.groundY, stepTop);
          res.grounded = true;
          continue;
        }
        const d = Math.sqrt(d2);
        let nx, nz, push;
        if (d > 1e-5) {
          nx = dx / d; nz = dz / d; push = radius - d;
        } else {
          // centre is inside the box: push out along the smallest overlap
          const ox = Math.min(res.x - b.x0, b.x1 - res.x);
          const oz = Math.min(res.z - b.z0, b.z1 - res.z);
          if (ox < oz) { nx = res.x - b.x0 < b.x1 - res.x ? -1 : 1; nz = 0; push = ox + radius; }
          else { nx = 0; nz = res.z - b.z0 < b.z1 - res.z ? -1 : 1; push = oz + radius; }
        }
        res.x += nx * push;
        res.z += nz * push;
        res.hit = true;
        res.hitBox = b;
        moved = true;
      }
      if (!moved) break;
    }
    return res;
  }

  /** True if a straight segment between two points is blocked by a box. */
  segmentBlocked(ax, ay, az, bx, by, bz, radius = 0.05) {
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-5) return false;
    const steps = Math.max(2, Math.ceil(len / 0.35));
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const px = ax + dx * t, py = ay + dy * t, pz = az + dz * t;
      const list = this._near(px - radius, pz - radius, px + radius, pz + radius, this._tmp3 || (this._tmp3 = []));
      for (const b of list) {
        if (!b.enabled) continue;
        if (py < b.y0 || py > b.y1) continue;
        if (px < b.x0 - radius || px > b.x1 + radius) continue;
        if (pz < b.z0 - radius || pz > b.z1 + radius) continue;
        return true;
      }
    }
    return false;
  }
}
