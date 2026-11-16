// ---------------------------------------------------------------------------
// Structures: houses, bothies, chapels and sheds placed around the island.
// Coordinates are local: +x along the front wall (the face with the door),
// +z is from the front to the back. The whole building is turned by `yaw`.
// ---------------------------------------------------------------------------

import * as THREE from 'three';
import { clamp, lerp } from '../core/math.js';
import { makeRng } from '../core/rng.js';

/** local building coords -> world coords */
export function l2w(x, z, yaw, lx, lz) {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  return { x: x + lx * c + lz * s, z: z - lx * s + lz * c };
}

/**
 * The farmhouse. Two storeys, a kitchen and a parlour below and a bedroom
 * and a box room above. The entrance faces the sea.
 */
export function buildFarmhouse(b, x, z, yaw) {
  const rng = makeRng(311);
  const island = b.island;
  const yBase = island.heightAt(x, z) - 0.3;
  const W = 7.8, D = 5.8, wallH = 2.45, upperH = 2.32, gableH = 2.0, slabY = yBase + wallH;
  const colliders = [];

  // plinth to sit into the ground
  b._box(x, yBase - 0.62, z, W + 0.7, 1.5, D + 0.7, b.matStone, yaw);
  b._aabb(x, z, yaw, 0, 0, W + 0.7, 1.5, D + 0.7, yBase - 0.62, 'plinth');

  // ground floor walls
  const door = { x: 0.0, w: 0.98, y0: 0, y1: 2.06, kind: 'door' };
  b._wall(null, yaw, x, yBase, z, 0, D / 2, W, wallH, [
    door,
    { x: -W * 0.31, w: 0.84, y0: 0.72, y1: 1.66, kind: 'window' },
    { x: W * 0.31, w: 0.84, y0: 0.72, y1: 1.66, kind: 'window' },
  ], b.matPlaster, 'wall');
  b._wall(null, yaw, x, yBase, z, 0, -D / 2, W, wallH, [
    { x: -W * 0.26, w: 0.84, y0: 0.72, y1: 1.66, kind: 'window' },
    { x: W * 0.26, w: 0.84, y0: 0.72, y1: 1.66, kind: 'window' },
  ], b.matPlaster, 'wall');
  b._wall(null, yaw, x, yBase, z, W / 2, 0, D, wallH, [
    { x: 0.35, w: 0.84, y0: 0.72, y1: 1.66, kind: 'window' },
  ], b.matPlaster, 'wall', 'z');
  b._wall(null, yaw, x, yBase, z, -W / 2, 0, D, wallH, [
    { x: -0.4, w: 0.84, y0: 0.72, y1: 1.66, kind: 'window' },
  ], b.matPlaster, 'wall', 'z');

  // upper floor walls
  const upH = upperH + gableH * 0.42;
  b._wall(null, yaw, x, slabY, z, 0, D / 2, W, upH, [
    { x: -W * 0.31, w: 0.7, y0: 0.62, y1: 1.42, kind: 'window' },
    { x: W * 0.31, w: 0.7, y0: 0.62, y1: 1.42, kind: 'window' },
  ], b.matPlaster2, 'wall');
  b._wall(null, yaw, x, slabY, z, 0, -D / 2, W, upH, [
    { x: 0, w: 0.7, y0: 0.62, y1: 1.42, kind: 'window' },
  ], b.matPlaster2, 'wall');
  b._wall(null, yaw, x, slabY, z, W / 2, 0, D, upH, [
    { x: 0, w: 0.6, y0: 0.62, y1: 1.42, kind: 'window' },
  ], b.matPlaster2, 'wall', 'z');
  b._wall(null, yaw, x, slabY, z, -W / 2, 0, D, upH, [], b.matPlaster2, 'wall', 'z');

  // floor slab between storeys: full span except the stairwell open above the stairs
  {
    const a = l2w(x, z, yaw, -0.675, 0);
    b._box(a.x, slabY, a.z, W - 1.35, 0.15, D, b.matPlank, yaw, false);
    b._aabb(x, z, yaw, -0.675, 0, W - 1.35, 0.15, D, slabY, 'floor2');
    const p = l2w(x, z, yaw, W / 2 - 0.675, -1.85);
    b._box(p.x, slabY, p.z, 1.35, 0.15, 2.1, b.matPlank, yaw, false);
    b._aabb(x, z, yaw, W / 2 - 0.675, -1.85, 1.35, 0.15, 2.1, slabY, 'floor2');
    const q = l2w(x, z, yaw, W / 2 - 0.675, 2.62);
    b._box(q.x, slabY, q.z, 1.35, 0.15, 0.56, b.matPlank, yaw, false);
    b._aabb(x, z, yaw, W / 2 - 0.675, 2.62, 1.35, 0.15, 0.56, slabY, 'floor2');
  }

  // roof
  b._prism(x, slabY + upH - 0.02, z, yaw, W, D, gableH, b.matSlate);

  // chimney stack
  const chLX = W * 0.28, chLZ = D * 0.18;
  const chC = Math.cos(yaw), chS = Math.sin(yaw);
  const chX = x + chLX * chC + chLZ * chS, chZ = z - chLX * chS + chLZ * chC;
  b._box(chX, yBase + wallH + upperH / 2 + gableH * 0.5, chZ, 0.72, wallH + upperH + gableH + 2.0, 0.72, b.matBrick, yaw);
  b._aabb(x, z, yaw, chLX, chLZ, 0.72, wallH + upperH + gableH + 2.0, 0.72, yBase + (wallH + upperH + gableH + 2.0) / 2 - 0.4, 'chimney');
  b._box(chX, yBase + wallH + upperH + gableH + 2.0, chZ, 0.98, 0.22, 0.98, b.matStone, yaw);

  // door + windows
  const dC = Math.cos(yaw), dS = Math.sin(yaw);
  const doorX = x + Math.cos(yaw) * 0 + Math.cos(yaw + Math.PI / 2) * (D / 2), doorZ = z - Math.sin(yaw) * 0 + Math.sin(yaw + Math.PI / 2) * (D / 2);
  // door world position: front face, local x = 0 -> rotate (0, D/2)
  const df = l2w(x, z, yaw, 0, D / 2);
  const dwx = x + df.x, dwz = z + df.z;
  const doorObj = b._door(dwx, yBase, dwz, yaw, 0.98, 2.06, b.matPlank);
  b._frame(dwx, yBase, dwz, yaw, 0.98, 2.06);

  // front windows
  for (const lx of [-W * 0.31, W * 0.31]) {
    const lp = l2w(x, z, yaw, lx, D / 2);
    b._window(x + lp.x, yBase + 0.72 + 0.47, z + lp.z, yaw, 0.84, 0.94, false);
  }
  // back windows
  for (const lx of [-W * 0.26, W * 0.26]) {
    const lp = l2w(x, z, yaw, lx, -D / 2);
    b._window(x + lp.x, yBase + 0.72 + 0.47, z + lp.z, yaw + Math.PI, 0.84, 0.94, false);
  }
  // gable windows, upper
  {
    const lp = l2w(x, z, yaw, W / 2, 0);
    b._window(x + lp.x, slabY + 0.62 + 0.4, z + lp.z, yaw + Math.PI / 2, 0.6, 0.8, false);
  }

  // interior partition (kitchen/parlour split), with a doorway
  b._wall(null, yaw, x, yBase, z, 0.9, 0, D - 0.44, wallH, [
    { x: 0.45, w: 0.9, y0: 0, y1: 2.02, kind: 'doorway' },
  ], b.matPlaster2, 'partition', 'z');
  // upper partition
  b._wall(null, yaw, x, slabY, z, -0.5, 0, D - 0.44, upperH, [
    { x: -0.3, w: 0.9, y0: 0, y1: 2.02, kind: 'doorway' },
  ], b.matPlaster2, 'partition', 'z');

  // stairs up the east wall, rising from front to back
  const stDir = yaw + Math.PI;   // steps run away from the door
  const stBase = l2w(x, z, yaw, W / 2 - 0.8, D / 2 - 0.45);
  b._stairs(x + stBase.x, yBase, z + stBase.z, stDir, wallH, 13, 3.3, 0.92);

  // furniture: kitchen table, stools, crates and barrels
  const lp1 = l2w(x, z, yaw, -W * 0.3, -W * 0.18);
  b._table(x + lp1.x, yBase, z + lp1.z, yaw);
  b._stool(x + lp1.x + 1.1, yBase, z + lp1.z + 0.4);
  b._stool(x + lp1.x - 1.1, yBase, z + lp1.z - 0.3);
  const lp2 = l2w(x, z, yaw, -W * 0.36, D * 0.3);
  b._crate(x + lp2.x, yBase, z + lp2.z, 0.62, 0.4);
  const lp3 = l2w(x, z, yaw, W * 0.26, D * 0.3);
  b._barrel(x + lp3.x, yBase, z + lp3.z, 0.28);

  // upstairs furniture
  const lp4 = l2w(x, z, yaw, -W * 0.3, D * 0.24);
  b._bed(x + lp4.x, slabY + 0.15, z + lp4.z, yaw + Math.PI / 2);
  const lp5 = l2w(x, z, yaw, W * 0.32, -D * 0.26);
  b._bed(x + lp5.x, slabY + 0.15, z + lp5.z, yaw - Math.PI / 2);

  // fireplace recess on the west gable
  const fp = l2w(x, z, yaw, -W / 2 + 0.05, -D * 0.08);
  b._box(x + fp.x, yBase + 0.5, z + fp.z, 0.26, 1.0, 0.9, b.matStone, yaw);

  return { type: 'farmhouse', door: doorObj, x, z };
}

/** The bothy: a one-room shepherd's shelter, singe-storey, small. */
export function buildBothy(b, x, z, yaw) {
  const island = b.island;
  const yBase = island.heightAt(x, z) - 0.25;
  const W = 4.1, D = 3.1, wallH = 2.15, gableH = 1.35;
  b._box(x, yBase - 0.5, z, W + 0.5, 1.3, D + 0.5, b.matStone, yaw);
  b._aabb(x, z, yaw, 0, 0, W + 0.5, 1.3, D + 0.5, yBase - 0.5, 'plinth');

  const door = { x: -0.5, w: 0.92, y0: 0, y1: 1.95, kind: 'door' };
  b._wall(null, yaw, x, yBase, z, 0, D / 2, W, wallH, [
    door,
    { x: W * 0.29, w: 0.72, y0: 0.72, y1: 1.55, kind: 'window' },
  ], b.matStone, 'wall');
  b._wall(null, yaw, x, yBase, z, 0, -D / 2, W, wallH, [
    { x: 0, w: 0.7, y0: 0.72, y1: 1.55, kind: 'window' },
  ], b.matStone, 'wall');
  b._wall(null, yaw, x, yBase, z, W / 2, 0, D, wallH, [], b.matStone, 'wall', 'z');
  b._wall(null, yaw, x, yBase, z, -W / 2, 0, D, wallH, [], b.matStone, 'wall', 'z');

  b._prism(x, yBase + wallH - 0.02, z, yaw, W, D, gableH, b.matSlate);

  const df = l2w(x, z, yaw, door.x, D / 2);
  const doorObj = b._door(x + df.x, yBase, z + df.z, yaw, 0.9, 1.98, b.matPlank);
  b._frame(x + df.x, yBase, z + df.z, yaw, 0.9, 1.98);
  const lp = l2w(x, z, yaw, W * 0.29, D / 2);
  b._window(x + lp.x, yBase + 0.72 + 0.41, z + lp.z, yaw, 0.72, 0.83, false);

  // a hearth and a bed platform
  const lp2 = l2w(x, z, yaw, -W * 0.24, -D * 0.2);
  b._box(x + lp2.x, yBase + 0.4, z + lp2.z, 0.24, 0.8, 0.7, b.matStone, yaw);
  const lp3 = l2w(x, z, yaw, W * 0.2, 0.1);
  b._bed(x + lp3.x, yBase, z + lp3.z, yaw + Math.PI / 2);

  return { type: 'bothy', door: doorObj, x, z };
}

/** A chapel with no roof and a hole in its east wall - long abandoned. */
export function buildChapel(b, x, z, yaw) {
  const island = b.island;
  const yBase = island.heightAt(x, z) - 0.3;
  const W = 4.6, D = 9.5, wallH = 3.1;
  b._box(x, yBase - 0.45, z, W + 0.6, 1.3, D + 0.6, b.matStone, yaw);
  b._aabb(x, z, yaw, 0, 0, W + 0.6, 1.3, D + 0.6, yBase - 0.45, 'plinth');

  b._wall(null, yaw, x, yBase, z, 0, D / 2, W, wallH, [
    { x: 0, w: 1.15, y0: 0, y1: 2.15, kind: 'door' },
  ], b.matStone, 'wall');
  b._wall(null, yaw, x, yBase, z, 0, -D / 2, W, wallH, [
    { x: 0, w: 1.5, y0: 0.8, y1: 2.6, kind: 'arch' },
  ], b.matStone, 'wall');
  b._wall(null, yaw, x, yBase, z, W / 2, 0, D, wallH, [
    { x: 1.8, w: 0.8, y0: 0.9, y1: 1.9, kind: 'window' },
    { x: -1.6, w: 0.8, y0: 0.9, y1: 1.9, kind: 'window' },
  ], b.matStone, 'wall', 'z');
  b._wall(null, yaw, x, yBase, z, -W / 2, 0, D, wallH, [
    { x: 1.2, w: 0.8, y0: 0.9, y1: 1.9, kind: 'window' },
    { x: -1.9, w: 0.8, y0: 0.9, y1: 1.9, kind: 'window' },
  ], b.matStone, 'wall', 'z');

  // fallen stones and rubble inside
  const lp = l2w(x, z, yaw, 0.4, -D * 0.18);
  b._crate(x + lp.x, yBase, z + lp.z, 0.6, 0.9);
  const lp2 = l2w(x, z, yaw, -0.9, D * 0.28);
  b._crate(x + lp2.x, yBase, z + lp2.z, 0.5, 2.1);

  return { type: 'chapel', door: null, x, z };
}

/** A boat shed with a slipway, near the coast. */
export function buildBoatShed(b, x, z, yaw) {
  const island = b.island;
  const yBase = island.heightAt(x, z) - 0.2;
  const W = 4.6, D = 6.4, wallH = 2.5, gableH = 1.0;
  b._box(x, yBase - 0.45, z, W + 0.5, 1.2, D + 0.5, b.matPlank, yaw);
  b._aabb(x, z, yaw, 0, 0, W + 0.5, 1.2, D + 0.5, yBase - 0.45, 'plinth');

  b._wall(null, yaw, x, yBase, z, 0, D / 2, W, wallH, [
    { x: 0, w: 2.4, y0: 0, y1: 2.1, kind: 'door' },
  ], b.matPlank, 'wall');
  b._wall(null, yaw, x, yBase, z, 0, -D / 2, W, wallH, [], b.matPlank, 'wall');
  b._wall(null, yaw, x, yBase, z, W / 2, 0, D, wallH, [], b.matPlank, 'wall', 'z');
  b._wall(null, yaw, x, yBase, z, -W / 2, 0, D, wallH, [], b.matPlank, 'wall', 'z');
  b._prism(x, yBase + wallH - 0.02, z, yaw, W, D, gableH, b.matSlate);

  // a slipway of planks running down to the water
  const dir = l2w(x, z, yaw, 0, -1);
  const slip = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.16, 7.5), b.matPlank);
  slip.position.set(x + dir.x * (D / 2 + 3.4), yBase - 0.1, z + dir.z * (D / 2 + 3.4));
  slip.rotation.y = yaw;
  slip.rotation.x = 0.09;
  slip.receiveShadow = true;
  b.group.add(slip);

  // a boat on chocks inside
  const boatG = new THREE.Group();
  boatG.position.set(x, yBase, z);
  boatG.rotation.y = yaw;
  const hull = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.62, 3.6, 8, 1, true, 0, Math.PI), b.matPlank);
  hull.rotation.z = Math.PI / 2;
  hull.scale.set(1.15, 1.6, 0.55);
  hull.position.y = 0.42;
  hull.castShadow = true;
  boatG.add(hull);
  b.group.add(boatG);
  b._box(x, yBase + 0.1, z, 3.6, 0.2, 1.6, b.matBeam, yaw);

  // crates and a broken mast
  b._crate(x + 1.1, yBase, z - 1.2, 0.6, 0.7);
  b._crate(x - 1.2, yBase, z + 1.0, 0.45, 1.9);

  return { type: 'boatshed', door: null, x, z };
}

/** The signal station: two storeys, a small spire and bare flagpole. */
export function buildSignalStation(b, x, z, yaw) {
  const island = b.island;
  const yBase = island.heightAt(x, z) - 0.3;
  const W = 5.6, D = 4.3, wallH = 2.4, upperH = 2.25, gableH = 1.7, slabY = yBase + wallH;
  const Wx = W, Dx = D;

  b._box(x, yBase - 0.5, z, W + 0.6, 1.3, D + 0.6, b.matWhitewash, yaw);
  b._aabb(x, z, yaw, 0, 0, W + 0.6, 1.3, D + 0.6, yBase - 0.5, 'plinth');

  const door = { x: 0.1, w: 0.95, y0: 0, y1: 2.02, kind: 'door' };
  b._wall(null, yaw, x, yBase, z, 0, D / 2, W, wallH, [
    door,
    { x: -W * 0.3, w: 0.78, y0: 0.72, y1: 1.62, kind: 'window' },
  ], b.matWhitewash, 'wall');
  b._wall(null, yaw, x, yBase, z, 0, -D / 2, W, wallH, [
    { x: 0, w: 0.78, y0: 0.72, y1: 1.62, kind: 'window' },
  ], b.matWhitewash, 'wall');
  b._wall(null, yaw, x, yBase, z, W / 2, 0, D, wallH, [
    { x: 0.3, w: 0.72, y0: 0.72, y1: 1.62, kind: 'window' },
  ], b.matWhitewash, 'wall', 'z');
  b._wall(null, yaw, x, yBase, z, -W / 2, 0, D, wallH, [], b.matWhitewash, 'wall', 'z');

  const upH = upperH + gableH * 0.4;
  b._wall(null, yaw, x, slabY, z, 0, D / 2, W, upH, [
    { x: 0, w: 0.68, y0: 0.62, y1: 1.4, kind: 'window' },
  ], b.matWhitewash, 'wall');
  b._wall(null, yaw, x, slabY, z, 0, -D / 2, W, upH, [
    { x: -W * 0.25, w: 0.62, y0: 0.62, y1: 1.4, kind: 'window' },
    { x: W * 0.25, w: 0.62, y0: 0.62, y1: 1.4, kind: 'window' },
  ], b.matWhitewash, 'wall');
  b._wall(null, yaw, x, slabY, z, W / 2, 0, D, upH, [], b.matWhitewash, 'wall', 'z');
  b._wall(null, yaw, x, slabY, z, -W / 2, 0, D, upH, [], b.matWhitewash, 'wall', 'z');

  b._box(x, slabY, z, W, 0.15, D, b.matPlank, yaw, false);
  b._aabb(x, z, yaw, 0, 0, W, 0.15, D, slabY, 'floor2');
  b._prism(x, slabY + upH - 0.02, z, yaw, W, D, gableH, b.matSlate);

  const df = l2w(x, z, yaw, door.x, D / 2);
  const doorObj = b._door(x + df.x, yBase, z + df.z, yaw, 0.95, 2.02, b.matIron);
  b._frame(x + df.x, yBase, z + df.z, yaw, 0.95, 2.02);
  const lp = l2w(x, z, yaw, -W * 0.3, D / 2);
  b._window(x + lp.x, yBase + 0.72 + 0.45, z + lp.z, yaw, 0.78, 0.9, false);

  // flagpole with a ragged flag (a dark cloth on a pole)
  const fp = l2w(x, z, yaw, 0, -D / 2);
  const px = x + fp.x, pz = z + fp.z;
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.075, 5.6, 8), b.matIron);
  pole.position.set(px, yBase + 2.8, pz);
  pole.castShadow = true;
  b.group.add(pole);
  const flagGeo = new THREE.PlaneGeometry(1.5, 0.92, 6, 3);
  const fpos = flagGeo.attributes.position;
  for (let i = 0; i < fpos.count; i++) {
    const u = fpos.getX(i) / 1.5 + 0.5;
    fpos.setZ(i, Math.sin(u * 5.2) * 0.085 * (u + 0.4));
  }
  flagGeo.computeVertexNormals();
  const flag = new THREE.Mesh(flagGeo, new THREE.MeshStandardMaterial({ color: 0x243040, side: THREE.DoubleSide, roughness: 1 }));
  flag.position.set(px + 0.82, yBase + 5.35, pz);
  flag.rotation.y = yaw + 0.4;
  b.group.add(flag);

  // a brass speaking tube on the sill and crates
  b._crate(x + 1.2, yBase, z - 0.9, 0.55, 1.2);
  b._crate(x - 1.1, slabY + 0.15, z + 0.7, 0.4, 0.3);
  b._table(x - 0.9, slabY + 0.15, z - 0.8, yaw + Math.PI / 2);

  return { type: 'station', door: doorObj, x, z };
}
