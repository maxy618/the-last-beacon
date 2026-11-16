// ---------------------------------------------------------------------------
// The lighthouse.
//
// A tapered granite tower with a whitewashed upper half, a gallery, a glazed
// lantern room, and a spiral stair inside. The player can enter, climb the
// stair and repair the lamp (after the story unlocks it).
// ---------------------------------------------------------------------------

import * as THREE from 'three';
import { clamp, lerp } from '../core/math.js';
import { makeRng } from '../core/rng.js';
import { l2w } from './structures.js';

export function buildLighthouse(b, x, z, yaw) {
  const rng = makeRng(909);
  const island = b.island;
  const yBase = island.heightAt(x, z) - 0.4;
  const R0 = 3.55, R1 = 2.35, towerH = 11.2, lean = 0.012;
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const colliders = [];

  // --- stone foundation ring
  const ring = new THREE.Mesh(new THREE.CylinderGeometry(R0 + 1.15, R0 + 1.35, 1.5, 24), b.matStone);
  ring.position.set(x, yBase - 0.55, z);
  ring.castShadow = true; ring.receiveShadow = true;
  b.group.add(ring);

  // --- tower: granite lower half, lime-washed above with a red band
  const seg = 24;
  const courses = [
    // [y0, y1, radius, material, red band?]
    [0, 4.6, R0, b.matStone, false],
    [4.6, 5.15, lerp(R0, R1, 0.52), b.matRed, false],
    [5.15, towerH, lerp(R0, R1, (towerH - 5.15) / (towerH - 0)) , b.matWhitewash, false],
  ];
  // build the tower from stacked rings of boxes so the granite has courses
  const courseH = 0.58;
  for (let y = 0; y < towerH; y += courseH) {
    const y0 = y;
    const t = y / towerH;
    const r = lerp(R0, R1, t);
    const isRed = y > 4.6 && y <= 5.15;
    const mat = isRed ? b.matRed : y > 5.15 ? b.matWhitewash : b.matStone;
    const geo = new THREE.CylinderGeometry(r, r + 0.02, courseH + 0.012, seg, 1, false);
    const m = new THREE.Mesh(geo, mat);
    // a hair of wobble so the tower is not a perfect cone
    m.position.set(x + Math.sin(y * 1.7) * lean * y, yBase + courseH / 2 + y, z + Math.cos(y * 1.3) * lean * y);
    m.castShadow = true;
    m.receiveShadow = true;
    b.group.add(m);
  }

  // --- door facing the island (south)
  const doorYaw = yaw;
  const df = l2w(x, z, doorYaw, 0, R0 - 0.06);
  const doorObj = b._door(df.x, yBase, df.z, doorYaw, 1.05, 2.35, b.matPlank);
  b._frame(df.x, yBase, df.z, doorYaw, 1.05, 2.35);

  // --- tower collision: 18 thin arc boxes, skipping the door sector
  const doorAng = Math.atan2(Math.sin(doorYaw - Math.PI / 2), Math.cos(doorYaw - Math.PI / 2));
  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * Math.PI * 2;
    // angle in world space: the door sector is centred on the front
    const aRel = a - doorAng;
    let d = Math.abs(Math.atan2(Math.sin(aRel), Math.cos(aRel)));
    if (d < 0.24) continue; // the door opening
    const rr = R0 - 0.4;
    const wx = x + Math.cos(a) * rr, wz = z - Math.sin(a) * rr;
    const w = 2 * rr * Math.sin(Math.PI / 18) * 1.15;
    b._aabb(wx, wz, 0, 0, 0, w, towerH + 1, 0.7, yBase + towerH / 2, 'tower');
  }

  // --- windows: two thin slits on the upper half
  for (const wy of [6.2, 8.6]) {
    const wpos = l2w(x, z, yaw + Math.PI / 2, 0, lerp(R0, R1, wy / towerH) - 0.12);
    b._window(wpos.x, yBase + wy, wpos.z, yaw + Math.PI / 2, 0.42, 0.85, false);
  }
  // a big window facing the sea on the lantern level
  const lw = l2w(x, z, yaw, 0, lerp(R0, R1, towerH / towerH) - 0.1);
  b._window(lw.x, yBase + towerH - 1.6, lw.z, yaw, 0.62, 1.15, false);

  // --- gallery: wider deck, iron railing
  const galY = yBase + towerH + 0.28;
  const galR = R1 + 0.62;
  const deck = new THREE.Mesh(new THREE.CylinderGeometry(galR, galR, 0.36, 24), b.matStone);
  deck.position.set(x, galY, z);
  deck.castShadow = true; deck.receiveShadow = true;
  b.group.add(deck);
  // railing posts
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    const px = x + Math.cos(a) * (galR - 0.09), pz = z - Math.sin(a) * (galR - 0.09);
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.032, 0.78, 6), b.matIron);
    post.position.set(px, galY + 0.57, pz);
    b.group.add(post);
  }
  const railTop = new THREE.Mesh(new THREE.TorusGeometry(galR - 0.09, 0.045, 6, 24), b.matIron);
  railTop.rotation.x = Math.PI / 2;
  railTop.position.set(x, galY + 0.98, z);
  b.group.add(railTop);
  const railMid = new THREE.Mesh(new THREE.TorusGeometry(galR - 0.09, 0.03, 6, 24), b.matIron);
  railMid.rotation.x = Math.PI / 2;
  railMid.position.set(x, galY + 0.55, z);
  b.group.add(railMid);

  // --- lantern room: glazing + astragals + dome
  const lanBase = galY + 0.18;
  const lanH = 2.15, lanR = 1.28;
  const lanGlass = new THREE.Mesh(new THREE.CylinderGeometry(lanR, lanR, lanH, 16, 1, true), b.matGlass);
  lanGlass.position.set(x, lanBase + lanH / 2, z);
  b.group.add(lanGlass);
  // astragal bars
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, lanH, 6), b.matIron);
    bar.position.set(x + Math.cos(a) * (lanR - 0.02), lanBase + lanH / 2, z - Math.sin(a) * (lanR - 0.02));
    b.group.add(bar);
  }
  // lantern roof: shallow cone + finial ball + lightning rod
  const lanRoof = new THREE.Mesh(new THREE.ConeGeometry(lanR + 0.22, 0.9, 16), b.matIron);
  lanRoof.position.set(x, lanBase + lanH + 0.42, z);
  lanRoof.castShadow = true;
  b.group.add(lanRoof);
  const ball = new THREE.Mesh(new THREE.SphereGeometry(0.34, 12, 8), b.matIron);
  ball.position.set(x, lanBase + lanH + 0.98, z);
  b.group.add(ball);
  const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 1.5, 5), b.matIron);
  rod.position.set(x, lanBase + lanH + 1.75, z);
  b.group.add(rod);

  // --- lamp assembly inside the lantern (a Fresnel lens on a stand)
  const lampY = lanBase + 0.62;
  const lampGroup = new THREE.Group();
  lampGroup.position.set(x, lampY, z);
  b.group.add(lampGroup);
  const stand = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.22, 1.0, 10), b.matIron);
  stand.position.y = 0.5;
  lampGroup.add(stand);
  const lensMat = new THREE.MeshStandardMaterial({
    color: 0xf2ead0,
    roughness: 0.15,
    metalness: 0.1,
    emissive: 0xffc964,
    emissiveIntensity: 0.35,
  });
  const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.55, 12), lensMat);
  lens.position.y = 1.3;
  lampGroup.add(lens);
  const lensRing = new THREE.Mesh(new THREE.TorusGeometry(0.36, 0.05, 6, 12), b.matIron);
  lensRing.rotation.x = Math.PI / 2;
  lensRing.position.y = 1.3;
  lampGroup.add(lensRing);

  // --- spiral stair inside the tower: steps along the wall around a central shaft
  const steps = 42;
  const rise = towerH / steps;
  const stairR = (R0 + R1) / 2 + 0.1;
  const stepGeo = new THREE.BoxGeometry(1.05, rise * 0.92, 0.5);
  for (let i = 0; i < steps; i++) {
    const t = i / steps;
    const y = yBase + rise * (i + 0.5);
    const a = t * Math.PI * 2 * 2.35 + yaw + 0.35;   // 2.35 turns
    const r = lerp(R0, R1, t) - 0.52;
    const px = x + Math.cos(a) * r, pz = z - Math.sin(a) * r;
    const step = new THREE.Mesh(stepGeo, b.matPlank);
    step.position.set(px, y, pz);
    step.rotation.y = -a;
    step.castShadow = false;
    step.receiveShadow = true;
    b.group.add(step);
    // each step is solid and climbable by the player's step-up allowance
    b._aabb(px, pz, -a, 0, 0, 1.05, rise * 0.92, 0.5, y, 'stair');
  }
  // central shaft (keeps the player from walking off into the void)
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(R0 * 0.52, R1 * 0.52, towerH, 18, 1, false), b.matStone);
  shaft.position.set(x, yBase + towerH / 2, z);
  shaft.castShadow = false;
  shaft.receiveShadow = true;
  b.group.add(shaft);
  b._aabb(x, z, 0, 0, 0, R1 * 1.05, towerH, R1 * 1.05, yBase + towerH / 2, 'shaft');

  // --- ground-floor keeper's room furniture
  const fur1 = l2w(x, z, yaw, -1.55, 1.1);
  b._bed(fur1.x, yBase, fur1.z, yaw + Math.PI / 2);
  const fur2 = l2w(x, z, yaw, 1.45, 1.35);
  b._table(fur2.x, yBase, fur2.z, yaw);
  b._stool(fur2.x + 0.9, yBase, fur2.z + 0.3);
  const fur3 = l2w(x, z, yaw, -1.4, -1.35);
  b._barrel(fur3.x, yBase, fur3.z, 0.3);
  const fur4 = l2w(x, z, yaw, 1.6, -1.45);
  b._crate(fur4.x, yBase, fur4.z, 0.55, 0.6);
  const fur5 = l2w(x, z, yaw, 0.2, -0.6);
  b._crate(fur5.x, yBase, fur5.z, 0.42, 1.9);

  // a stove in the corner with a small flue
  const st = l2w(x, z, yaw, -2.45, -0.4);
  const stove = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.36, 0.95, 10), b.matIron);
  stove.position.set(st.x, yBase + 0.48, st.z);
  b.group.add(stove);
  const flue = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, towerH - 1.2, 8), b.matIron);
  flue.position.set(st.x, yBase + towerH / 2 + 0.4, st.z);
  b.group.add(flue);
  b._aabb(st.x, st.z, 0, 0, 0, 0.8, 1.1, 0.8, yBase + 0.55, 'stove');

  return { type: 'lighthouse', door: doorObj, x, z, lampY: yBase + lanBase + 1.3 - lampY, lens, lampGroup, radius: R1 };
}
