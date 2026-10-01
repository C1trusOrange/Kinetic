/**
 * The robot body that shows another machine's fighter: a BotModel driven by replicated state instead of a BotBrain.
 * Used by RemotePlayer (host: the joined humans) and NetAvatar (client: everyone else). The model maths are copied
 * from Bot._updateModel / _getWeaponModel / _muzzlePosition / onDeath (kept separate so bot feel never changes).
 *
 * Everything here is local presentation derived from the replicated state - pose, weapon, footsteps, jumps, landings,
 * slide / wall-run loops, the grapple rope - and is never mirrored over the network.
 */
import * as THREE from 'three';
import { BotModel } from '../ai/BotModel.js';
import { MOVE } from '../ai/BotConfig.js';
import { createWeaponModel } from '../weapons/WeaponModels.js';
import { WEAPONS } from '../weapons/WeaponDefs.js';
import { clamp, wrapAngle, yawFromDirection } from '../core/utils.js';
import { AvatarRope } from './AvatarRope.js';

/** Movement flags shared by CSTATE (NetCodec CF) and snapshot records (NetCodec EF): bits 1..11 mean the same in both. */
export const MF = Object.freeze({
  GROUND: 1 << 1, CROUCH: 1 << 2, SLIDE: 1 << 3, WALLRUN: 1 << 4, MANTLE: 1 << 5, SPRINT: 1 << 6,
  FIRING: 1 << 7, RELOAD: 1 << 8, BEAM: 1 << 9, CHARGE: 1 << 10, AIM: 1 << 11,
});
/** Grapple states in flags2 bits 0-1. */
export const GRAPPLE = Object.freeze({ IDLE: 0, FLYING: 1, ATTACHED: 2, RETRACT: 3 });

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _org = new THREE.Vector3();
const FIRE_POSE_S = 0.14;
const SOUND_RANGE = { footstep: 26, jump: 22, land: 25, loop: 30 };

let _phGeo = null, _phMat = null;
function placeholderWeapon(id) {
  if (!_phGeo) {
    _phGeo = new THREE.BoxGeometry(0.07, 0.11, 0.62);
    _phMat = new THREE.MeshStandardMaterial({ color: 0x3a4048, roughness: 0.5, metalness: 0.6 });
  }
  const root = new THREE.Group();
  const body = new THREE.Mesh(_phGeo, _phMat);
  body.position.set(0, 0.04, -0.22);
  root.add(body);
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0.06, -0.55);
  root.add(muzzle);
  return { root, muzzle, id, view: false, placeholder: true, parts: {} };
}

const _warned = new Set();

export class Avatar {
  /**
   * @param {object} game
   * @param {{color: number|THREE.Color, team: number, entity: object}} o entity = the RemotePlayer / NetAvatar it shows
   */
  constructor(game, { color, team, entity }) {
    this.game = game;
    this.entity = entity;
    this.model = new BotModel({ color, team });
    this.model.setVisible(false);
    game.scene.add(this.model.root);
    this.bodyYaw = 0;
    this.weaponId = null;
    this._weapons = {};
    this._lodDt = 0;
    this._firingUntil = 0;
    this._state = {
      forwardSpeed: 0, strafeSpeed: 0, speed: 0, onGround: true, crouch: 0, aimPitch: 0, aimYawOffset: 0,
      firing: false, aiming: false, reloading: false, alive: true,
    };
    // derived sounds
    this._px = 0;
    this._pz = 0;
    this._stepDist = 0;
    this._wasGround = true;
    this._lastVy = 0;
    this._minVy = 0;
    this._wasSlide = false;
    this._wasWall = false;
    this._wasMantle = false;
    this._grapple = GRAPPLE.IDLE;
    this._slideLoop = null;
    this._wallLoop = null;
    this.rope = null;
    /** Decorator state slots (Avatar.decorators). */
    this.deco = {};
    const mgr = game.bots;
    if (mgr) {
      // shared batches: shadows drawn instanced, enemy outlines (team read per frame); their roots go after the models
      mgr.shadows.add(this.model);
      mgr.outlines.add(this.model, () => !!game.player && entity.team !== game.player.team);
      if (mgr.shadows.root.parent) mgr.shadows.root.parent.remove(mgr.shadows.root);
      if (mgr.outlines.root.parent) mgr.outlines.root.parent.remove(mgr.outlines.root);
      game.scene.add(mgr.shadows.root);
      game.scene.add(mgr.outlines.root);
    }
  }

  /** Show weapon `id` in the hands (null = none). */
  setWeapon(id) {
    if (id === this.weaponId) return;
    this.weaponId = id;
    if (!id || !WEAPONS[id]) { this.model.setWeapon(null); return; }
    let w = this._weapons[id];
    if (!w) {
      try {
        w = createWeaponModel(id, { view: false, batched: true });
      } catch (err) {
        if (!_warned.has(id)) {
          _warned.add(id);
          console.warn(`[net] createWeaponModel('${id}') failed, using a placeholder:`, err && err.message);
        }
        w = placeholderWeapon(id);
      }
      this._weapons[id] = w;
      const mgr = this.game.bots;
      if (mgr) mgr.shadows.prepareWeapon(w.root);
    }
    this.model.setWeapon(w);
  }

  /** Snap the model to a position / facing (spawn, teleport). */
  place(position, yaw) {
    this.bodyYaw = yaw;
    this.model.root.position.copy(position);
    this.model.root.rotation.y = yaw;
    this.model.reset();
    this._px = position.x;
    this._pz = position.z;
    this._stepDist = 0;
    this._wasGround = true;
    this._lastVy = 0;
  }

  /** @param {boolean} v */
  setVisible(v) {
    this.model.setVisible(v);
    if (!v) {
      this._stopLoops();
      if (this.rope) this.rope.hide();
    }
  }

  get visible() {
    return this.model.root.visible;
  }

  /** World position of the muzzle (fallback: the eye). */
  muzzle(e, out) {
    const m = this.model;
    m.root.position.copy(e.position);
    m.root.rotation.y = this.bodyYaw;
    m.root.updateMatrixWorld(true);
    m.getMuzzleWorldPosition(out);
    if (out.distanceToSquared(e.getEyePosition(_org)) < 9) return out;
    return e.getEyePosition(out);
  }

  /** World position of the free (left) hand on the weapon - where a grapple rope starts. */
  hand(e, out) {
    const m = this.model;
    m.weaponSocket.updateWorldMatrix(true, false);
    return m.weaponSocket.localToWorld(out.copy(m._leftOff));
  }

  /**
   * A shot of `weaponId` along `dir`: muzzle flash (+ its light) and the firing pose.
   * @param {object} e @param {string} weaponId @param {THREE.Vector3} dir
   */
  fireFx(e, weaponId, dir) {
    const def = WEAPONS[weaponId];
    if (!def || !this.visible) return;
    this._firingUntil = this.game.time + FIRE_POSE_S;
    const fl = def.flash;
    if (!fl) return;
    this.muzzle(e, _v);
    this.game.effects.muzzleFlash(_v, dir, { scale: clamp(fl.size / 0.25, 0.6, 1.8), color: fl.color });
  }

  /** Death: the robot breaks apart (gibs), death sound, hidden. */
  die(e, info) {
    const game = this.game;
    const m = this.model;
    this._stopLoops();
    if (this.rope) this.rope.hide();
    if (!m.root.visible) return;
    m.root.position.copy(e.position);
    m.root.rotation.y = this.bodyYaw;
    m.root.updateMatrixWorld(true);
    let meshes = [];
    try {
      meshes = m.breakApart() || [];
    } catch (err) {
      console.error('[net] breakApart failed', err);
    }
    game.effects.gibs(meshes, {
      velocity: e.velocity.clone(),
      direction: info && info.direction ? info.direction.clone() : new THREE.Vector3(0, 1, 0),
      point: info && info.point ? info.point.clone() : e.getChestPosition(new THREE.Vector3()),
    });
    m.setVisible(false);
    game.audio.play('bot_death', { position: e.position.clone() });
  }

  /**
   * Per frame: pose from the entity's replicated state (velocity, flags, aim), level of detail, derived sounds,
   * grapple rope, decorators.
   * @param {number} dt
   * @param {object} e entity with position, velocity, yaw, pitch, height, onGround, alive, netFlags, netFlags2,
   *   grapplePoint (THREE.Vector3), isHuman
   */
  update(dt, e) {
    const m = this.model;
    const game = this.game;
    if (!e.alive || !m.root.visible) {
      this._stopLoops();
      if (this.rope) this.rope.hide();
      return;
    }
    const v = e.velocity;
    const f = e.netFlags | 0;
    const speed = Math.hypot(v.x, v.z);
    const firing = game.time < this._firingUntil || (f & MF.FIRING) !== 0;
    const aiming = (f & MF.AIM) !== 0;

    // body yaw: face the aim while aiming / firing, else the direction of travel (Bot rule)
    let target = e.yaw;
    if (!aiming && !firing && speed > 1.0) target = yawFromDirection(v.x, v.z);
    const diff = wrapAngle(target - this.bodyYaw);
    const rate = 10 * dt;
    this.bodyYaw += clamp(diff, -rate, rate);
    const off = wrapAngle(e.yaw - this.bodyYaw);
    if (off > 1.15) this.bodyYaw = wrapAngle(e.yaw - 1.15);
    else if (off < -1.15) this.bodyYaw = wrapAngle(e.yaw + 1.15);
    this.bodyYaw = wrapAngle(this.bodyYaw);
    m.root.position.copy(e.position);
    m.root.rotation.y = this.bodyYaw;

    this._sounds(dt, e, f, speed);
    this._updateRope(e);
    for (const d of Avatar.decorators) {
      try { d.update(this, e, dt); } catch (err) { console.error('[net] avatar decorator failed', err); }
    }

    // animation LOD: far away or behind the camera the pose refreshes at ~20 Hz (the position stays per frame)
    const net = game.net;
    const cp = net && net.camPos ? net.camPos : game.camera.position;
    const cf = net && net.camFwd ? net.camFwd : null;
    const cx = e.position.x - cp.x, cy = e.position.y - cp.y, cz = e.position.z - cp.z;
    const d2 = cx * cx + cy * cy + cz * cz;
    this._lodDt += dt;
    const behind = cf ? cx * cf.x + cy * cf.y + cz * cf.z < -2 : false;
    if (d2 > 36 && (d2 > 1600 || behind) && ((game.frame + e.id) % 3) !== 0) return;
    dt = this._lodDt;
    this._lodDt = 0;

    const sinY = Math.sin(this.bodyYaw), cosY = Math.cos(this.bodyYaw);
    const s = this._state;
    s.forwardSpeed = -sinY * v.x - cosY * v.z;
    s.strafeSpeed = cosY * v.x - sinY * v.z;
    s.speed = speed;
    // BotModel has no wall-run / slide / grapple / mantle poses: slide -> crouch, the others -> airborne
    const airPose = (f & (MF.WALLRUN | MF.MANTLE)) !== 0 || ((e.netFlags2 | 0) & 3) === GRAPPLE.ATTACHED;
    s.onGround = !!e.onGround && !airPose;
    s.crouch = (f & MF.SLIDE) ? 1 : clamp((1.8 - e.height) / 0.65, 0, 1);
    s.aimPitch = e.pitch;
    s.aimYawOffset = wrapAngle(e.yaw - this.bodyYaw);
    s.firing = firing;
    s.aiming = aiming || firing;
    s.reloading = (f & MF.RELOAD) !== 0;
    s.alive = true;
    m.update(dt, s);
  }

  _near(name, volume, range, rate = 1, pos = null) {
    const p = pos || this.entity.position;
    const cam = this.game.camera.position;
    const dx = cam.x - p.x, dy = cam.y - p.y, dz = cam.z - p.z;
    if (dx * dx + dy * dy + dz * dz > range * range) return;
    this.game.audio.play(name, { position: p, volume, rate });
  }

  _sounds(dt, e, f, speed) {
    const ground = !!e.onGround;
    const vy = e.velocity.y;
    const slide = (f & MF.SLIDE) !== 0;
    // footsteps from the distance actually travelled on the ground
    const dx = e.position.x - this._px, dz = e.position.z - this._pz;
    this._px = e.position.x;
    this._pz = e.position.z;
    const moved = Math.hypot(dx, dz);
    if (ground && !slide && moved < 3 && speed > 1.2) {
      this._stepDist += moved;
      const stride = (f & MF.SPRINT) ? 2.8 : MOVE.stride;
      if (this._stepDist > stride) {
        this._stepDist = 0;
        this._near('footstep', 0.45 + Math.min(0.3, speed * 0.04), SOUND_RANGE.footstep, 0.92 + Math.random() * 0.16);
      }
    }
    if (!ground) this._minVy = Math.min(this._minVy, vy);
    if (this._wasGround && !ground && vy > 3) this._near('jump', 0.5, SOUND_RANGE.jump);
    if (!this._wasGround && ground) {
      const fall = -Math.min(this._minVy, this._lastVy);
      if (fall > 9) this._near(fall > 16 ? 'land_hard' : 'land', 0.6, SOUND_RANGE.land);
      this._minVy = 0;
    }
    if (vy - this._lastVy > 6 && this._nearPad(e.position)) this._near('jumppad', 0.8, SOUND_RANGE.land);
    this._wasGround = ground;
    this._lastVy = vy;

    if (!e.isHuman) return;
    const wall = (f & MF.WALLRUN) !== 0;
    const mantle = (f & MF.MANTLE) !== 0;
    if (slide !== this._wasSlide) {
      this._wasSlide = slide;
      if (slide) this._slideLoop = this._loop('slide', 0.5);
      else this._slideLoop = this._stop(this._slideLoop);
    }
    if (wall !== this._wasWall) {
      this._wasWall = wall;
      if (wall) this._wallLoop = this._loop('wallrun', 0.45);
      else this._wallLoop = this._stop(this._wallLoop);
    }
    if (this._slideLoop) this._slideLoop.setPosition(e.position);
    if (this._wallLoop) this._wallLoop.setPosition(e.position);
    if (mantle && !this._wasMantle) this._near('mantle', 0.6, SOUND_RANGE.jump);
    this._wasMantle = mantle;
    const gs = (e.netFlags2 | 0) & 3;
    if (gs !== this._grapple) {
      const prev = this._grapple;
      this._grapple = gs;
      if (gs === GRAPPLE.FLYING) this._near('grapple_fire', 0.7, SOUND_RANGE.loop);
      else if (gs === GRAPPLE.ATTACHED) this._near('grapple_attach', 0.7, SOUND_RANGE.loop, 1, e.grapplePoint);
      else if (gs === GRAPPLE.RETRACT && prev === GRAPPLE.ATTACHED) this._near('grapple_release', 0.6, SOUND_RANGE.loop);
    }
  }

  _nearPad(p) {
    const pads = this.game.world && this.game.world.jumpPads;
    if (!pads) return false;
    for (const pad of pads) {
      const dx = p.x - pad.position.x, dz = p.z - pad.position.z;
      if (dx * dx + dz * dz < 1.44 + pad.radius * pad.radius && Math.abs(p.y - pad.position.y) < 3) return true;
    }
    return false;
  }

  _loop(name, volume) {
    const cam = this.game.camera.position;
    if (cam.distanceToSquared(this.entity.position) > SOUND_RANGE.loop * SOUND_RANGE.loop) return null;
    const a = this.game.audio;
    const h = a && a.playLoop ? a.playLoop(name, { volume, position: this.entity.position }) : null;
    return h || null;
  }

  _stop(h) {
    if (h) h.stop();
    return null;
  }

  _stopLoops() {
    this._slideLoop = this._stop(this._slideLoop);
    this._wallLoop = this._stop(this._wallLoop);
    this._wasSlide = this._wasWall = false;
    for (const d of Avatar.decorators) {
      if (d.stop) {
        try { d.stop(this); } catch (err) { console.error('[net] avatar decorator stop failed', err); }
      }
    }
  }

  _updateRope(e) {
    const gs = (e.netFlags2 | 0) & 3;
    if (!e.isHuman || (gs !== GRAPPLE.FLYING && gs !== GRAPPLE.ATTACHED) || !e.grapplePoint) {
      if (this.rope) this.rope.hide();
      return;
    }
    if (!this.rope) this.rope = new AvatarRope(this.game);
    this.hand(e, _w);
    this.rope.show(_w, e.grapplePoint);
  }

  dispose() {
    this._stopLoops();
    const mgr = this.game.bots;
    if (mgr) {
      mgr.shadows.remove(this.model);
      mgr.outlines.remove(this.model);
    }
    if (this.rope) { this.rope.dispose(); this.rope = null; }
    for (const id in this._weapons) {
      const w = this._weapons[id];
      if (w && w.root && w.root.parent) w.root.parent.remove(w.root);
    }
    this._weapons = {};
    this.model.dispose();
  }
}

/**
 * Extra per-avatar presentation registered by other packages (mp-arsenal: Tempest beam, Javelin charge glow):
 * {update(avatar, entity, dt), stop?(avatar)}.
 */
Avatar.decorators = [];
