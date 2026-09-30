import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { MOVE as M } from './MoveConfig.js';
import { clamp, smoothstep } from '../core/utils.js';

const SEGS = 26;   // rope segments
const SIDES = 5;   // rope cross-section sides
const UP = new THREE.Vector3(0, 1, 0);
const NEG_Z = new THREE.Vector3(0, 0, -1);
const HAND_OFFSET = new THREE.Vector3(-0.13, -0.21, -0.55); // camera space, at the left forearm of the viewmodel

const _eye = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _hand = new THREE.Vector3();
const _chest = new THREE.Vector3();
const _to = new THREE.Vector3();
const _v = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _u = new THREE.Vector3();
const _w = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _n = new THREE.Vector3();

const noopLoop = { setVolume() {}, setRate() {}, setPosition() {}, stop() {} };

/**
 * Grappling hook: hook flight, attach, rope pull + pendulum constraint, release rules, cooldown
 * (`charge`), and the rope / claw visuals.
 *
 * States: 'idle' -> 'flying' -> ('attached' | miss) -> 'retract' -> 'idle'.
 * Forces are applied by the movement controller once per physics step via applyForces();
 * everything else runs once per frame in update().
 */
export class Grapple {
  /** @param {import('./Player.js').Player} player */
  constructor(player) {
    this.player = player;
    this.game = player.game;
    this.state = 'idle';
    this.anchor = new THREE.Vector3();
    this.normal = new THREE.Vector3(0, 1, 0);
    this.hook = new THREE.Vector3();
    this.target = new THREE.Vector3();
    this.origin = new THREE.Vector3();
    this.flightDir = new THREE.Vector3();
    this.flightTime = 0;
    this.willHit = false;
    /**
     * Input-clock time (s, Input.time of the frame) the rope attached: a jump pressed before it (still sitting in
     * the jump buffer) must not release the new swing (PlayerController._handleJump).
     */
    this.attachedAt = 0;
    this.ropeLength = 0;
    this.time = 0;
    this.retractT = 0;
    this.cooldown = 0;
    this.cooldownTotal = M.GRAPPLE_COOLDOWN;
    /** 0..1, 1 = ready. */
    this.charge = 1;
    this.losTimer = 0;
    this._losClock = 0;
    this.pullSpeed = 0;
    this.wave = 0;
    this._clock = 0;
    this._loop = noopLoop;
    this.group = null;
  }

  /** True while the rope is attached and pulling. */
  get attached() { return this.state === 'attached'; }

  /** True while a hook is out (flying, attached or retracting). */
  get active() { return this.state !== 'idle'; }

  /** Build the persistent visuals (added to game.scene, hidden while idle). */
  init() {
    const group = new THREE.Group();
    group.name = 'grapple';
    group.visible = false;

    // ---- rope: a low-poly tube rebuilt every frame
    const vCount = (SEGS + 1) * SIDES;
    const geo = new THREE.BufferGeometry();
    this._pos = new Float32Array(vCount * 3);
    this._uv = new Float32Array(vCount * 2);
    geo.setAttribute('position', new THREE.BufferAttribute(this._pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('uv', new THREE.BufferAttribute(this._uv, 2).setUsage(THREE.DynamicDrawUsage));
    const idx = [];
    for (let i = 0; i < SEGS; i++) {
      for (let j = 0; j < SIDES; j++) {
        const a = i * SIDES + j, b = i * SIDES + (j + 1) % SIDES;
        const c = (i + 1) * SIDES + j, d = (i + 1) * SIDES + (j + 1) % SIDES;
        idx.push(a, c, b, b, c, d);
      }
    }
    geo.setIndex(idx);
    const tex = this._makeRopeTexture();
    this.ropeTexture = tex;
    const mat = new THREE.MeshBasicMaterial({ map: tex, color: new THREE.Color(1.5, 2.1, 2.6), side: THREE.DoubleSide });
    this.rope = new THREE.Mesh(geo, mat);
    this.rope.frustumCulled = false;
    this.rope.name = 'grapple-rope';
    group.add(this.rope);

    // ---- claw
    this.claw = this._buildClaw();
    group.add(this.claw);

    this.group = group;
    this.game.scene.add(group);
  }

  _makeRopeTexture() {
    const c = document.createElement('canvas');
    c.width = 128;
    c.height = 8;
    const g = c.getContext('2d');
    g.fillStyle = '#2aa8d8';
    g.fillRect(0, 0, 128, 8);
    const grad = g.createLinearGradient(0, 0, 128, 0);
    grad.addColorStop(0, 'rgba(255,255,255,0)');
    grad.addColorStop(0.62, 'rgba(255,255,255,0)');
    grad.addColorStop(0.86, 'rgba(210,250,255,1)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 8);
    g.fillStyle = 'rgba(0,40,70,0.35)';
    g.fillRect(0, 0, 128, 1);
    g.fillRect(0, 7, 128, 1);
    const t = new THREE.CanvasTexture(c);
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.ClampToEdgeWrapping;
    t.colorSpace = THREE.SRGBColorSpace;
    t.magFilter = THREE.LinearFilter;
    return t;
  }

  _buildClaw() {
    const metalGeos = [];
    // body: tip toward -Z
    const body = new THREE.CylinderGeometry(0.022, 0.046, 0.17, 6, 1);
    body.rotateX(-Math.PI / 2);
    metalGeos.push(body.toNonIndexed());
    // four prongs
    const q = new THREE.Quaternion();
    const m = new THREE.Matrix4();
    for (let i = 0; i < 4; i++) {
      const phi = i * Math.PI / 2 + Math.PI / 4;
      const tilt = 0.5;
      const dir = new THREE.Vector3(Math.sin(tilt) * Math.cos(phi), Math.sin(tilt) * Math.sin(phi), -Math.cos(tilt));
      const prong = new THREE.ConeGeometry(0.02, 0.2, 4, 1);
      q.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
      m.compose(new THREE.Vector3(dir.x * 0.1 * 0.5, dir.y * 0.1 * 0.5, -0.1 + dir.z * 0.1 * 0.5), q, new THREE.Vector3(1, 1, 1));
      prong.applyMatrix4(m);
      metalGeos.push(prong.toNonIndexed());
    }
    // rear ring where the rope attaches
    const ring = new THREE.TorusGeometry(0.036, 0.009, 5, 10);
    ring.translate(0, 0, 0.1);
    metalGeos.push(ring.toNonIndexed());
    // rear collar
    const collar = new THREE.CylinderGeometry(0.05, 0.03, 0.05, 6, 1);
    collar.rotateX(-Math.PI / 2);
    collar.translate(0, 0, 0.07);
    metalGeos.push(collar.toNonIndexed());
    const metalGeo = mergeGeometries(metalGeos, false);
    const metal = new THREE.MeshStandardMaterial({ color: 0x3b4652, metalness: 0.85, roughness: 0.38 });

    const core = new THREE.IcosahedronGeometry(0.034, 0);
    core.translate(0, 0, 0.005);
    const glow = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.7, 2.2, 3.0) });

    const g = new THREE.Group();
    const m1 = new THREE.Mesh(metalGeo, metal);
    const m2 = new THREE.Mesh(core, glow);
    m1.frustumCulled = false;
    m2.frustumCulled = false;
    // soft additive glow so the hook reads from far away
    const gc = document.createElement('canvas');
    gc.width = gc.height = 64;
    const gx = gc.getContext('2d');
    const rg = gx.createRadialGradient(32, 32, 0, 32, 32, 32);
    rg.addColorStop(0, 'rgba(255,255,255,1)');
    rg.addColorStop(0.25, 'rgba(120,220,255,0.7)');
    rg.addColorStop(1, 'rgba(60,160,255,0)');
    gx.fillStyle = rg;
    gx.fillRect(0, 0, 64, 64);
    const glowTex = new THREE.CanvasTexture(gc);
    glowTex.colorSpace = THREE.SRGBColorSpace;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTex, color: new THREE.Color(1.1, 1.6, 2.0), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true,
    }));
    sprite.scale.setScalar(0.42);
    sprite.position.z = 0.02;
    g.add(m1, m2, sprite);
    g.name = 'grapple-claw';
    return g;
  }

  // ------------------------------------------------------------------ control

  /** Reset for a new life: retract instantly, cooldown cleared. */
  reset() {
    this._stopLoop();
    this.state = 'idle';
    this.cooldown = 0;
    this.charge = 1;
    this.time = 0;
    this.losTimer = 0;
    this.wave = 0;
    if (this.group) this.group.visible = false;
    const P = this.player;
    P.grappleAnchor = null;
    P.isGrappling = false;
    P.grappleCharge = 1;
  }

  /** Grapple key pressed: fire when ready, otherwise cancel / release the hook. */
  toggle() {
    if (this.state === 'idle') this.fire();
    else if (this.state === 'flying' || this.state === 'attached') this.release('manual');
  }

  /** Fire the hook along the player's aim. Returns false when on cooldown / not allowed. */
  fire() {
    const P = this.player, g = this.game;
    if (!P.alive || this.state !== 'idle' || this.cooldown > 0 || P.isMantling) return false;
    P.getEyePosition(_eye);
    P.getAimDirection(_dir);
    const hit = g.world.collision.raycast(_eye, _dir, M.GRAPPLE_RANGE);
    this._handWorld(_hand);
    this.origin.copy(_hand);
    if (hit) {
      this.willHit = true;
      this.target.copy(hit.point).addScaledVector(hit.normal, 0.03);
      this.normal.copy(hit.normal);
    } else {
      this.willHit = false;
      this.target.copy(_eye).addScaledVector(_dir, M.GRAPPLE_RANGE);
      this.normal.copy(_dir).negate();
    }
    this.flightDir.subVectors(this.target, this.origin);
    const dist = Math.max(0.5, this.flightDir.length());
    this.flightDir.multiplyScalar(1 / dist);
    this.flightTime = dist / M.GRAPPLE_HOOK_SPEED;
    this.hook.copy(this.origin);
    this.state = 'flying';
    this.time = 0;
    this.wave = 0.16;
    this.charge = 0;
    g.audio.play('grapple_fire');
    g.events.emit('player:grapple', { state: 'fire' });
    return true;
  }

  /**
   * Detach the rope (or cancel a flying hook). Starts the cooldown.
   * @param {string} reason 'manual' | 'jump' | 'timeout' | 'reached' | 'los' | 'death' | 'mantle' | 'reset'
   */
  release(reason = 'manual') {
    const P = this.player, g = this.game;
    if (this.state === 'attached') {
      this._stopLoop();
      this.cooldownTotal = M.GRAPPLE_COOLDOWN;
      this.cooldown = this.cooldownTotal;
      this.state = 'retract';
      this.retractT = 0;
      this.hook.copy(this.anchor);
      P.grappleAnchor = null;
      P.isGrappling = false;
      if (reason !== 'death') g.audio.play('grapple_release');
      g.events.emit('player:grapple', { state: 'release', reason });
    } else if (this.state === 'flying') {
      this.cooldownTotal = M.GRAPPLE_MISS_COOLDOWN;
      this.cooldown = this.cooldownTotal;
      this.state = 'retract';
      this.retractT = 0;
      g.events.emit('player:grapple', { state: 'release', reason });
    }
  }

  // ------------------------------------------------------------------ per frame

  /** Frame update: flight, attach, release rules, cooldown. Call before the physics steps. */
  update(dt) {
    const P = this.player, g = this.game;
    this._clock += dt;
    if (this.wave > 0) this.wave = Math.max(0, this.wave - dt * 0.9);

    if (this.state === 'flying') {
      this.time += dt;
      const travelled = Math.min(this.flightTime, this.time) * M.GRAPPLE_HOOK_SPEED;
      this.hook.copy(this.origin).addScaledVector(this.flightDir, travelled);
      if (this.time >= this.flightTime) {
        if (this.willHit) this._attach();
        else {
          this.cooldownTotal = M.GRAPPLE_MISS_COOLDOWN;
          this.cooldown = this.cooldownTotal;
          this.state = 'retract';
          this.retractT = 0;
          g.events.emit('player:grapple', { state: 'miss' });
        }
      }
    } else if (this.state === 'attached') {
      this._updateAttached(dt);
    } else if (this.state === 'retract') {
      this.retractT += dt;
      if (this.retractT >= 0.16) {
        this.state = 'idle';
        if (this.group) this.group.visible = false;
      }
    }

    if (this.state === 'idle' || this.state === 'retract') {
      if (this.cooldown > 0) this.cooldown = Math.max(0, this.cooldown - dt);
      this.charge = this.cooldown > 0 ? 1 - this.cooldown / this.cooldownTotal : 1;
    } else {
      this.charge = 0;
    }
    P.grappleCharge = this.charge;
  }

  _attach() {
    const P = this.player, g = this.game;
    this.state = 'attached';
    this.attachedAt = g.input ? g.input.time : 0;
    this.anchor.copy(this.target);
    this.hook.copy(this.anchor);
    this.time = 0;
    this.losTimer = 0;
    this._losClock = 0;
    this.wave = 0.22;
    P.getChestPosition(_chest);
    this.ropeLength = _chest.distanceTo(this.anchor);
    P.grappleAnchor = this.anchor;
    P.isGrappling = true;
    P.move.onGrappleAttach();
    g.audio.play('grapple_attach');
    this._loop = this._startLoop();
    g.events.emit('player:grapple', { state: 'attach' });
    if (g.effects && g.effects.dust) g.effects.dust(this.anchor, { amount: 0.4 });
    P.addShake(0.06);
  }

  _startLoop() {
    const a = this.game.audio;
    const l = a && a.playLoop ? a.playLoop('grapple_reel', { volume: 0.45, rate: 1 }) : null;
    return l || noopLoop;
  }

  _stopLoop() {
    try { this._loop.stop(); } catch { /* audio unavailable */ }
    this._loop = noopLoop;
  }

  _updateAttached(dt) {
    const P = this.player, g = this.game;
    this.time += dt;
    P.getChestPosition(_chest);
    const d = _chest.distanceTo(this.anchor);
    this.pullSpeed = Math.hypot(P.velocity.x, P.velocity.y, P.velocity.z);
    this._loop.setRate(0.85 + Math.min(1, this.pullSpeed / 26) * 0.5);
    this._loop.setVolume(0.35 + Math.min(1, this.pullSpeed / 26) * 0.25);

    if (this.time >= M.GRAPPLE_MAX_TIME) { this.release('timeout'); return; }
    if (d <= M.GRAPPLE_RELEASE_DIST) {
      // arriving: a little lift helps clearing the ledge the anchor sits on
      if (this.anchor.y > P.position.y + 0.5) P.velocity.y = Math.max(P.velocity.y, 3.0);
      this.release('reached');
      return;
    }
    // line of sight check (~20 Hz); the rope may graze corners briefly
    this._losClock += dt;
    if (this._losClock >= 0.05) {
      this._losClock = 0;
      const blocked = this._blocked(P.getEyePosition(_eye)) && this._blocked(_chest);
      this.losTimer = blocked ? this.losTimer + 0.05 : 0;
      if (this.losTimer > 0.3) this.release('los');
    }
  }

  _blocked(from) {
    const g = this.game;
    _v.copy(this.anchor).addScaledVector(this.normal, 0.08).sub(from);
    const len = _v.length();
    if (len < 1.2) return false;
    _v.multiplyScalar(1 / len);
    return !!g.world.collision.raycast(from, _v, Math.max(0, len - 0.6));
  }

  /**
   * Rope forces for one physics step: pull toward the anchor, speed cap, rope-length constraint.
   * @param {THREE.Vector3} velocity  player velocity (mutated)
   * @param {THREE.Vector3} chest     current chest position
   * @param {number} dt
   * @returns {boolean} true when the rope is attached
   */
  applyForces(velocity, chest, dt) {
    if (this.state !== 'attached') return false;
    _to.subVectors(this.anchor, chest);
    const d = _to.length();
    if (d < 1e-4) return true;
    _to.multiplyScalar(1 / d);
    if (d < this.ropeLength) this.ropeLength = d;      // the rope reels in as we approach
    const before = velocity.length();
    velocity.addScaledVector(_to, M.GRAPPLE_PULL * dt);
    // speed cap: 24 m/s far away, easing down to a soft arrival near the anchor; a faster player
    // (rocket jump...) keeps their momentum while the anchor is still far
    const far = clamp((d - M.GRAPPLE_RELEASE_DIST) / 9, 0, 1);
    const cap = M.GRAPPLE_ARRIVE_SPEED + (M.GRAPPLE_SPEED_CAP - M.GRAPPLE_ARRIVE_SPEED) * far;
    const hold = far >= 1 ? Math.max(cap, before) : cap;
    const sp = velocity.length();
    if (sp > hold) velocity.multiplyScalar(Math.max(hold, sp - M.GRAPPLE_BRAKE * dt) / sp);
    if (d > this.ropeLength) {
      const out = -velocity.dot(_to);                   // velocity component away from the anchor
      if (out > 0) velocity.addScaledVector(_to, out);
      velocity.addScaledVector(_to, Math.min(6, (d - this.ropeLength) * 10));
    }
    return true;
  }

  // ------------------------------------------------------------------ visuals

  _handWorld(out) {
    const cam = this.game.camera;
    return out.copy(HAND_OFFSET).applyQuaternion(cam.quaternion).add(cam.position);
  }

  /** Update the rope and claw meshes. Call after the camera has been positioned this frame. */
  updateVisuals(dt, camera) {
    const group = this.group;
    if (!group) return;
    if (this.state === 'idle' || !this.player.alive) {
      group.visible = false;
      return;
    }
    group.visible = true;
    this._handWorld(_a);
    let sag = 0;
    let wave = this.wave;
    const claw = this.claw;
    let scaleDist = 0;

    if (this.state === 'attached') {
      claw.position.copy(this.anchor).addScaledVector(this.normal, 0.09);
      _q.setFromUnitVectors(NEG_Z, _n.copy(this.normal).negate());
      claw.quaternion.copy(_q);
      _b.copy(claw.position).addScaledVector(this.normal, 0.105);
      scaleDist = camera.position.distanceTo(claw.position);
    } else if (this.state === 'flying') {
      claw.position.copy(this.hook);
      _q.setFromUnitVectors(NEG_Z, this.flightDir);
      claw.quaternion.copy(_q);
      _b.copy(claw.position).addScaledVector(this.flightDir, -0.105);
      sag = 0.25 * (1 - this.time / Math.max(0.05, this.flightTime));
      wave = Math.max(wave, 0.12);
      scaleDist = camera.position.distanceTo(claw.position);
    } else { // retract
      const k = smoothstep(0, 0.16, this.retractT);
      claw.position.lerpVectors(this.hook, _a, k);
      _v.subVectors(_a, this.hook);
      if (_v.lengthSq() > 1e-6) {
        _v.normalize();
        _q.setFromUnitVectors(NEG_Z, _v.negate());
        claw.quaternion.copy(_q);
      }
      _b.copy(claw.position);
      wave = 0.15;
      scaleDist = camera.position.distanceTo(claw.position);
    }
    claw.scale.setScalar(1 + clamp(scaleDist, 0, 60) / 14);
    this._updateRope(_a, _b, wave, sag, camera.position);
    if (this.state === 'attached') this.ropeTexture.offset.x -= dt * 2.6;
    else this.ropeTexture.offset.x -= dt * 5;
  }

  _updateRope(start, end, wave, sag, camPos) {
    _u.subVectors(end, start);
    const len = _u.length();
    if (len < 1e-3) { this.rope.visible = false; return; }
    this.rope.visible = true;
    _u.multiplyScalar(1 / len); // rope direction
    _w.crossVectors(_u, UP);
    if (_w.lengthSq() < 1e-4) _w.set(1, 0, 0); else _w.normalize();
    // _w = side, _v = up-ish
    _v.crossVectors(_w, _u).normalize();
    const pos = this._pos, uv = this._uv;
    const t = this._clock;
    const uvScale = len / 0.9;
    for (let i = 0; i <= SEGS; i++) {
      const s = i / SEGS;
      const bell = Math.sin(Math.PI * s);
      const o1 = wave * bell * Math.sin(s * 15 - t * 40);
      const o2 = wave * bell * Math.cos(s * 11 - t * 33) * 0.7;
      const drop = sag * 4 * s * (1 - s);
      const cx = start.x + (end.x - start.x) * s + _w.x * o1 + _v.x * o2;
      const cy = start.y + (end.y - start.y) * s + _w.y * o1 + _v.y * o2 - drop;
      const cz = start.z + (end.z - start.z) * s + _w.z * o1 + _v.z * o2;
      const dx = camPos.x - cx, dy = camPos.y - cy, dz = camPos.z - cz;
      const dc = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const r = 0.0034 + dc * 0.0009;
      for (let j = 0; j < SIDES; j++) {
        const a = (j / SIDES) * Math.PI * 2;
        const ca = Math.cos(a) * r, sa = Math.sin(a) * r;
        const k = (i * SIDES + j);
        pos[k * 3] = cx + _w.x * ca + _v.x * sa;
        pos[k * 3 + 1] = cy + _w.y * ca + _v.y * sa;
        pos[k * 3 + 2] = cz + _w.z * ca + _v.z * sa;
        uv[k * 2] = s * uvScale;
        uv[k * 2 + 1] = j / SIDES;
      }
    }
    const geo = this.rope.geometry;
    geo.attributes.position.needsUpdate = true;
    geo.attributes.uv.needsUpdate = true;
  }
}
