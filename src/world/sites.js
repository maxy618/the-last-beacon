// ---------------------------------------------------------------------------
// Where the buildings go.
//
// The lighthouse owns the headland. The farmhouse sits in a sheltered hollow
// with a view of the sea, the bothy by a burn, the chapel on high ground, the
// boat shed above the slipway, and the station on the highest summit.
// Everything is found by probing the island, so every chart of the island
// places them differently - but always sensibly.
// ---------------------------------------------------------------------------

import { Buildings } from './buildings.js';
import { buildFarmhouse, buildBothy, buildChapel, buildBoatShed, buildSignalStation } from './structures.js';
import { buildLighthouse } from './lighthouse.js';
import { clamp, smoothstep } from '../core/math.js';

/** Score a point as somewhere flat and grassy enough to build on. */
function flatGrass(island, x, z) {
  const h = island.heightAt(x, z);
  if (h < 3 || h > 46) return -1e9;
  const slope = island.macroSlopeAt(x, z);
  if (slope > 0.23) return -1e9;
  const surf = island.surfaceAt(x, z);
  const grass = surf.grass + surf.moss;
  return grass * 2.0 - slope * 4.0 + (h < 14 ? 0.5 : 0);
}

export function placeSites(island, collision, scene, atmos, rng) {
  const sites = {};

  // --- the headland
  let best = null, bestScore = -1e9;
  for (const [x, z] of island.coastRing) {
    const h = island.heightAt(x, z);
    const sd = island.seaDistAt(x, z);
    // a slight promontory: decent height, very close to the sea
    const score = h * 1.15 - Math.abs(sd - 6) * 0.8;
    if (score > bestScore) { bestScore = score; best = [x, z]; }
  }
  const lh = best || [0, 0];
  sites.lighthouse = { x: lh[0], z: lh[1], yaw: Math.atan2(-lh[0], -lh[1]) };

  // --- the farmhouse: a flat, sheltered hollow with a view of the sea
  best = null; bestScore = -1e9;
  for (let i = 0; i < 14000; i++) {
    const x = rng.range(-430, 430), z = rng.range(-430, 430);
    const d = Math.hypot(x, z);
    if (d < 40 || d > 430) continue;
    const f = flatGrass(island, x, z);
    if (f < -1e8) continue;
    // not too near the lighthouse, and with a hint of a sea view
    const dLh = Math.hypot(x - sites.lighthouse.x, z - sites.lighthouse.z);
    const score = f * 3 - Math.abs(dLh - 260) * 0.02 + rng() * 0.8;
    if (score > bestScore) { bestScore = score; best = [x, z]; }
  }
  sites.farm = best ? { x: best[0], z: best[1] } : { x: 60, z: 80 };
  sites.farm.yaw = Math.atan2(-sites.farm.x, -sites.farm.z) + Math.PI / 2;

  // --- the bothy: near the water, sheltered
  best = null; bestScore = -1e9;
  for (let i = 0; i < 9000; i++) {
    const x = rng.range(-460, 460), z = rng.range(-460, 460);
    const h = island.heightAt(x, z);
    if (h < 1.5 || h > 30) continue;
    const slope = island.macroSlopeAt(x, z);
    if (slope > 0.26) continue;
    const sd = island.seaDistAt(x, z);
    const surf = island.surfaceAt(x, z);
    const dFarm = Math.hypot(x - sites.farm.x, z - sites.farm.z);
    if (dFarm < 70) continue;
    const score = (surf.grass + surf.moss) * 2 - slope * 5 + smoothstep(3, 30, sd) * 0.8 + rng() * 0.6;
    if (score > bestScore) { bestScore = score; best = [x, z]; }
  }
  sites.bothy = best ? { x: best[0], z: best[1] } : { x: -120, z: 40 };
  sites.bothy.yaw = rng.range(0, Math.PI * 2);

  // --- the chapel: high ground
  best = null; bestScore = -1e9;
  for (let i = 0; i < 9000; i++) {
    const x = rng.range(-430, 430), z = rng.range(-430, 430);
    const h = island.heightAt(x, z);
    if (h < 14) continue;
    const slope = island.macroSlopeAt(x, z);
    if (slope > 0.3) continue;
    const dFarm = Math.hypot(x - sites.farm.x, z - sites.farm.z);
    if (dFarm < 60) continue;
    const dLh = Math.hypot(x - sites.lighthouse.x, z - sites.lighthouse.z);
    if (dLh < 50) continue;
    const score = h * 0.05 - slope * 6 + Math.min(dLh, dFarm) * 0.004 + rng() * 0.7;
    if (score > bestScore) { bestScore = score; best = [x, z]; }
  }
  sites.chapel = best ? { x: best[0], z: best[1] } : { x: 0, z: -140 };
  sites.chapel.yaw = rng.range(0, Math.PI * 2);

  // --- the boat shed: a coast point with a slipway to the sea, near the farm
  best = null; bestScore = -1e9;
  for (const [x, z] of island.coastRing) {
    const h = island.heightAt(x, z);
    if (h < -0.5 || h > 4) continue;
    const slope = island.macroSlopeAt(x, z);
    if (slope > 0.3) continue;
    const dFarm = Math.hypot(x - sites.farm.x, z - sites.farm.z);
    const score = 120 - dFarm * 0.32 - slope * 20 + island.surfaceAt(x, z).sand * 3 + rng() * 2;
    if (score > bestScore) { bestScore = score; best = [x, z]; }
  }
  sites.shed = best ? { x: best[0], z: best[1] } : { x: sites.farm.x + 30, z: sites.farm.z + 30 };
  sites.shed.yaw = Math.atan2(-sites.shed.x, -sites.shed.z) + Math.PI / 2;

  // --- the station: the highest summit
  best = null; bestScore = -1e9;
  for (let i = 0; i < 24000; i++) {
    const x = rng.range(-500, 500), z = rng.range(-500, 500);
    const h = island.heightAt(x, z);
    if (h < 20) continue;
    const slope = island.macroSlopeAt(x, z);
    if (slope > 0.35) continue;
    const dLh = Math.hypot(x - sites.lighthouse.x, z - sites.lighthouse.z);
    if (dLh < 60) continue;
    const score = h * 0.06 - slope * 4 + rng() * 0.5;
    if (score > bestScore) { bestScore = score; best = [x, z]; }
  }
  sites.station = best ? { x: best[0], z: best[1] } : { x: 120, z: -90 };
  sites.station.yaw = rng.range(0, Math.PI * 2);

  // --- build them
  const b = new Buildings(scene, island, collision, atmos, rng);
  const made = [];
  made.push(buildLighthouse(b, sites.lighthouse.x, sites.lighthouse.z, sites.lighthouse.yaw));
  made.push(buildFarmhouse(b, sites.farm.x, sites.farm.z, sites.farm.yaw));
  made.push(buildBothy(b, sites.bothy.x, sites.bothy.z, sites.bothy.yaw));
  made.push(buildChapel(b, sites.chapel.x, sites.chapel.z, sites.chapel.yaw));
  made.push(buildBoatShed(b, sites.shed.x, sites.shed.z, sites.shed.yaw));
  made.push(buildSignalStation(b, sites.station.x, sites.station.z, sites.station.yaw));

  return { sites, buildings: b, made };
}
