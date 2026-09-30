import * as THREE from 'three';
import { MOVE as M } from './MoveConfig.js';
import { clamp, damp, lerp, smoothstep, angleDiff, wrapAngle, yawFromDirection } from '../core/utils.js';

const DEG = Math.PI / 180;
const _chest = new THREE.Vector3();

/** Cheap smooth pseudo-noise in [-1, 1] (sum of incommensurate sines). */
function smoothNoise(t, seed) {
  return Math.sin(t * 1.7 + seed) * 0.5 + Math.sin(t * 2.9 + seed * 2.3) * 0.3 + Math.sin(t * 4.3 + seed * 0.7) * 0.2;
}

/**
 * First-person camera rig: writes game.camera every frame.
 * Head bob, strafe / wall-run roll, landing dip spring, FOV kicks, trauma shake, hurt flinch,
 * mantle pull-up and the death camera (falls over and looks at the killer).
 */
export class CameraRig {
  /** @param {import('./Player.js').Player} player */
  constructor(player) {
    this.player = player;
    this.game = player.game;
    this.reset();
  }

  /** Clear all transient camera state (spawn). */
  reset() {
    this.clock = 0;
    this.bobAmp = 0;
    this.strafeRoll = 0;
    this.wallRoll = 0;
    this.slideRoll = 0;
    this.fovKick = 0;
    this.fovPunch = 0;
    this.landY = 0;
    this.landV = 0;
    this.trauma = 0;
    this.hurtRoll = 0;
    this.hurtPitch = 0;
    this.eyeSlide = 0;
    this.mantleLift = 0;
    // death cam
    this.deathT = 0;
    this.deathRoll = 0;
    this.deathSign = 1;
    this.deathEye = 1.6;
    this.deathYaw = 0;
    this.deathPitch = 0;
    this.killer = null;
    this.killerPos = new THREE.Vector3();
    this.hasKiller = false;
    this._lastFov = -1;
  }

  /** Add camera trauma (0..1); shake = trauma^2. */
  addTrauma(amount) {
    this.trauma = Math.min(1, this.trauma + amount);
  }

  /** Short FOV pop (degrees) that decays quickly: air jumps, wall jumps. */
  punchFov(degrees) {
    this.fovPunch = Math.min(8, this.fovPunch + degrees);
  }

  /** Landing dip. @param {number} impact01 0..1 */
  kickLand(impact01) {
    this.landV -= impact01 * 2.6;
  }

  /** Flinch when hurt. @param {number} amount damage points @param {number} [side] -1 / 1 roll direction, 0 = random */
  kickHurt(amount, side = 0) {
    const k = clamp(amount / 40, 0.15, 1);
    const sgn = side !== 0 ? -side : (Math.random() < 0.5 ? -1 : 1);
    this.hurtRoll += sgn * 0.05 * k;
    this.hurtPitch += 0.03 * k;
    this.addTrauma(0.12 + 0.3 * k);
  }

  /** Begin the death camera. */
  startDeath(killer) {
    const P = this.player;
    this.deathT = 0;
    this.deathEye = P.eyeHeight;
    this.deathSign = Math.random() < 0.5 ? -1 : 1;
    this.deathYaw = P.yaw;
    this.deathPitch = P.pitch;
    this.killer = killer && killer !== P ? killer : null;
    this.hasKiller = !!this.killer;
    if (this.killer) this.killer.getChestPosition(this.killerPos);
    this.addTrauma(0.5);
  }

  /** Alive camera. @param {number} dt @param {number} alpha physics interpolation factor 0..1 */
  update(dt, alpha) {
    const P = this.player, cam = this.game.camera, g = this.game;
    this.clock += dt;
    const bobOn = g.settings.get('viewBob') !== false;

    // ---- interpolated eye position
    const prev = P.prevPosition, cur = P.position;
    const fx = lerp(prev.x, cur.x, alpha);
    const fy = lerp(prev.y, cur.y, alpha);
    const fz = lerp(prev.z, cur.z, alpha);

    // ---- head bob (synced with the footstep distance counter)
    const walking = P.onGround && !P.isSliding && !P.isMantling && P.speed > 0.6;
    let ampTarget = 0;
    if (walking) {
      const mode = P.isSprinting ? 1.5 : P.isCrouching ? 0.55 : 1;
      ampTarget = clamp(P.speed / M.WALK_SPEED, 0, 1.25) * mode;
    }
    this.bobAmp += (ampTarget - this.bobAmp) * damp(9, dt);
    const steps = P.stepCount;
    const bobY = bobOn ? -0.5 * (1 + Math.cos(steps * Math.PI * 2)) * 0.034 * this.bobAmp : 0;
    const bobX = bobOn ? Math.sin(steps * Math.PI) * 0.02 * this.bobAmp : 0;
    const bobRoll = bobOn ? Math.sin(steps * Math.PI) * 0.22 * DEG * this.bobAmp : 0;
    const idleY = bobOn ? Math.sin(this.clock * 1.5) * 0.0045 : 0;

    // ---- landing spring
    const k = 190, c = 15;
    this.landV += (-k * this.landY - c * this.landV) * dt;
    this.landY += this.landV * dt;
    this.landY = clamp(this.landY, -0.4, 0.15);

    // ---- roll
    const rx = Math.cos(P.yaw), rz = -Math.sin(P.yaw);
    const strafeVel = P.velocity.x * rx + P.velocity.z * rz;
    const strafeTarget = -clamp(strafeVel / M.SPRINT_SPEED, -1, 1) * 1.5 * DEG * (P.onGround ? 1 : 0.6);
    this.strafeRoll += (strafeTarget - this.strafeRoll) * damp(8, dt);
    const wallTarget = P.isWallRunning ? P.wallRunSide * M.WALLRUN_ROLL : 0;
    this.wallRoll += (wallTarget - this.wallRoll) * damp(P.isWallRunning ? 9 : 6, dt);
    const slideTarget = P.isSliding ? -clamp(strafeVel / 8, -1, 1) * 2.5 * DEG : 0;
    this.slideRoll += (slideTarget - this.slideRoll) * damp(7, dt);
    this.hurtRoll *= Math.exp(-9 * dt);
    this.hurtPitch *= Math.exp(-10 * dt);

    // ---- mantle pull-up
    const mp = P.isMantling ? P.mantleProgress : 0;
    const mantlePitch = -Math.sin(Math.PI * mp) * 0.1;
    this.mantleLift += ((P.isMantling ? Math.sin(Math.PI * mp) * 0.05 : 0) - this.mantleLift) * damp(20, dt);

    // ---- shake (rotation is scaled down when zoomed in, otherwise it is unplayable in a scope)
    const zs = clamp(P.fovMultiplier, 0.25, 1);
    this.trauma = Math.max(0, this.trauma - dt * 1.5);
    const sh = this.trauma * this.trauma;
    const st = this.clock * 22;
    const shYaw = sh * 0.012 * zs * smoothNoise(st, 1.3);
    const shPitch = sh * 0.012 * zs * smoothNoise(st, 7.1);
    const shRoll = sh * 0.04 * zs * smoothNoise(st, 3.9);
    const shX = sh * 0.05 * smoothNoise(st, 11.7);
    const shY = sh * 0.05 * smoothNoise(st, 17.3);

    // ---- position
    const eye = P.eyeHeight;
    const yawR = P.yaw;
    const cx = Math.cos(yawR), cz = -Math.sin(yawR);
    const so = P.stepOffset;
    cam.position.set(
      fx + so.x + cx * (bobX + shX),
      fy + so.y + eye + bobY + idleY + this.landY + this.mantleLift + shY,
      fz + so.z + cz * (bobX + shX),
    );

    // ---- rotation
    const pitch = clamp(P.pitch + shPitch + (this.landY * 0.35 + mantlePitch + this.hurtPitch) * zs, -1.57, 1.57);
    const yaw = P.yaw + shYaw;
    const roll = this.strafeRoll + this.wallRoll + this.slideRoll + bobRoll + shRoll + this.hurtRoll;
    cam.rotation.set(pitch, yaw, roll, 'YXZ');

    // ---- fov
    let kick = 0;
    if (P.isSprinting) kick = 5;
    if (P.isWallRunning) kick = Math.max(kick, 5);
    if (P.isSliding) kick = Math.max(kick, 8);
    if (P.isGrappling) kick = Math.max(kick, 10);
    const sp = Math.hypot(P.velocity.x, P.velocity.y, P.velocity.z);
    kick += smoothstep(9.5, 26, sp) * 8;
    kick = Math.min(kick, 16);
    this.fovKick += (kick - this.fovKick) * damp(6, dt);
    this.fovPunch *= Math.exp(-6 * dt);
    this._applyFov((g.getBaseFov() + this.fovKick + this.fovPunch) * P.fovMultiplier);
  }

  /** Death camera: falls to the floor, rolls over and turns toward the killer. */
  updateDead(dt) {
    const P = this.player, cam = this.game.camera, g = this.game;
    this.clock += dt;
    this.deathT += dt;
    const e = smoothstep(0, 0.65, this.deathT);
    const eyeH = lerp(this.deathEye, 0.34, e * e * (2 - e));
    this.deathRoll = this.deathSign * 1.05 * e;

    // look direction
    const kl = this.killer;
    if (kl) {
      if (kl.alive) kl.getChestPosition(this.killerPos);
      const dx = this.killerPos.x - P.position.x;
      const dz = this.killerPos.z - P.position.z;
      const dy = this.killerPos.y - (P.position.y + eyeH);
      const h = Math.hypot(dx, dz);
      if (h > 0.05) {
        const ty = yawFromDirection(dx, dz);
        const tp = Math.atan2(dy, h);
        const kk = damp(this.deathT > 0.12 ? 4.5 : 0.5, dt);
        this.deathYaw += angleDiff(this.deathYaw, ty) * kk;
        this.deathPitch += (tp - this.deathPitch) * kk;
      }
    } else {
      this.deathYaw += 0.12 * this.deathSign * dt;
      this.deathPitch += (-0.25 - this.deathPitch) * damp(1.5, dt);
    }
    this.deathYaw = wrapAngle(this.deathYaw);
    P.yaw = this.deathYaw; // keep entity aim in sync (respawn resets it anyway)
    P.pitch = clamp(this.deathPitch, -1.4, 1.4);

    this.trauma = Math.max(0, this.trauma - dt * 1.2);
    const sh = this.trauma * this.trauma;
    const st = this.clock * 20;
    const sway = Math.sin(this.clock * 1.3) * 0.02 * e;
    cam.position.set(
      P.position.x + sh * 0.05 * smoothNoise(st, 2.1),
      P.position.y + eyeH + sh * 0.05 * smoothNoise(st, 5.5),
      P.position.z + sway,
    );
    cam.rotation.set(
      clamp(this.deathPitch + sh * 0.02 * smoothNoise(st, 9.3), -1.5, 1.5),
      this.deathYaw + sh * 0.02 * smoothNoise(st, 4.1),
      this.deathRoll + sh * 0.05 * smoothNoise(st, 6.2),
      'YXZ',
    );
    this.fovKick += (-4 - this.fovKick) * damp(3, dt);
    this._applyFov(g.getBaseFov() + this.fovKick);
  }

  _applyFov(fov) {
    const cam = this.game.camera;
    if (Math.abs(fov - this._lastFov) > 0.005 || cam.fov !== fov) {
      cam.fov = fov;
      cam.updateProjectionMatrix();
      this._lastFov = fov;
    }
  }
}
