import * as THREE from 'three';
import { Entity } from '../core/Entity.js';
import { BASE_LOOK_SPEED } from '../core/Input.js';
import { HUMANOID } from '../core/constants.js';
import { clamp, damp, saturate, wrapAngle } from '../core/utils.js';
import { MOVE as M } from './MoveConfig.js';
import { PlayerController } from './PlayerController.js';
import { Grapple } from './Grapple.js';
import { CameraRig } from './CameraRig.js';

const PITCH_MAX = 1.5533; // 89 deg
const RECOIL_RECOVER = 0.7; // fraction of the accumulated recoil that recovers by itself
const DOWN = new THREE.Vector3(0, -1, 0);
const _o = new THREE.Vector3();

/** Footstep pitch / volume by surface type. */
const SURFACE_FEET = {
  metal: [1.12, 1.1], concrete: [1, 1], stone: [1, 1], wood: [0.94, 0.95], dirt: [0.82, 0.7],
  sand: [0.78, 0.6], grass: [0.8, 0.65], glass: [1.06, 0.9], energy: [1.15, 1],
};

const noopLoop = { setVolume() {}, setRate() {}, setPosition() {}, stop() {} };

/**
 * The local player: an Entity plus the full movement system.
 *
 * Composition: PlayerController (physics: ground / air / slide / wall-run / mantle), Grapple
 * (hook + rope) and CameraRig (bob, roll, dip, FOV, shake, death cam). This class wires input,
 * the fixed 120 Hz stepping, sounds and events together.
 */
export class Player extends Entity {
  constructor(game) {
    super(game);
    this.isPlayer = true;
    this.name = 'Player';

    // ---- state read by weapons / HUD / tests (updated every frame)
    this.speed = 0;
    this.isSprinting = false;
    this.isCrouching = false;
    this.isSliding = false;
    this.isWallRunning = false;
    /** -1: wall on the left, 1: wall on the right, 0: not wall running. */
    this.wallRunSide = 0;
    this.isGrappling = false;
    this.isMantling = false;
    /** 0..1, 1 = grapple ready. */
    this.grappleCharge = 1;
    /** Anchor of the attached grapple, or null. */
    this.grappleAnchor = null;
    /** 0..1 landing impact, decays quickly (viewmodel / HUD). */
    this.landImpact = 0;
    // ---- written by WeaponSystem every frame
    this.lookScale = 1;
    this.fovMultiplier = 1;
    // ---- extras (tests / HUD)
    this.airTime = 0;
    this.doubleJumpReady = true;
    this.mantleProgress = 0;
    /** Footstep counter (1.0 = one footstep), drives bob and footsteps. */
    this.stepCount = 0;
    /** Camera offset (m) hiding step-ups / step-downs / lookahead lurches; decays to 0. */
    this.stepOffset = new THREE.Vector3();
    /** Feet position one physics step ago (camera interpolation). */
    this.prevPosition = new THREE.Vector3();

    this.move = new PlayerController(this);
    this.grapple = new Grapple(this);
    this.rig = new CameraRig(this);

    /** Input clock (s, see Input.time) of the last spawn: presses older than this belong to the previous life. */
    this.spawnedAt = 0;

    this._acc = 0;
    this._alpha = 0;
    // aim sync (syncCameraAim): the eye base and look the camera rig last rendered with
    this._camBase = new THREE.Vector3();
    this._camYaw = 0;
    this._camPitch = 0;
    this._camSynced = false;
    this._recoil = { pendP: 0, pendY: 0, offP: 0, offY: 0, lastKick: -99 };
    this._lastStepInt = 0;
    this._foot = false;
    this._dustT = 0;
    this._wallDustT = 0;
    this._slideLoop = noopLoop;
    this._wallLoop = noopLoop;
    this._offDamage = null;
  }

  /** Create persistent visuals and subscribe to events. */
  init() {
    this.grapple.init();
    this._offDamage = this.game.events.on('damage', e => this._onDamage(e));
  }

  /** New match: clear movement / ability state (Game sets name, team and color). */
  reset() {
    this.move.reset();
    this.grapple.reset();
    this.rig.reset();
    this._stopLoops();
    this._acc = 0;
    this._alpha = 0;
    this.speed = 0;
    this.lookScale = 1;
    this.fovMultiplier = 1;
    this.landImpact = 0;
    this.stepOffset.set(0, 0, 0);
    this.stepCount = 0;
    this._lastStepInt = 0;
    const r = this._recoil;
    r.pendP = r.pendY = r.offP = r.offY = 0;
    this.isSprinting = this.isCrouching = this.isSliding = this.isWallRunning = false;
    this.isGrappling = this.isMantling = false;
    this.wallRunSide = 0;
  }

  /** (Re)spawn at a feet position facing `yaw`. */
  spawn(position, yaw = 0) {
    super.spawn(position, yaw);
    this.spawnedAt = this.game.input ? this.game.input.time : 0;
    this._camSynced = false;
    this.reset();
    this.height = HUMANOID.height;
    this.eyeHeight = HUMANOID.height - HUMANOID.eyeFromTop;
    this.move.place(this.position);
    this.prevPosition.copy(this.position);
    this.velocity.set(0, 0, 0);
  }

  // ================================================================== frame update

  /** Look, input, fixed-step physics, abilities, sounds. */
  update(dt) {
    const game = this.game, input = game.input;
    if (!this.alive) {
      input.consumeLook();
      this._updateDead(dt);
      return;
    }
    const move = this.move, inp = move.in;

    // ---- look
    const look = input.consumeLook();
    const k = BASE_LOOK_SPEED * game.settings.get('sensitivity') * this.lookScale;
    const dYaw = -look.x * k;
    const dPitch = -look.y * k * (game.settings.get('invertY') ? -1 : 1);
    this.yaw = wrapAngle(this.yaw + dYaw);
    this.pitch = clamp(this.pitch + dPitch, -PITCH_MAX, PITCH_MAX);
    this._updateRecoil(dt, dYaw, dPitch);

    if (this.shockedUntil > game.time) this._shockEffects(dt);

    // ---- input snapshot
    const f = (input.action('forward') ? 1 : 0) - (input.action('back') ? 1 : 0);
    const s = (input.action('right') ? 1 : 0) - (input.action('left') ? 1 : 0);
    inp.forwardHeld = input.action('forward');
    inp.fwd = f;
    inp.strafe = s;
    if (f !== 0 || s !== 0) {
      const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
      // forward = (-sin, -cos), right = (cos, -sin)
      const wx = -sy * f + cy * s;
      const wz = -cy * f - sy * s;
      const l = Math.hypot(wx, wz) || 1;
      inp.wishX = wx / l;
      inp.wishZ = wz / l;
      inp.wishLen = 1;
    } else {
      inp.wishX = inp.wishZ = 0;
      inp.wishLen = 0;
    }
    inp.jumpHeld = input.action('jump');
    // press edges are latched until a physics step consumes them (a frame can run zero steps); a crouch tap whose
    // press and release both landed in this frame's window is latched too (crouchFresh without crouchHeld: the
    // controller holds it for a moment, so it still starts a slide). Stale presses (input stale-press policy)
    // never show up here.
    if (input.actionPressed('jump')) {
      inp.jumpFresh = true;
      inp.jumpPressT = input.pressTime('jump');
    }
    inp.crouchHeld = input.action('crouch');
    if (input.actionPressed('crouch')) inp.crouchFresh = true;
    inp.sprintHeld = input.action('sprint');

    // ---- grapple (frame rate: input, flight, release rules)
    if (input.actionPressed('grapple')) this.grapple.toggle();
    this.grapple.update(dt);

    // ---- fixed-step physics
    this._acc += dt;
    let steps = 0;
    while (this._acc >= M.STEP && steps < M.MAX_STEPS) {
      this.prevPosition.copy(this.position);
      move.step(M.STEP);
      this._acc -= M.STEP;
      steps++;
      inp.jumpFresh = false;
      inp.crouchFresh = false;
    }
    if (this._acc >= M.STEP) this._acc = 0; // could not catch up: drop the backlog
    this._alpha = this._acc / M.STEP;

    // ---- per-frame follow-ups
    this.landImpact = Math.max(0, this.landImpact - dt * 3.5);
    this.stepOffset.multiplyScalar(Math.exp(-M.STEP_SMOOTH * dt));
    if (this.stepOffset.lengthSq() < 2.5e-7) this.stepOffset.set(0, 0, 0);
    const targetEye = this.height - HUMANOID.eyeFromTop;
    this.eyeHeight += (targetEye - this.eyeHeight) * damp(targetEye < this.eyeHeight ? M.EYE_DAMP_DOWN : M.EYE_DAMP_UP, dt);
    this._footsteps();
    this._updateLoops(dt);
  }

  /** Static-grenade shock: ~40 % slower on the ground plus a little camera jitter (WeaponSystem blocks fire / ADS). */
  _shockEffects(dt) {
    const v = this.velocity;
    if (this.onGround) {
      const sp = Math.hypot(v.x, v.z);
      const cap = 3.9;
      if (sp > cap) {
        const k = Math.max(cap / sp, 1 - 14 * dt);
        v.x *= k;
        v.z *= k;
      }
    }
    this.addRecoil((Math.random() - 0.5) * 0.007, (Math.random() - 0.5) * 0.007);
  }

  _updateDead(dt) {
    this.speed = 0;
    this.isSprinting = this.isCrouching = this.isSliding = this.isWallRunning = false;
    this.isGrappling = this.isMantling = false;
    this._acc += dt;
    let steps = 0;
    while (this._acc >= M.STEP * 2 && steps < 6) {
      this.prevPosition.copy(this.position);
      this.move.stepDead(M.STEP * 2);
      this._acc -= M.STEP * 2;
      steps++;
    }
    if (this._acc >= M.STEP * 2) this._acc = 0;
    this._alpha = this._acc / (M.STEP * 2);
    this.landImpact = Math.max(0, this.landImpact - dt * 3.5);
    this.grapple.update(dt);
  }

  /** Writes game.camera (position, rotation order YXZ, fov). Called by Game after all updates. */
  updateCamera(dt) {
    if (this.alive) {
      this.rig.update(dt, this._alpha);
      // remember what the rig built the view on, so syncCameraAim() can re-aim it next frame
      this._eyeBase(this._camBase);
      this._camYaw = this.yaw;
      this._camPitch = this.pitch;
      this._camSynced = true;
    } else {
      this.rig.updateDead(dt);
      this._camSynced = false;
    }
    this.grapple.updateVisuals(dt, this.game.camera);
  }

  /**
   * Aim sync, called by Game between player.update and weapons.update: turns game.camera to THIS frame's look
   * (yaw / pitch after this frame's mouse input and recoil) and moves it with the player, keeping the offsets the
   * camera rig showed last frame (shake, landing dip, roll, bob). A shot, grenade throw or melee made in this frame
   * then leaves along the view the crosshair shows - not along last frame's camera, which after a fast flick (or a
   * hitch) pointed somewhere else. updateCamera() still builds the full camera pose at the end of the frame.
   * Only the camera transform is written (the caller updates the matrices).
   */
  syncCameraAim() {
    if (!this.alive) return;
    const cam = this.game.camera;
    this._eyeBase(_o);
    if (this._camSynced) {
      cam.position.x += _o.x - this._camBase.x;
      cam.position.y += _o.y - this._camBase.y;
      cam.position.z += _o.z - this._camBase.z;
      const r = cam.rotation;
      r.set(clamp(r.x + (this.pitch - this._camPitch), -1.57, 1.57), r.y + wrapAngle(this.yaw - this._camYaw), r.z, 'YXZ');
    } else {
      // first frame of a life: no rig pose to keep yet (the camera still shows the death cam)
      cam.position.copy(_o);
      cam.rotation.set(clamp(this.pitch, -1.57, 1.57), this.yaw, 0, 'YXZ');
      this._camSynced = true;
    }
    this._camBase.copy(_o);
    this._camYaw = this.yaw;
    this._camPitch = this.pitch;
  }

  /** Interpolated eye point the camera rig builds on (feet lerp + step offset + eye height), without its offsets. */
  _eyeBase(out) {
    const a = this._alpha, prev = this.prevPosition, cur = this.position, so = this.stepOffset;
    return out.set(
      prev.x + (cur.x - prev.x) * a + so.x,
      prev.y + (cur.y - prev.y) * a + so.y + this.eyeHeight,
      prev.z + (cur.z - prev.z) * a + so.z,
    );
  }

  // ================================================================== recoil

  /**
   * Kick the aim (radians; pitch > 0 looks up). Part of the kick recovers automatically, the
   * rest stays - like real recoil you have to pull against.
   */
  addRecoil(pitch, yaw = 0) {
    const r = this._recoil;
    r.pendP += pitch;
    r.pendY += yaw;
    r.lastKick = this.game.time;
  }

  _updateRecoil(dt, dYaw, dPitch) {
    const r = this._recoil;
    // the player pulling against the recoil consumes the recoverable offset (no double correction)
    if (dPitch < 0 && r.offP > 0) r.offP = Math.max(0, r.offP + dPitch);
    if (dYaw < 0 && r.offY > 0) r.offY = Math.max(0, r.offY + dYaw);
    else if (dYaw > 0 && r.offY < 0) r.offY = Math.min(0, r.offY + dYaw);

    const kk = damp(55, dt);
    const dp = r.pendP * kk, dy = r.pendY * kk;
    r.pendP -= dp;
    r.pendY -= dy;
    this.pitch = clamp(this.pitch + dp, -PITCH_MAX, PITCH_MAX);
    this.yaw += dy;
    r.offP += dp;
    r.offY += dy;
    if (this.game.time - r.lastKick > 0.07) {
      const rk = damp(7.5, dt);
      const rp = r.offP * rk, ry = r.offY * rk;
      this.pitch = clamp(this.pitch - rp * RECOIL_RECOVER, -PITCH_MAX, PITCH_MAX);
      this.yaw -= ry * RECOIL_RECOVER;
      r.offP -= rp;
      r.offY -= ry;
    }
  }

  // ================================================================== public API used by other modules

  /** Camera trauma 0..1 (explosions, landing). */
  addShake(amount) {
    this.rig.addTrauma(amount);
  }

  /** Stop sprinting for a short moment (called by the weapon system when firing). */
  cancelSprint() {
    this.move.sprinting = false;
    this.move.sprintLockUntil = this.move.t + M.SPRINT_LOCK;
    this.isSprinting = false;
  }

  giveWeapon(id) { return this.game.weapons.giveWeapon(id); }
  addAmmo(id, fraction) { return this.game.weapons.addAmmo(id, fraction); }
  addGrenades(n, type = 'frag') { return this.game.weapons.addGrenades(n, type); }

  /** Jump pads: replace velocity, leave the ground, suppress ground snapping for ~0.3 s. */
  launch(v) {
    this.lastLaunchTime = this.game.time;
    this.move.launch(v);
    this.rig.addTrauma(0.12);
  }

  /** Explosion knockback: add velocity (rocket jumps keep full momentum). */
  applyImpulse(v) {
    this.move.impulse(v);
  }

  /** Death: stop loops, release the rope, start the death cam looking at the killer. */
  onDeath(info) {
    super.onDeath(info);
    this.move.onDeath();
    this.grapple.release('death');
    this.grapple.reset();
    this._stopLoops();
    this.game.audio.play('death');
    this.rig.startDeath(info ? info.attacker : null);
    if (info && info.direction) this.velocity.addScaledVector(info.direction, 2.5);
    this._acc = 0;
    this._camSynced = false;
  }

  // ================================================================== events from the controller

  _onJump(type) {
    const a = this.game.audio;
    a.play(type === 'double' ? 'double_jump' : type === 'wall' ? 'wall_jump' : 'jump');
    if (type === 'wall') { this.rig.addTrauma(0.05); this.rig.punchFov(4); }
    else if (type === 'double') this.rig.punchFov(2.5);
    else if (type === 'slide') this.rig.punchFov(1.5);
    if (type === 'double' && this.game.effects && this.game.effects.dust) this.game.effects.dust(this.position, { amount: 0.3 });
    this.game.events.emit('player:jump', { type });
  }

  _onLand(impact) {
    const i01 = saturate((impact - 3) / 20);
    this.landImpact = Math.max(this.landImpact, i01);
    const hard = impact >= M.HARD_LAND_SPEED;
    this.game.audio.play(hard ? 'land_hard' : 'land', { volume: clamp(0.4 + i01 * 0.8, 0.4, 1) });
    this.rig.kickLand(i01);
    if (hard) this.rig.addTrauma(0.1 + i01 * 0.25);
    if (impact > 6 && this.game.effects && this.game.effects.dust) this.game.effects.dust(this.position, { amount: 0.3 + i01 });
    this.game.events.emit('player:land', { speed: impact });
  }

  _onSlideStart(boosted) {
    this._slideLoop = this._loop('slide', 0.6, 1) || noopLoop;
    if (boosted) {
      this.rig.addTrauma(0.06);
      if (this.game.effects && this.game.effects.dust) this.game.effects.dust(this.position, { amount: 0.6 });
    }
  }

  _onSlideEnd() {
    this._stopLoop('_slideLoop');
  }

  _onWallRunStart() {
    this._wallLoop = this._loop('wallrun', 0.55, 1) || noopLoop;
    this.rig.addTrauma(0.05);
    this.rig.punchFov(2);
  }

  _onWallRunEnd() {
    this._stopLoop('_wallLoop');
  }

  _onMantle() {
    this.game.audio.play('mantle');
    this.rig.addTrauma(0.08);
  }

  _onMantleEnd() {
    this.rig.addTrauma(0.05);
    this.rig.kickLand(0.15);
  }

  _onDamage(e) {
    if (e.target !== this || !this.alive) return;
    this.game.audio.play('hurt', { volume: clamp(0.5 + e.amount / 60, 0.5, 1) });
    // flinch toward the direction the shot travelled (right vector = (cos yaw, -sin yaw))
    let side = 0;
    if (e.direction) side = Math.sign(e.direction.x * Math.cos(this.yaw) - e.direction.z * Math.sin(this.yaw));
    this.rig.kickHurt(e.amount, side);
  }

  // ================================================================== sounds

  _loop(name, volume, rate) {
    const a = this.game.audio;
    return a && a.playLoop ? a.playLoop(name, { volume, rate }) : null;
  }

  _stopLoop(key) {
    try { this[key].stop(); } catch { /* audio unavailable */ }
    this[key] = noopLoop;
  }

  _stopLoops() {
    this._stopLoop('_slideLoop');
    this._stopLoop('_wallLoop');
  }

  _updateLoops(dt) {
    const sp = this.speed;
    if (this.isSliding) {
      this._slideLoop.setVolume(0.25 + Math.min(1, sp / 14) * 0.5);
      this._slideLoop.setRate(0.8 + Math.min(1, sp / 16) * 0.5);
      this._dustT -= dt;
      if (this._dustT <= 0) {
        this._dustT = 0.09;
        if (this.game.effects && this.game.effects.dust) this.game.effects.dust(this.position, { amount: 0.25 });
      }
    }
    if (this.isWallRunning) {
      this._wallLoop.setVolume(0.35 + Math.min(1, sp / 13) * 0.3);
      this._wallLoop.setRate(0.85 + Math.min(1, sp / 15) * 0.4);
      this._wallDustT -= dt;
      if (this._wallDustT <= 0 && this.game.effects && this.game.effects.dust) {
        this._wallDustT = 0.11;
        const n = this.move.wallN;
        _o.set(this.position.x - n.x * 0.45, this.position.y + 0.9, this.position.z - n.z * 0.45);
        this.game.effects.dust(_o, { amount: 0.22 });
      }
    }
  }

  _footsteps() {
    const si = Math.floor(this.stepCount);
    if (si === this._lastStepInt) return;
    this._lastStepInt = si;
    if (!this.onGround || this.isSliding || this.isMantling) return;
    const base = this.isSprinting ? 0.85 : this.isCrouching ? 0.3 : 0.6;
    let rate = 1, vol = 1;
    _o.set(this.position.x, this.position.y + 0.4, this.position.z);
    const hit = this.game.world.collision.raycast(_o, DOWN, 1.2);
    if (hit) {
      const sf = SURFACE_FEET[hit.surface];
      if (sf) { rate = sf[0]; vol = sf[1]; }
    }
    this._foot = !this._foot;
    this.game.audio.play('footstep', {
      volume: base * vol,
      rate: rate * (0.96 + Math.random() * 0.06) * (this._foot ? 1.02 : 0.98),
    });
  }
}
