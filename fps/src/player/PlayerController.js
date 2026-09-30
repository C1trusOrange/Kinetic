import * as THREE from 'three';
import { Capsule } from 'three/addons/math/Capsule.js';
import { HUMANOID } from '../core/constants.js';
import { clamp, lerp, approach, smoothstep, saturate } from '../core/utils.js';
import { MOVE as M } from './MoveConfig.js';

const R = HUMANOID.radius;
const STAND_H = HUMANOID.height;
const CROUCH_H = HUMANOID.crouchHeight;
const DOWN = new THREE.Vector3(0, -1, 0);

const WALLRUN_ANGLES = [Math.PI / 2, -Math.PI / 2, 0.87, -0.87];
const WALLJUMP_ANGLES = [0, Math.PI / 2, -Math.PI / 2, 0.8, -0.8, Math.PI];

const _wish = new THREE.Vector3();
const _pre = new THREE.Vector3();
const _sv = new THREE.Vector3();
const _v1 = new THREE.Vector3();
const _origin = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _chest = new THREE.Vector3();

/** Safety net cadence: the capsule-inside-a-solid check runs every NET_EVERY-th physics step (120 Hz / 2 = 60 Hz). */
const NET_EVERY = 2;
/** Heights above the ledge top at which the mantle path (player column -> landing spot) must be free. */
const MANTLE_CLEAR_H = [0.1, 0.5, 0.9, 1.3, 1.7];

const easeOutQuad = t => 1 - (1 - t) * (1 - t);
const easeInOutQuad = t => (t < 0.5 ? 2 * t * t : 1 - 2 * (1 - t) * (1 - t));

/**
 * Movement physics for the player: everything that moves the capsule.
 * Runs in fixed 120 Hz steps (see Player.update). Modes: ground, air, wall-run, mantle; slide is a
 * ground sub-state, the grapple applies forces during air steps.
 *
 * The controller owns the capsule. After every step it writes position / velocity / state flags
 * back to the Player entity.
 */
export class PlayerController {
  /** @param {import('./Player.js').Player} player */
  constructor(player) {
    this.p = player;
    this.game = player.game;
    this.capsule = new Capsule(new THREE.Vector3(), new THREE.Vector3(), R);
    this._capA = new Capsule(new THREE.Vector3(), new THREE.Vector3(), R);
    this.opts = { groundMinY: M.GROUND_MIN_Y };
    this.groundNormal = new THREE.Vector3(0, 1, 0);
    this.wallN = new THREE.Vector3();
    this.lastWallN = new THREE.Vector3();
    this.lockN = new THREE.Vector3();
    this.mantleFrom = new THREE.Vector3();
    this.mantleTo = new THREE.Vector3();
    this.mantleDir = new THREE.Vector3();
    this._stepNormal = new THREE.Vector3(0, 1, 0);
    this._scan = { found: false, nx: 0, nz: 0, dist: 0, side: 0, d: 0, dotV: 0 };
    // ---- safety net (see _safetyNet): last capsule position known to be outside every solid
    this._safe = new THREE.Vector3();
    this._safeValid = false;
    this._safeCrouched = false;
    this._netTick = 0;
    this._netForce = false;
    /** Master switch for the safety net (tests measure its cost with it off). */
    this.netEnabled = true;
    /** How many times the safety net had to move the player out of a solid (must stay 0 in normal play). */
    this.rescueCount = 0;
    /** The last few rescues: {t, reason, from:[x,y,z], to:[x,y,z]} (debugging / tests). */
    this.rescueLog = [];
    /** Per-frame input snapshot, filled by Player.update. */
    this.in = {
      wishX: 0, wishZ: 0, wishLen: 0, fwd: 0, strafe: 0,
      forwardHeld: false, jumpHeld: false, jumpFresh: false,
      crouchHeld: false, crouchFresh: false, sprintHeld: false,
    };
    this.reset();
  }

  /** Clear all movement state. */
  reset() {
    this.t = 0;
    this.grounded = false;
    this.airTime = 0;
    this.coyote = 0;
    this.jumpBuffer = 0;
    this.airJumps = 1;
    this.wallJumps = 0;
    this.wallRunsThisAir = 0;
    this.refreshUsed = false;
    this.snapBlockUntil = 0;
    this.landSuppressUntil = 0;
    this.crouched = false;
    this.sliding = false;
    this.slideTime = 0;
    this.lastSlideBoost = -99;
    this.crouchPressedAt = -99;
    this.lastLandT = -99;
    this.sprinting = false;
    this.sprintIntent = false;
    this._crouchWas = false;
    this.sprintLockUntil = 0;
    this.wallRunning = false;
    this.wallRunTime = 0;
    this.wallLost = 0;
    this.noFwd = 0;
    this.awayT = 0;
    this.runSign = 1;
    this.lockUntil = 0;
    this.lockD = 0;
    this.wallCoyote = 0;
    this.wallSide = 0;
    this.wallPlaneD = 0;
    this.scanTick = 0;
    this.mantling = false;
    this.mantleT = 0;
    this.mantleDur = M.MANTLE_TIME;
    this.mantleCooldown = 0;
    /** Why the last _tryMantle refused (debugging). */
    this.mantleWhy = '';
    this.mantleHeight = 0;
    this.stepCount = 0;
    this.in.jumpFresh = false;
    this.in.crouchFresh = false;
    this._safeValid = false;
    this._publishStats();
  }

  /** Test harness hook: mirror the safety-net counter into the autotest report (report.custom.rescues). */
  _publishStats() {
    const at = this.game && this.game.autotest;
    if (at && at.report) (at.report.custom || (at.report.custom = {})).rescues = this.rescueCount;
  }

  /** Human readable movement state (tests / debugging). */
  get state() {
    if (this.mantling) return 'mantle';
    if (this.wallRunning) return 'wallrun';
    if (this.p.grapple.attached) return 'grapple';
    if (this.sliding) return 'slide';
    return this.grounded ? 'ground' : 'air';
  }

  // ================================================================== placement

  /** Put the capsule at a feet position (spawn / teleport), standing, settled on the ground. */
  place(pos) {
    const c = this.capsule;
    this.crouched = false;
    c.start.set(pos.x, pos.y + R, pos.z);
    c.end.set(pos.x, pos.y + STAND_H - R, pos.z);
    this.p.height = STAND_H;
    this.grounded = false;
    const coll = this.game.world.collision;
    // a spawn overlapping / sitting on a wall face is pushed out by the normal collision (only a capsule that is still
    // buried afterwards is lifted out below)
    coll.resolveCapsule(c);
    const probe = coll.probeGround(c, 2.5, M.GROUND_MIN_Y);
    if (probe && probe.distance <= M.SNAP_DIST) {
      _v1.set(0, -probe.distance, 0);
      c.translate(_v1);
      this.groundNormal.copy(probe.normal);
      this.grounded = true;
    } else {
      this.groundNormal.set(0, 1, 0);
    }
    this.landSuppressUntil = this.t + 0.4;
    // a spawn / teleport inside a solid: lift the capsule out (the map validator reports such spawns)
    if (coll.capsuleInside(c)) {
      if (this._liftOut()) this.grounded = false;
      else console.warn('[player] spawn is buried in solid geometry and could not be lifted out');
    }
    this._safe.copy(c.start);
    this._safeValid = !coll.capsuleInside(c);
    this._safeCrouched = false;
    this._sync();
  }

  /** Kinematic corpse physics after death (gravity, friction, collisions). */
  stepDead(dt) {
    const P = this.p, v = P.velocity, c = this.capsule;
    const coll = this.game.world.collision;
    if (this.crouched === false) { this.crouched = true; this._setHeight(CROUCH_H); }
    v.y = Math.max(v.y - M.GRAVITY * dt, -M.TERMINAL);
    const res = coll.moveCapsule(c, v, dt, this.opts);
    if (res.onGround) {
      const k = Math.exp(-7 * dt);
      v.x *= k;
      v.z *= k;
    }
    this._sync();
  }

  /** Grapple attached: refresh the airtime budgets. */
  onGrappleAttach() {
    this.resetAirBudget();
  }

  /** Called when the player dies. */
  onDeath() {
    this._endSlide();
    if (this.wallRunning) this._endWallRun('death');
    this.mantling = false;
    this.p.isMantling = false;
    this.sprinting = false;
  }

  /** Jump pads: replace velocity, leave the ground, suppress ground snapping. */
  launch(v) {
    const P = this.p;
    P.velocity.copy(v);
    this.grounded = false;
    this.coyote = 0;
    this.snapBlockUntil = this.t + 0.3;
    this.resetAirBudget();
    this.airTime = 0;
    this._endSlide();
    if (this.wallRunning) this._endWallRun('launch');
    if (this.mantling) { this.mantling = false; P.isMantling = false; }
    P.onGround = false;
  }

  /** Knockback (explosions): add velocity and leave the ground when pushed upward. */
  impulse(v) {
    const P = this.p;
    P.velocity.add(v);
    if (this.grounded && (v.y > 1.2 || v.lengthSq() > 25)) {
      this.grounded = false;
      this.coyote = 0;
      this.snapBlockUntil = this.t + 0.25;
      this.airTime = 0;
      P.onGround = false;
    }
    if (v.y > 1.2 && this.wallRunning) this._endWallRun('knockback');
  }

  // ================================================================== main step

  /** Advance the simulation by one fixed step. */
  step(dt) {
    const P = this.p, inp = this.in;
    this.t += dt;
    this.mantleCooldown -= dt;
    if (inp.jumpFresh) this.jumpBuffer = M.JUMP_BUFFER;
    else if (this.jumpBuffer > 0) this.jumpBuffer = Math.max(0, this.jumpBuffer - dt);
    // crouch press: the input edge, or the held state turning on (virtual / latched inputs can lag an edge)
    if (inp.crouchFresh || (inp.crouchHeld && !this._crouchWas)) this.crouchPressedAt = this.t;
    this._crouchWas = inp.crouchHeld;
    this.coyote = this.grounded ? M.COYOTE : Math.max(0, this.coyote - dt);
    if (this.wallCoyote > 0) this.wallCoyote = Math.max(0, this.wallCoyote - dt);

    if (this.mantling) {
      this._stepMantle(dt);
      this._finish(dt);
      return;
    }

    this._updateCrouch();
    this._updateSlide(dt);
    this._updateSprint();
    this._handleJump();

    if (this.mantling) {
      this._finish(dt);
      return;
    }
    if (this.wallRunning) this._wallRunStep(dt);
    else if (this.grounded && !P.grapple.attached) this._groundStep(dt);
    else this._airStep(dt);
    this._finish(dt);
  }

  /** Copy state to the player entity and advance the footstep counter. */
  _finish(dt) {
    const P = this.p, v = P.velocity;
    if (this.netEnabled) this._safetyNet();
    this._sync();
    P.speed = Math.hypot(v.x, v.z);
    P.isSprinting = this.sprinting;
    P.isCrouching = this.crouched;
    P.isSliding = this.sliding;
    P.isWallRunning = this.wallRunning;
    P.wallRunSide = this.wallRunning ? this.wallSide : 0;
    P.isMantling = this.mantling;
    P.mantleProgress = this.mantling ? clamp(this.mantleT / this.mantleDur, 0, 1) : 0;
    if (this.grounded && !this.sliding && !this.mantling) {
      const stride = this.sprinting ? 2.25 : this.crouched ? 1.15 : 1.75;
      this.stepCount += P.speed * dt / stride;
    }
    P.stepCount = this.stepCount;
    P.airTime = this.airTime;
    P.doubleJumpReady = this.airJumps > 0;
  }

  _sync() {
    const P = this.p, c = this.capsule;
    P.position.set(c.start.x, c.start.y - R, c.start.z);
    P.height = c.end.y - c.start.y + 2 * R;
    P.onGround = this.grounded;
  }

  // ================================================================== safety net

  /**
   * Last line of defence against clipping into geometry. Collision only pushes a capsule out when a sphere centre
   * is in FRONT of a face plane, so a capsule that ends up fully inside a closed solid (a mantle onto a hidden
   * layer seam, a step-up, a bad teleport) is invisible to resolveCapsule and the player can walk straight
   * through the walls. Every NET_EVERY-th step the two sphere centres are classified with
   * CollisionWorld.capsuleInside(); the position is remembered while the capsule is clear and restored when it
   * is not. It must never fire in normal play: rescueCount / rescueLog record every use.
   */
  _safetyNet() {
    const coll = this.game.world.collision, c = this.capsule;
    if (!coll.built) return;
    this._netTick = (this._netTick + 1) % NET_EVERY;
    if (this._netTick !== 0 && !this._netForce) return;
    this._netForce = false;
    if (coll.capsuleInside(c)) {
      this._rescue('inside solid');
    } else {
      this._safe.copy(c.start);
      this._safeCrouched = this.crouched;
      this._safeValid = true;
    }
  }

  /** Put the capsule back at the last known clear position and remove the velocity that carried it in. */
  _rescue(reason) {
    const P = this.p, c = this.capsule, v = P.velocity, coll = this.game.world.collision;
    this.rescueCount++;
    const from = [c.start.x, c.start.y - R, c.start.z].map(n => +n.toFixed(2));
    if (this._safeValid) {
      // drop the velocity component that points from the safe position into the solid
      _v1.set(c.start.x - this._safe.x, c.start.y - this._safe.y, c.start.z - this._safe.z);
      const l = _v1.length();
      if (l > 1e-4) {
        _v1.multiplyScalar(1 / l);
        const vn = v.dot(_v1);
        if (vn > 0) v.addScaledVector(_v1, -vn);
      }
      this.crouched = this._safeCrouched;
      c.start.copy(this._safe);
      c.end.set(c.start.x, c.start.y + (this.crouched ? CROUCH_H : STAND_H) - 2 * R, c.start.z);
    } else if (!this._liftOut()) {
      console.warn('[player] safety net: capsule is buried in solid geometry and no clear position is known');
    }
    if (this.mantling) {
      this.mantling = false;
      P.isMantling = false;
      this.mantleCooldown = 1.5;     // do not immediately repeat whatever moved us in
    }
    if (this.wallRunning) this._endWallRun('rescue');
    if (P.grapple.attached) P.grapple.release('rescue');
    this.grounded = false;
    this.airTime = 0;
    this.snapBlockUntil = this.t + 0.05;
    this._safe.copy(c.start);
    this._safeValid = !coll.capsuleInside(c);
    this._safeCrouched = this.crouched;
    const to = [c.start.x, c.start.y - R, c.start.z].map(n => +n.toFixed(2));
    this.rescueLog.push({ t: +this.t.toFixed(3), reason, from, to });
    if (this.rescueLog.length > 8) this.rescueLog.shift();
    if (this.rescueCount <= 5) {
      console.warn(`[player] safety net #${this.rescueCount}: ${reason} at [${from}] -> restored to [${to}]`);
    }
    P.prevPosition.set(c.start.x, c.start.y - R, c.start.z);
    P.stepOffset.set(0, 0, 0);
    this._publishStats();
  }

  /** Raise the capsule in 25 cm steps until it is out of every solid (spawns / teleports inside geometry). */
  _liftOut() {
    const c = this.capsule, coll = this.game.world.collision;
    for (let k = 0; k < 48; k++) {
      c.start.y += 0.25;
      c.end.y += 0.25;
      if (!coll.capsuleInside(c)) {
        coll.resolveCapsule(c);
        if (!coll.capsuleInside(c)) return true;
      }
    }
    return false;
  }

  _setHeight(h) {
    const c = this.capsule;
    c.end.set(c.start.x, c.start.y + h - 2 * R, c.start.z);
    this.p.height = h;
  }

  // ================================================================== state updates

  _updateCrouch() {
    const want = this.in.crouchHeld || this.sliding;
    if (want && !this.crouched) {
      this.crouched = true;
      this._setHeight(CROUCH_H);
    } else if (!want && this.crouched && this._canStand()) {
      this.crouched = false;
      this._setHeight(STAND_H);
    }
  }

  /** True when a standing capsule fits at the current feet position. */
  _canStand() {
    const c = this._capA, cur = this.capsule, coll = this.game.world.collision;
    c.start.copy(cur.start);
    c.end.set(cur.start.x, cur.start.y + STAND_H - 2 * R, cur.start.z);
    // the raised head sphere buried in a (thin) ceiling slab gets no push-out either: test it explicitly
    if (coll.isInsideXYZ(c.end.x, c.end.y, c.end.z, 3)) return false;
    _v1.copy(c.start);
    coll.resolveCapsule(c);
    return c.start.distanceToSquared(_v1) < 0.03 * 0.03;
  }

  /**
   * True when a standing capsule with its feet at (x, y, z) fits: nothing pushes it, and it is not buried in
   * a solid (resolveCapsule ignores a capsule whose sphere centres are behind a face plane, so a landing spot
   * inside a wall or in the hidden layer between two stacked solids would read "clear").
   */
  _capsuleClear(x, y, z) {
    const c = this._capA, coll = this.game.world.collision;
    c.start.set(x, y + R + 0.02, z);
    c.end.set(x, y + STAND_H - R + 0.02, z);
    if (coll.capsuleInside(c) || coll.isInsideXYZ(x, y + STAND_H * 0.5 + 0.02, z, 3)) return false;
    _v1.copy(c.start);
    coll.resolveCapsule(c);
    return c.start.distanceToSquared(_v1) < 0.035 * 0.035;
  }

  /** True when a front face lies on the straight segment A -> B (allocation free clearance ray). */
  _segBlocked(ax, ay, az, bx, by, bz) {
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-4) return false;
    const k = 1 / len;
    return this.game.world.collision.rayBlocked(ax, ay, az, dx * k, dy * k, dz * k, len - 0.005);
  }

  _updateSlide(dt) {
    const inp = this.in, v = this.p.velocity;
    const hs = Math.hypot(v.x, v.z);
    if (this.sliding) {
      this.slideTime += dt;
      if (!this.grounded) this._endSlide();
      else if (!inp.crouchHeld) this._endSlide();
      else if (hs < M.SLIDE_END_SPEED && this.slideTime > 0.12) this._endSlide();
    } else if (this.grounded && inp.crouchHeld && hs >= M.SLIDE_MIN_START && !this.wallRunning && !this.p.grapple.attached) {
      const pressed = this.t - this.crouchPressedAt <= M.SLIDE_PRESS_WINDOW;
      const landed = this.t - this.lastLandT <= 0.12;
      if (pressed || landed) this._startSlide(hs);
    }
  }

  _startSlide(hs) {
    const v = this.p.velocity;
    this.sliding = true;
    this.slideTime = 0;
    this.sprinting = false;
    let boosted = false;
    if (this.t - this.lastSlideBoost >= M.SLIDE_BOOST_COOLDOWN) {
      if (hs < M.SLIDE_BOOST_CAP && hs > 0.01) {
        const k = Math.min(M.SLIDE_BOOST_CAP, hs + M.SLIDE_BOOST) / hs;
        v.x *= k;
        v.z *= k;
        boosted = true;
      }
      this.lastSlideBoost = this.t;
    }
    if (!this.crouched) { this.crouched = true; this._setHeight(CROUCH_H); }
    this.p._onSlideStart(boosted);
  }

  _endSlide() {
    if (!this.sliding) return;
    this.sliding = false;
    this.p.isSliding = false;
    this.p._onSlideEnd();
  }

  _updateSprint() {
    const inp = this.in, P = this.p, v = P.velocity;
    const ads = this.game.weapons ? (this.game.weapons.adsAmount || 0) : 0;
    const want = inp.sprintHeld && inp.forwardHeld && !this.crouched && !this.sliding
      && this.t >= this.sprintLockUntil && ads < 0.4 && !this.wallRunning && !this.mantling;
    const hs = Math.hypot(v.x, v.z);
    this.sprintIntent = want;
    if (this.grounded) this.sprinting = want && (hs > 3 || (this.sprinting && hs > 1.5));
    else this.sprinting = this.sprinting && want;
  }

  // ================================================================== jumping

  /** Wall interactions refresh the double jump, but only once per airtime (no infinite climbing). */
  _refreshAirJump() {
    if (this.airJumps === 0 && !this.refreshUsed) {
      this.airJumps = 1;
      this.refreshUsed = true;
    }
  }

  /** Landing, mantling and grappling reset every airtime budget. */
  resetAirBudget() {
    this.airJumps = 1;
    this.wallJumps = 0;
    this.wallRunsThisAir = 0;
    this.refreshUsed = false;
  }

  _handleJump() {
    if (this.jumpBuffer <= 0) return;
    const P = this.p, inp = this.in, gr = P.grapple;

    if (gr.attached) {
      gr.release('jump');
      if (this.grounded || this.coyote > 0) {
        this._groundJump();
      } else {
        P.velocity.y += M.GRAPPLE_JUMP_BOOST;
        this.airJumps = 1;
        this.jumpBuffer = 0;
        P._onJump('double');
      }
      return;
    }
    if (this.wallRunning) {
      this._wallJump(this.wallN, this.wallPlaneD);
      return;
    }
    if (this.grounded || this.coyote > 0) {
      if (this.grounded && inp.forwardHeld && this.mantleCooldown <= 0 && this._tryMantle(true)) {
        this.jumpBuffer = 0;
        return;
      }
      this._groundJump();
      return;
    }
    // airborne
    if (this.wallCoyote > 0 && this.wallJumps < M.WALLJUMP_MAX_PER_AIR) {
      this._wallJump(this.lastWallN, this.lockD);
      return;
    }
    if (inp.jumpFresh) {
      if (this._groundClose()) return; // stays buffered: becomes a ground jump on landing
      if (this.wallJumps < M.WALLJUMP_MAX_PER_AIR
          && this._scanWalls(this._scan, R + 0.4, WALLJUMP_ANGLES, false) && !this._isLocked(this._scan)) {
        _v1.set(this._scan.nx, 0, this._scan.nz);
        this._wallJump(_v1, this._scan.d);
        return;
      }
      if (this.airJumps > 0) this._doubleJump();
    }
  }

  /** True when a scanned wall is the one we just left (re-run / re-jump lock). */
  _isLocked(s) {
    return this.t < this.lockUntil && s.nx * this.lockN.x + s.nz * this.lockN.z > 0.9
      && Math.abs(s.d - this.lockD) < 0.7;
  }

  /** True when the ground is very close below while falling (a jump press then buffers a ground jump). */
  _groundClose() {
    if (this.p.velocity.y > 0.5) return false;
    return !!this.game.world.collision.probeGround(this.capsule, 0.55, M.GROUND_MIN_Y);
  }

  _groundJump() {
    const P = this.p, v = P.velocity;
    const wasSliding = this.sliding;
    v.y = M.JUMP_SPEED + Math.max(0, v.y) * 0.5;
    this.grounded = false;
    this.coyote = 0;
    this.jumpBuffer = 0;
    this.snapBlockUntil = this.t + 0.12;
    this.resetAirBudget();
    this.airTime = 0;
    if (wasSliding) this._endSlide();
    P.onGround = false;
    P._onJump(wasSliding ? 'slide' : 'ground');
  }

  _doubleJump() {
    const P = this.p, v = P.velocity, inp = this.in;
    this.airJumps--;
    this.jumpBuffer = 0;
    v.y = Math.max(M.DOUBLE_JUMP_SPEED, v.y);
    if (inp.wishLen > 0) {
      const hs = Math.hypot(v.x, v.z);
      let dx = hs > 0.3 ? v.x / hs : inp.wishX;
      let dz = hs > 0.3 ? v.z / hs : inp.wishZ;
      dx = lerp(dx, inp.wishX, M.DOUBLE_JUMP_REDIRECT);
      dz = lerp(dz, inp.wishZ, M.DOUBLE_JUMP_REDIRECT);
      const l = Math.hypot(dx, dz) || 1;
      const sp = Math.max(hs, 4.2);
      v.x = dx / l * sp;
      v.z = dz / l * sp;
    }
    P._onJump('double');
  }

  /**
   * Wall jump away from a wall with horizontal unit normal `n` (pointing away from the wall);
   * `planeD` identifies the wall plane for the same-wall lock.
   */
  _wallJump(n, planeD) {
    const P = this.p, v = P.velocity;
    const nx = n.x, nz = n.z;
    const tx = nz, tz = -nx;
    const vt = v.x * tx + v.z * tz;
    v.x = tx * vt + nx * M.WALLJUMP_NORMAL;
    v.z = tz * vt + nz * M.WALLJUMP_NORMAL;
    const k = Math.max(0.55, 1 - 0.12 * this.wallJumps);
    v.y = Math.max(v.y, 0) * 0.2 + M.WALLJUMP_UP * k;
    this.wallJumps++;
    this._refreshAirJump();
    this.jumpBuffer = 0;
    this.wallCoyote = 0;
    // remember this wall so it cannot be re-run immediately
    this.lockN.set(nx, 0, nz);
    this.lockD = planeD;
    this.lockUntil = this.t + M.WALLRUN_SAME_WALL_LOCK;
    if (this.wallRunning) this._endWallRun('jump');
    this.grounded = false;
    this.snapBlockUntil = this.t + 0.1;
    P.onGround = false;
    P._onJump('wall');
  }

  // ================================================================== ground

  _groundStep(dt) {
    const P = this.p, v = P.velocity, n = this.groundNormal, inp = this.in;
    const coll = this.game.world.collision, c = this.capsule;
    const hasWish = inp.wishLen > 0;

    // wish direction lying in the ground plane
    if (hasWish) {
      _wish.set(inp.wishX, 0, inp.wishZ);
      _wish.addScaledVector(n, -_wish.dot(n));
      const l = _wish.length();
      if (l > 1e-4) _wish.multiplyScalar(1 / l); else _wish.set(inp.wishX, 0, inp.wishZ);
    }

    // friction
    const speed = v.length();
    if (speed > 1e-4) {
      let drop;
      if (this.sliding) drop = speed * M.SLIDE_FRICTION * dt;
      else drop = Math.max(speed, M.STOP_SPEED) * M.FRICTION * dt;
      const ns = Math.max(0, speed - drop);
      v.multiplyScalar(ns / speed);
    }

    if (this.sliding) {
      // downhill gravity, weak steering
      const g = M.GRAVITY * M.SLIDE_SLOPE * dt;
      v.x += g * n.y * n.x;
      v.y += g * (n.y * n.y - 1);
      v.z += g * n.y * n.z;
      if (hasWish) this._steer(v, inp.wishX, inp.wishZ, M.SLIDE_STEER * dt);
      const sp = v.length();
      if (sp > M.SLIDE_MAX) v.multiplyScalar(M.SLIDE_MAX / sp);
    } else if (hasWish) {
      let ws = this.sprintIntent ? M.SPRINT_SPEED : this.crouched ? M.CROUCH_SPEED : M.WALK_SPEED;
      const ads = this.game.weapons ? (this.game.weapons.adsAmount || 0) : 0;
      ws *= 1 - M.ADS_SPEED_LOSS * ads;
      const cur = v.dot(_wish);
      const add = ws - cur;
      if (add > 0) {
        const a = Math.min(M.GROUND_ACCEL * ws * dt, add);
        v.addScaledVector(_wish, a);
      }
    }
    // keep velocity in the ground plane
    v.addScaledVector(n, -v.dot(n));

    // ---- move
    const speedPre = v.length();
    _pre.copy(c.start);
    _sv.set(v.x, 0, v.z);
    const res = coll.moveCapsule(c, v, dt, this.opts);
    let stay = false;
    let stepped = false;

    {
      // blocked or slowed by a low obstacle? try to climb it (edges often register as slopes,
      // so this does not depend on the contact classification)
      const desired = Math.hypot(_sv.x, _sv.z) * dt;
      if (desired > 0.002) {
        const disp = Math.hypot(c.start.x - _pre.x, c.start.z - _pre.z);
        if (disp < desired * 0.75 && this._tryStepUp(_pre, _sv, dt, disp)) {
          v.x = _sv.x;
          v.z = _sv.z;
          v.y = 0;
          n.copy(this._stepNormal);
          stay = true;
          stepped = true;
        }
      }
    }

    if (!stay) {
      const probe = coll.probeGround(c, M.SNAP_DIST, M.GROUND_MIN_Y);
      if (probe && this.t >= this.snapBlockUntil) {
        const launch = v.y > M.SNAP_MAX_UP_SPEED && probe.distance > 0.05;
        if (!launch) {
          // Flat ground snaps exactly. On slopes a dead band is needed: a vertical micro snap
          // penetrates the incline and the push-out would make a standing player creep downhill.
          const flat = probe.normal.y > 0.985;
          if (probe.distance > (flat ? 0.002 : 0.03)) {
            const drop = flat ? probe.distance : probe.distance - 0.02;
            _v1.set(0, -drop, 0);
            c.translate(_v1);
            if (drop > 0.05) this._hideJump(0, -drop, 0);
          }
          n.copy(probe.normal);
          stay = true;
        }
      }
    }

    if (stay) {
      v.addScaledVector(n, -v.dot(n));
      if (!res.hitWall || stepped) {
        const sp = v.length();
        if (sp > 1e-3 && sp < speedPre) v.multiplyScalar(Math.min(speedPre / sp, 1.6));
      }
    } else {
      this.grounded = false;
      this.coyote = M.COYOTE;
      this.airTime = 0;
    }
  }

  /**
   * The physics position just jumped by (dx, dy, dz) that the player should not perceive
   * (step-up, step-down, lookahead): move the interpolation start along and offset the camera back.
   */
  _hideJump(dx, dy, dz) {
    const P = this.p;
    P.prevPosition.x += dx;
    P.prevPosition.y += dy;
    P.prevPosition.z += dz;
    P.stepOffset.x -= dx;
    P.stepOffset.y -= dy;
    P.stepOffset.z -= dz;
  }

  /** Rotate the horizontal velocity toward (wx, wz) by at most `maxTurn` radians (speed preserving). */
  _steer(v, wx, wz, maxTurn) {
    const hs = Math.hypot(v.x, v.z);
    if (hs < 0.5) return;
    const vx = v.x / hs, vz = v.z / hs;
    const ang = Math.atan2(vx * wz - vz * wx, vx * wx + vz * wz);
    if (Math.abs(ang) > 2.2) return;
    const turn = clamp(ang, -maxTurn, maxTurn);
    const cs = Math.cos(turn), sn = Math.sin(turn);
    const hx = v.x, hz = v.z;
    v.x = hx * cs - hz * sn;
    v.z = hx * sn + hz * cs;
  }

  /**
   * Try to climb a low obstacle (<= STEP_UP) that blocked a move. Works on a scratch capsule and
   * commits only when it makes more horizontal progress and ends on walkable ground.
   * @param {THREE.Vector3} pre  capsule.start before the blocked move
   * @param {THREE.Vector3} vH   desired horizontal velocity (mutated: clipped result on success)
   */
  _tryStepUp(pre, vH, dt, mainDisp) {
    const coll = this.game.world.collision, cur = this.capsule, c = this._capA;
    const h = cur.end.y - cur.start.y;
    c.start.set(pre.x, pre.y + M.STEP_UP, pre.z);
    c.end.set(pre.x, pre.y + M.STEP_UP + h, pre.z);
    _v1.copy(c.start);
    coll.resolveCapsule(c);
    // the raised capsule must not be squeezed (ceiling) or pushed sideways (still inside a wall)
    if (c.start.distanceToSquared(_v1) > 0.04 * 0.04) return false;
    // move forward at the raised height; look ahead far enough that the round bottom clears the edge
    const hsp = Math.hypot(vH.x, vH.z);
    const look = Math.max(hsp * dt, M.STEP_LOOKAHEAD);
    coll.moveCapsule(c, vH, dt * (look / (hsp * dt)), this.opts);
    // come back down in small increments (a velocity based drop would slide off the edge)
    let landed = false;
    for (let d = 0.05; d <= M.STEP_UP + 0.1 && !landed; d += 0.05) {
      c.start.y -= 0.05;
      c.end.y -= 0.05;
      const cs = coll.resolveCapsule(c);
      let best = -1, bi = 0;
      for (let k = 0; k < cs.count; k++) if (cs.normals[k].y > best) { best = cs.normals[k].y; bi = k; }
      if (best >= M.GROUND_MIN_Y) {
        landed = true;
        this._stepNormal.copy(cs.normals[bi]);
      }
    }
    if (!landed) return false;
    const rise = c.start.y - pre.y;
    if (rise > M.STEP_UP + 0.02 || rise < 0.005) return false;
    if (Math.hypot(c.start.x - pre.x, c.start.z - pre.z) <= mainDisp + 0.004) return false;
    if (coll.capsuleInside(c)) return false;   // never step up into the middle of a solid
    // the camera must not see the jump: shift the interpolation start and offset the view
    this._hideJump(
      c.start.x - pre.x - vH.x * dt,
      rise,
      c.start.z - pre.z - vH.z * dt,
    );
    cur.start.copy(c.start);
    cur.end.copy(c.end);
    this._netForce = true;
    return true;
  }

  // ================================================================== air

  _airStep(dt) {
    const P = this.p, v = P.velocity, inp = this.in, c = this.capsule, gr = P.grapple;
    const coll = this.game.world.collision;
    const grappled = gr.attached;

    if (this.mantleCooldown <= 0 && (inp.forwardHeld || grappled) && this._tryMantle(false)) return;

    if (inp.wishLen > 0) this._airControl(dt, grappled ? M.GRAPPLE_AIR_CONTROL : 1);

    if (grappled) {
      _chest.set(c.start.x, c.start.y - R + P.height * 0.6, c.start.z);
      gr.applyForces(v, _chest, dt);
    }
    v.y -= M.GRAVITY * (grappled ? M.GRAPPLE_GRAVITY : 1) * dt;
    if (v.y < -M.TERMINAL) v.y = -M.TERMINAL;

    const vyBefore = v.y;
    const hsBefore = Math.hypot(v.x, v.z);
    _pre.copy(c.start);
    _sv.set(v.x, 0, v.z);
    const res = coll.moveCapsule(c, v, dt, this.opts);

    let landed = false;
    // lip assist: catch the edge of a low ledge instead of bumping into it
    if (vyBefore <= 2.5 && vyBefore >= -8 && hsBefore >= 2.5 && !grappled) {
      const desired = hsBefore * dt;
      const disp = Math.hypot(c.start.x - _pre.x, c.start.z - _pre.z);
      if (disp < desired * 0.75 && this._tryStepUp(_pre, _sv, dt, disp)) {
        v.x = _sv.x;
        v.z = _sv.z;
        v.y = 0;
        this._land(0, this._stepNormal, true);
        landed = true;
      }
    }
    if (grappled) {
      // the rope owns the motion: no landing effects, no ground friction, just track contact
      this.grounded = res.onGround;
      if (res.onGround) this.groundNormal.copy(res.groundNormal);
      landed = true;
    } else if (!landed && res.onGround && vyBefore <= 0.5) {
      this._land(Math.max(0, -vyBefore), res.groundNormal, false);
      landed = true;
    }
    if (!landed) {
      this.airTime += dt;
      if (!grappled) this._checkWallRunStart();
    }
  }

  /** Quake-style air accelerator (strafing) plus speed-preserving steering. */
  _airControl(dt, scale) {
    const v = this.p.velocity, inp = this.in;
    const wx = inp.wishX, wz = inp.wishZ;
    const hs = Math.hypot(v.x, v.z);
    const cur = v.x * wx + v.z * wz;
    const add = M.AIR_CAP - cur;
    if (add > 0) {
      let a = M.AIR_ACCEL * M.AIR_CAP * dt * scale;
      if (cur < 0) a *= 0.35;                                        // gentle air braking
      if (hs > M.AIR_SOFT_CAP0) a *= 1 - smoothstep(M.AIR_SOFT_CAP0, M.AIR_SOFT_CAP1, hs);
      v.x += wx * Math.min(a, add);
      v.z += wz * Math.min(a, add);
    }
    if (hs > 1.5) this._steer(v, wx, wz, M.AIR_TURN * dt * scale);
  }

  /** Touch down. `silent` = no landing effects (ledge assist). */
  _land(impact, normal, silent) {
    const P = this.p, v = P.velocity;
    this.grounded = true;
    this.groundNormal.copy(normal);
    this.airTime = 0;
    this.resetAirBudget();
    this.lockUntil = 0;
    this.wallCoyote = 0;
    this.lastLandT = this.t;
    if (!silent && this.t >= this.landSuppressUntil) {
      if (impact > M.LAND_PENALTY_START && !this.in.crouchHeld) {
        const f = 1 - M.LAND_PENALTY_MAX * saturate((impact - M.LAND_PENALTY_START) / 12);
        v.x *= f;
        v.z *= f;
      }
      if (impact >= 2.5) P._onLand(impact);
    }
    v.addScaledVector(normal, -v.dot(normal));
  }

  // ================================================================== wall running

  /**
   * Scan for near-vertical walls around the player with horizontal rays from the chest.
   * Angles are relative to the horizontal velocity direction (look direction when nearly still).
   * On success fills `out` {nx, nz (unit, away from the wall), dist, d (plane offset), side, dotV}.
   */
  _scanWalls(out, reach, angles, verify) {
    const P = this.p, coll = this.game.world.collision, c = this.capsule;
    out.found = false;
    let dx = P.velocity.x, dz = P.velocity.z;
    const hs = Math.hypot(dx, dz);
    if (hs < 0.8) { dx = -Math.sin(P.yaw); dz = -Math.cos(P.yaw); } else { dx /= hs; dz /= hs; }
    const feetY = c.start.y - R;
    const y1 = feetY + P.height * 0.55;
    const y2 = feetY + P.height * 0.88;
    let best = reach + 1;
    for (let i = 0; i < angles.length; i++) {
      const a = angles[i], ca = Math.cos(a), sa = Math.sin(a);
      const rx = dx * ca + dz * sa, rz = -dx * sa + dz * ca;
      _origin.set(c.start.x, y1, c.start.z);
      _dir.set(rx, 0, rz);
      const hit = coll.raycast(_origin, _dir, reach);
      if (!hit || Math.abs(hit.normal.y) > M.WALLRUN_MAX_NORMAL_Y || hit.distance >= best) continue;
      let nx = hit.normal.x, nz = hit.normal.z;
      const nl = Math.hypot(nx, nz);
      if (nl < 1e-4) continue;
      nx /= nl;
      nz /= nl;
      if (nx * rx + nz * rz > -0.1) continue;
      if (verify) {
        _origin.y = y2;
        const h2 = coll.raycast(_origin, _dir, reach + 0.2);
        if (!h2 || Math.abs(h2.normal.y) > M.WALLRUN_MAX_NORMAL_Y) continue;
        if (h2.normal.x * hit.normal.x + h2.normal.z * hit.normal.z < 0.9) continue;
      }
      best = hit.distance;
      out.found = true;
      out.nx = nx;
      out.nz = nz;
      out.dist = hit.distance;
      out.d = nx * hit.point.x + nz * hit.point.z;
      out.dotV = nx * dx + nz * dz;
      out.side = nx * dz - nz * dx >= 0 ? 1 : -1;
    }
    return out.found;
  }

  _checkWallRunStart() {
    const P = this.p, v = P.velocity, inp = this.in;
    if (!inp.forwardHeld || inp.crouchHeld || this.airTime < 0.06) return;
    if (this.wallRunsThisAir >= M.WALLRUN_MAX_PER_AIR) return;
    this.scanTick ^= 1;
    if (this.scanTick) return; // scan at 60 Hz
    const hs = Math.hypot(v.x, v.z);
    if (hs < M.WALLRUN_MIN_SPEED) return;
    const coll = this.game.world.collision;
    if (coll.probeGround(this.capsule, M.WALLRUN_MIN_HEIGHT, M.GROUND_MIN_Y)) return;
    const s = this._scan;
    if (!this._scanWalls(s, R + M.WALLRUN_REACH, WALLRUN_ANGLES, true)) return;
    if (s.dotV > 0.3 || Math.abs(s.dotV) > 0.87) return; // moving away, or nearly head-on
    if (this._isLocked(s)) return;                        // same wall, still locked
    this._startWallRun(s);
  }

  _startWallRun(s) {
    const v = this.p.velocity;
    this.wallRunning = true;
    this.wallRunTime = 0;
    this.wallLost = 0;
    this.noFwd = 0;
    this.awayT = 0;
    this.wallN.set(s.nx, 0, s.nz);
    this.wallSide = s.side;
    this.wallPlaneD = s.d;
    const tx = s.nz, tz = -s.nx;
    this.runSign = v.x * tx + v.z * tz >= 0 ? 1 : -1;
    this.wallRunsThisAir++;
    this._refreshAirJump();
    if (v.y > 2.5) v.y = 2.5;
    this.sprinting = false;
    this.p._onWallRunStart();
  }

  _endWallRun(reason) {
    if (!this.wallRunning) return;
    this.wallRunning = false;
    this.p.isWallRunning = false;
    this.p.wallRunSide = 0;
    this.lockN.copy(this.wallN);
    this.lockD = this.wallPlaneD;
    this.lockUntil = this.t + M.WALLRUN_SAME_WALL_LOCK;
    if (reason !== 'jump' && reason !== 'land' && reason !== 'death') {
      this.wallCoyote = M.WALL_COYOTE;
      this.lastWallN.copy(this.wallN);
    }
    this.p._onWallRunEnd(reason);
  }

  _wallRunStep(dt) {
    const P = this.p, v = P.velocity, inp = this.in, c = this.capsule, gr = P.grapple;
    const coll = this.game.world.collision;
    const n = this.wallN;
    this.wallRunTime += dt;
    const T = this.wallRunTime;

    // ---- exit conditions from input / time
    if (inp.forwardHeld) this.noFwd = 0; else this.noFwd += dt;
    if (this.noFwd > 0.12) return this._endWallRun('release');
    if (inp.crouchHeld) return this._endWallRun('crouch');
    if (T >= M.WALLRUN_TIME) return this._endWallRun('timeout');
    if (gr.attached) return this._endWallRun('grapple');
    if (inp.wishLen > 0) {
      const away = inp.wishX * n.x + inp.wishZ * n.z;
      this.awayT = away > 0.62 ? this.awayT + dt : 0;
      if (this.awayT > 0.14) return this._endWallRun('steer');
    }

    // ---- wall tracking
    const feetY = c.start.y - R;
    _origin.set(c.start.x, feetY + P.height * 0.6, c.start.z);
    _dir.set(-n.x, 0, -n.z);
    const hit = coll.raycast(_origin, _dir, R + M.WALLRUN_REACH + 0.12);
    if (hit && Math.abs(hit.normal.y) <= 0.3) {
      let nx = hit.normal.x, nz = hit.normal.z;
      const nl = Math.hypot(nx, nz) || 1;
      nx /= nl;
      nz /= nl;
      n.x = lerp(n.x, nx, 0.6);
      n.z = lerp(n.z, nz, 0.6);
      const l = Math.hypot(n.x, n.z) || 1;
      n.x /= l;
      n.z /= l;
      this.wallPlaneD = n.x * hit.point.x + n.z * hit.point.z;
      this.wallLost = 0;
    } else {
      this.wallLost += dt;
      if (this.wallLost > 0.1) return this._endWallRun('wall');
    }

    // ---- run along the wall tangent
    const tx = n.z * this.runSign, tz = -n.x * this.runSign;
    const vt = v.x * tx + v.z * tz;
    let target;
    if (vt > M.WALLRUN_MAX) target = Math.max(M.WALLRUN_MAX, vt - 5 * dt);
    else target = Math.max(vt, M.WALLRUN_SPEED);
    const nvt = approach(vt, target, (target > vt ? 45 : 10) * dt);
    v.x = tx * nvt - n.x * 1.2;
    v.z = tz * nvt - n.z * 1.2;

    // reduced gravity that ramps back to full, with a sink-speed limit that relaxes over time
    const u = saturate(T / M.WALLRUN_TIME);
    v.y -= M.GRAVITY * lerp(M.WALLRUN_GRAV_START, 1, u * u) * dt;
    const sink = lerp(M.WALLRUN_SINK_START, M.WALLRUN_SINK_END, u * u * u);
    if (v.y < -sink) v.y = approach(v.y, -sink, 60 * dt);

    const vyBefore = v.y;
    const res = coll.moveCapsule(c, v, dt, this.opts);

    if (res.onGround && vyBefore <= 0.5) {
      this._endWallRun('land');
      this._land(Math.max(0, -vyBefore), res.groundNormal, false);
      return;
    }
    if (res.hitCeiling) return this._endWallRun('ceiling');
    if (Math.hypot(v.x, v.z) < Math.max(3.5, nvt * 0.55)) return this._endWallRun('blocked');
  }

  // ================================================================== mantle

  /** Record why the last mantle attempt was refused (tests / debugging: `mantleWhy`) and refuse. */
  _noMantle(why) {
    this.mantleWhy = why;
    return false;
  }

  /**
   * Look for a ledge in front and start a mantle if the capsule fits on top.
   * @param {boolean} fromGround true when triggered by a ground jump press
   */
  _tryMantle(fromGround) {
    const P = this.p, coll = this.game.world.collision, c = this.capsule;
    let fx, fz;
    if (this.in.forwardHeld) { fx = -Math.sin(P.yaw); fz = -Math.cos(P.yaw); }
    else if (P.grapple.attached) {
      fx = P.grapple.anchor.x - c.start.x;
      fz = P.grapple.anchor.z - c.start.z;
      const l = Math.hypot(fx, fz);
      if (l < 0.3) return false;
      fx /= l;
      fz /= l;
    } else return false;

    const feetY = c.start.y - R;
    const reach = R + M.MANTLE_REACH;
    // 1. wall face at knee height
    _origin.set(c.start.x, feetY + 0.45, c.start.z);
    _dir.set(fx, 0, fz);
    const wall = coll.raycast(_origin, _dir, reach);
    if (!wall || Math.abs(wall.normal.y) > 0.3) return this._noMantle('no wall');
    let nx = wall.normal.x, nz = wall.normal.z;
    const nl = Math.hypot(nx, nz);
    if (nl < 1e-4) return this._noMantle('no wall');
    nx /= nl;
    nz /= nl;
    if (nx * fx + nz * fz > -0.35) return this._noMantle('not facing');         // must be facing the wall

    // 2. walkable top surface just behind the wall face.
    // The ledge-top ray starts 0.3 m INSIDE the wall plane, above the ledge. If the wall keeps going up there
    // (a second solid stacked on the first, a roof parapet, a boundary wall with an invisible extension) that
    // start point is buried in the upper solid and the downward ray - which ignores back faces - would report
    // the hidden seam between the two layers as a ledge. So the start point must be reachable from the player's
    // own column through open air (the wall face above the ledge would block that segment). A start point inside
    // a CEILING slab is fine: the ray only needs to see the ledge below it.
    const oy = feetY + M.MANTLE_MAX + 0.45;
    const ox = wall.point.x - nx * 0.3, oz = wall.point.z - nz * 0.3;
    if (this._segBlocked(c.start.x, oy, c.start.z, ox, oy, oz)) return this._noMantle('wall continues above the ledge');
    _origin.set(ox, oy, oz);
    const top = coll.raycast(_origin, DOWN, M.MANTLE_MAX + 0.45 - 0.3);
    if (!top || top.normal.y < 0.85) return this._noMantle('no ledge top');
    const H = top.point.y - feetY;
    if (H < M.MANTLE_MIN || H > M.MANTLE_MAX) return this._noMantle('ledge height');

    // 3. the wall must reach up to the ledge (no mantling onto floating slabs behind a gap)
    _origin.set(c.start.x, feetY + H - 0.12, c.start.z);
    const wall2 = coll.raycast(_origin, _dir, reach + 0.15);
    if (!wall2) return this._noMantle('no wall under ledge');
    let n2x = wall2.normal.x, n2z = wall2.normal.z;
    const n2l = Math.hypot(n2x, n2z);
    if (n2l < 1e-4) return this._noMantle('no wall under ledge');
    n2x /= n2l;
    n2z /= n2l;

    // 4. landing spot on top, with room for a standing capsule
    const tx = wall2.point.x - n2x * (R + 0.07);
    const tz = wall2.point.z - n2z * (R + 0.07);
    _origin.set(tx, top.point.y + 0.45, tz);
    const under = coll.raycast(_origin, DOWN, 0.95);
    if (!under || under.normal.y < 0.85 || Math.abs(under.point.y - top.point.y) > 0.2) return this._noMantle('no landing surface');
    const ty = under.point.y;
    if (!this._capsuleClear(tx, ty, tz)) return this._noMantle('landing blocked');
    if (!this._capsuleClear(c.start.x, ty, c.start.z)) return this._noMantle('column above ledge blocked');

    // 5. the whole path must be open air: up the wall in the player's column, then forward over the ledge at
    //    every height the body occupies (a solid above the ledge, e.g. the upper layer of a stack, blocks it)
    if (this._segBlocked(c.start.x, feetY + STAND_H, c.start.z, c.start.x, ty + STAND_H, c.start.z)) return this._noMantle('path up the wall blocked');
    for (let i = 0; i < MANTLE_CLEAR_H.length; i++) {
      const y = ty + MANTLE_CLEAR_H[i];
      if (this._segBlocked(c.start.x, y, c.start.z, tx, y, tz)) return this._noMantle('path over the ledge blocked');
    }

    // ---- go
    this.mantleFrom.set(c.start.x, feetY, c.start.z);
    this.mantleTo.set(tx, ty + 0.005, tz);
    this.mantleDir.set(-n2x, 0, -n2z);
    this.mantleHeight = H;
    this.mantleT = 0;
    this.mantleDur = lerp(0.25, 0.31, saturate((H - 0.6) / 1.7)) * (M.MANTLE_TIME / 0.28);
    this.mantling = true;
    this.grounded = false;
    this._endSlide();
    if (this.wallRunning) this._endWallRun('mantle');
    if (P.grapple.attached) P.grapple.release('mantle');
    if (this.crouched) { this.crouched = false; this._setHeight(STAND_H); }
    P.velocity.set(0, 0, 0);
    P.isMantling = true;
    P._onMantle();
    return true;
  }

  _stepMantle(dt) {
    const P = this.p, c = this.capsule, coll = this.game.world.collision;
    this.mantleT += dt;
    const s = saturate(this.mantleT / this.mantleDur);
    const rise = easeOutQuad(saturate(s / 0.58));
    const fwd = easeInOutQuad(saturate((s - 0.46) / 0.54));
    const from = this.mantleFrom, to = this.mantleTo;
    const y = lerp(from.y, to.y, rise);
    const x = lerp(from.x, to.x, fwd);
    const z = lerp(from.z, to.z, fwd);
    c.start.set(x, y + R, z);
    c.end.set(x, y + STAND_H - R, z);
    this.p.height = STAND_H;
    P.velocity.set(0, 0, 0);
    if (s >= 1) this._finishMantle();
    else coll.resolveCapsule(c);
  }

  _finishMantle() {
    const P = this.p, c = this.capsule, coll = this.game.world.collision;
    coll.resolveCapsule(c);
    this.mantling = false;
    P.isMantling = false;
    this.mantleCooldown = M.MANTLE_COOLDOWN;
    P.velocity.set(this.mantleDir.x * M.MANTLE_EXIT_SPEED, 0, this.mantleDir.z * M.MANTLE_EXIT_SPEED);
    const probe = coll.probeGround(c, 0.4, M.GROUND_MIN_Y);
    if (probe) {
      if (Math.abs(probe.distance) > 1e-4) {
        _v1.set(0, -probe.distance, 0);
        c.translate(_v1);
      }
      this.groundNormal.copy(probe.normal);
      this.grounded = true;
    } else {
      this.grounded = false;
    }
    this.airTime = 0;
    this.resetAirBudget();
    this.lockUntil = 0;
    this.lastLandT = -99;
    this._netForce = true;
    P._onMantleEnd();
  }
}
