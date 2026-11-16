// ---------------------------------------------------------------------------
// The player: movement, camera, stamina, footsteps.
//
// First person, with a capsule that slides along walls, climbs steps, crouches
// under low openings and wades through shallow water.
// ---------------------------------------------------------------------------

import * as THREE from 'three';
import { clamp, clamp01, damp, lerp, smoothstep } from '../core/math.js';

const EYE_STAND = 1.68;
const EYE_CROUCH = 1.02;
const RADIUS = 0.33;
const BODY_H = 1.78;
const CROUCH_H = 1.15;

export class Player {
  constructor(island, collision, camera) {
    this.island = island;
    this.collision = collision;
    this.camera = camera;

    this.pos = new THREE.Vector3(0, 0, 0);
    this.vel = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = 0;
    this.grounded = true;
    this.crouching = false;
    this.eyeHeight = EYE_STAND;
    this.bob = 0;
    this.bobPhase = 0;
    this.stepAccum = 0;
    this.speed = 0;
    this.stamina = 1;
    this.exhausted = false;
    this.landImpact = 0;
    this.waterDepth = 0;
    this.inWater = false;
    this.headTilt = 0;
    this.lastGroundY = 0;
    this.frozen = false;
    this.fovBase = 68;
    this.fov = 68;
    this.sprintFov = 0;
  }

  teleport(x, y, z) {
    this.pos.set(x, y, z);
    this.vel.set(0, 0, 0);
    this.grounded = true;
  }

  look(dx, dy, sensitivity, invertY) {
    if (this.frozen) return;
    this.yaw -= dx * sensitivity;
    this.pitch -= (invertY ? -dy : dy) * sensitivity;
    this.pitch = clamp(this.pitch, -1.52, 1.52);
    if (this.yaw > Math.PI) this.yaw -= Math.PI * 2;
    if (this.yaw < -Math.PI) this.yaw += Math.PI * 2;
  }

  update(dt, input, opts = {}) {
    const wantsCrouch = input.down('KeyC') || input.down('ControlLeft');
    this.crouching = wantsCrouch;

    // ---- desired horizontal movement
    const fwd = (input.down('KeyW') ? 1 : 0) - (input.down('KeyS') ? 1 : 0);
    const str = (input.down('KeyD') ? 1 : 0) - (input.down('KeyA') ? 1 : 0);
    const sprint = input.down('ShiftLeft') || input.down('ShiftRight');
    const jump = input.hit('Space');

    const targetHeight = this.crouching ? CROUCH_H : BODY_H;
    // do not stand up into a ceiling
    if (!this.crouching && this.eyeHeight < EYE_STAND) {
      const r = this.collision.resolve(this.pos.x, this.pos.y, this.pos.z, RADIUS, BODY_H, 0.05);
      if (r.hit) { /* keep crouched */ } else this.crouching = false;
    }

    let speed = this.crouching ? 1.75 : (sprint && !this.exhausted ? 5.9 : 3.25);
    if (this.inWater) speed *= 0.62;
    if (this.stamina <= 0) { this.exhausted = true; speed = Math.min(speed, 2.1); }
    if (sprint && fwd > 0 && !this.crouching) this.stamina = clamp01(this.stamina - dt * 0.19);
    else this.stamina = clamp01(this.stamina + dt * (this.exhausted ? 0.16 : 0.1));
    if (this.stamina > 0.28) this.exhausted = false;

    const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
    let wishX = (-sy * fwd + cy * str);
    let wishZ = (-cy * fwd - sy * str);
    const wl = Math.hypot(wishX, wishZ);
    if (wl > 1e-4) { wishX /= wl; wishZ /= wl; }

    const accel = this.grounded ? 46 : 9;
    const targetVx = wishX * speed * wl;
    const targetVz = wishZ * speed * wl;
    this.vel.x = damp(this.vel.x, targetVx, accel, dt);
    this.vel.z = damp(this.vel.z, targetVz, accel, dt);

    // ---- vertical
    if (jump && this.grounded && !this.crouching) {
      this.vel.y = 4.35;
      this.grounded = false;
    }
    this.vel.y -= 19.5 * dt;
    if (this.inWater) this.vel.y = Math.max(this.vel.y, -2.4);
    if (this.vel.y < -55) this.vel.y = -55;

    // ---- integrate with substeps so we cannot tunnel through thin walls
    const moveLen = Math.hypot(this.vel.x * dt, this.vel.y * dt, this.vel.z * dt);
    const steps = Math.max(1, Math.ceil(moveLen / 0.22));
    const sdt = dt / steps;
    let grounded = false;
    let groundY = -Infinity;
    for (let s = 0; s < steps; s++) {
      this.pos.x += this.vel.x * sdt;
      this.pos.y += this.vel.y * sdt;
      this.pos.z += this.vel.z * sdt;

      const r = this.collision.resolve(this.pos.x, this.pos.y, this.pos.z, RADIUS, targetHeight, 0.44);
      this.pos.x = r.x; this.pos.z = r.z;
      if (r.hit) {
        // kill the velocity component into the wall
        const b = r.hitBox;
        if (b) {
          const nx = b.x1 + RADIUS <= this.pos.x ? -1 : b.x0 - RADIUS >= this.pos.x ? 1 : 0;
          const nz = b.z1 + RADIUS <= this.pos.z ? -1 : b.z0 - RADIUS >= this.pos.z ? 1 : 0;
          if (nx) this.vel.x = 0;
          if (nz) this.vel.z = 0;
          if (!nx && !nz) { this.vel.x *= 0.2; this.vel.z *= 0.2; }
        }
      }

      // ---- ground
      const gy = this.collision.supportHeight(this.pos.x, this.pos.z, RADIUS * 0.85, this.pos.y + 0.5);
      groundY = Math.max(groundY, gy);
      if (gy > -1e8 && this.pos.y <= gy + 0.06) {
        if (!this.grounded && this.vel.y < -3) this.landImpact = Math.min(1, -this.vel.y / 12);
        this.pos.y = gy;
        this.vel.y = 0;
        grounded = true;
      } else {
        grounded = false;
      }
    }

    this.grounded = grounded;
    this.lastGroundY = groundY;

    // ---- steep terrain blocks the player
    if (grounded && this.island) {
      const n = this.island.normalAt(this.pos.x, this.pos.z, 0.9);
      if (n[1] < 0.62) {
        // push back down the slope
        const len = Math.hypot(n[0], n[2]) || 1;
        const push = (1 - n[1]) * 26 * dt;
        this.vel.x -= (n[0] / len) * push;
        this.vel.z -= (n[2] / len) * push;
      }
    }

    // ---- water
    const groundH = this.island ? this.island.heightAt(this.pos.x, this.pos.z) : 0;
    this.waterDepth = Math.max(0, -groundH);
    this.inWater = this.waterDepth > 0.12 && this.pos.y < 0.25;
    if (this.inWater) {
      // buoyancy and drag
      this.vel.y += (0.25 - this.pos.y) * 6 * dt;
      this.vel.y *= 1 - Math.min(0.9, dt * 3.2);
      this.vel.x *= 1 - Math.min(0.9, dt * 2.0);
      this.vel.z *= 1 - Math.min(0.9, dt * 2.0);
    }

    // ---- camera
    this.speed = Math.hypot(this.vel.x, this.vel.z);
    const wantEye = this.crouching ? EYE_CROUCH : EYE_STAND;
    this.eyeHeight = damp(this.eyeHeight, wantEye, 11, dt);

    const moving = this.speed > 0.5 && this.grounded;
    this.bobPhase += dt * this.speed * 1.65;
    const bobAmp = moving ? Math.min(0.055, this.speed * 0.011) : 0;
    this.bob = damp(this.bob, bobAmp, 9, dt);
    const bobY = Math.sin(this.bobPhase * 2) * this.bob;
    const bobX = Math.sin(this.bobPhase) * this.bob * 1.1;
    const roll = Math.sin(this.bobPhase) * this.bob * 0.55 + (this.crouching ? 0 : 0);

    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    this.camera.position.set(
      this.pos.x + right.x * bobX,
      this.pos.y + this.eyeHeight + bobY,
      this.pos.z + right.z * bobX
    );
    this.camera.rotation.set(0, 0, 0);
    this.camera.rotateY(this.yaw);
    this.camera.rotateX(this.pitch);
    this.camera.rotateZ(roll);

    // ---- footsteps
    this.stepAccum += this.speed * dt;
    const stride = this.crouching ? 1.35 : sprint ? 2.05 : 1.6;
    let stepped = false;
    if (this.grounded && this.stepAccum > stride) { this.stepAccum = 0; stepped = true; }

    // ---- fov kick
    const wantFov = this.fovBase + (sprint && moving ? 5.5 : 0) + (this.inWater ? -3 : 0);
    this.fov = damp(this.fov, wantFov, 7, dt);
    if (Math.abs(this.camera.fov - this.fov) > 0.01) {
      this.camera.fov = this.fov;
      this.camera.updateProjectionMatrix();
    }

    return { stepped, landing: this.landImpact };
  }
}

export const PLAYER_CONST = { RADIUS, BODY_H, CROUCH_H, EYE_STAND, EYE_CROUCH };
