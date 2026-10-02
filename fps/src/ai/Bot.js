import * as THREE from 'three';
import { Capsule } from 'three/addons/math/Capsule.js';
import { Entity } from '../core/Entity.js';
import { GRAVITY, HUMANOID } from '../core/constants.js';
import { clamp, lerp, wrapAngle, randomInCone, randRange, yawFromDirection } from '../core/utils.js';
import { WEAPONS, WEAPON_ORDER, GRENADE } from '../weapons/WeaponDefs.js';
import { newInventory, spawnLoadout, addToInventory } from '../weapons/GrenadeTypes.js';
import { createWeaponModel } from '../weapons/WeaponModels.js';
import { fireArc, beamCadence } from '../weapons/special/arc.js';
import { BotModel } from './BotModel.js';
import { BotBrain } from './BotBrain.js';
import { MOVE, getPreset, DEFAULT_ARSENAL, resolveArsenal, pickArsenalWeapon } from './BotConfig.js';
import { momentumOf, damageScale, rateScale, spreadScale, tracerFor, soundRate } from '../weapons/special/smg.js';
import { fireRail, chargeGlow } from '../weapons/special/rail.js';

const _eye = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _pdir = new THREE.Vector3();
const _muz = new THREE.Vector3();
const _org = new THREE.Vector3();
const _aim = new THREE.Vector3();
const _down = new THREE.Vector3(0, -1, 0);
const _standCapsule = new Capsule(new THREE.Vector3(), new THREE.Vector3(), HUMANOID.radius);

let _placeholderGeo = null;
let _placeholderMat = null;
const _warnedModels = new Set();

/** Minimal stand-in weapon used only when createWeaponModel fails for an id (keeps bots playable). */
function createPlaceholderWeapon(id) {
  if (!_placeholderGeo) {
    _placeholderGeo = new THREE.BoxGeometry(0.07, 0.11, 0.62);
    _placeholderMat = new THREE.MeshStandardMaterial({ color: 0x3a4048, roughness: 0.5, metalness: 0.6 });
  }
  const root = new THREE.Group();
  const body = new THREE.Mesh(_placeholderGeo, _placeholderMat);
  body.position.set(0, 0.04, -0.22);
  root.add(body);
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0.06, -0.55);
  root.add(muzzle);
  const sight = new THREE.Object3D();
  sight.position.set(0, 0.11, -0.1);
  root.add(sight);
  return { root, muzzle, sight, ejectPort: null, hip: new THREE.Vector3(), adsDistance: 0.2, parts: {}, id, view: false, placeholder: true };
}

/**
 * A robot opponent. Owns capsule physics, the weapon inventory (same WEAPONS defs as the player),
 * firing / reloading / grenades, and drives its BotModel. All decisions come from BotBrain.
 */
export class Bot extends Entity {
  /** @param {object} game */
  constructor(game) {
    super(game);
    this.isBot = true;
    this.difficulty = 'normal';
    this.weaponId = 'pistol';
    /** Per-weapon ammo: { id: { mag, reserve } }. */
    this.inv = {};
    /** Owned weapon ids in pickup order. */
    this.owned = [];
    /** Per-type grenade counts (frag / vortex / static / kinetic / smoke), see GrenadeTypes.js. */
    this.nades = newInventory();
    /** @type {BotModel|null} */
    this.model = null;
    /** @type {BotBrain|null} */
    this.brain = null;
    this.preset = getPreset('normal');
    /** Spawn-weapon arsenal in force for this bot (level per weapon, see BotConfig); refreshed on every (re)spawn. */
    this.arsenal = DEFAULT_ARSENAL;

    this.capsule = new Capsule(new THREE.Vector3(), new THREE.Vector3(), HUMANOID.radius);
    this.bodyYaw = 0;
    this.crouch = 0;
    this.speed = 0;
    this.stats = { shots: 0, pelletHits: 0, damage: 0, grenades: 0 };

    // weapon state
    this.reloading = false;
    this.equipUntil = 0;
    this.nextFireAt = 0;
    this._reloadT = 0;
    this._reloadDur = 0;
    this._shellsAdded = 0;
    this._reloadEndAt = -1;
    this._bloom = 0;
    this._firingUntil = 0;
    this._weaponModels = {};
    /** Javelin: game time the current charge began (-1 = not charging); bots charge, then release. */
    this._chargeStart = -1;
    this._chargeSeen = 0;
    this._chargeGlowAt = 0;
    this._chargeLoop = null;

    // locomotion state
    this._pushX = 0;
    this._pushZ = 0;
    this._lastJump = -9;
    this._noSnapUntil = 0;
    this._stepDist = 0;
    this._lastFallSpeed = 0;
    this._lastPrimary = 'rifle';
    this._lodDt = 0;
    // Tempest beam bookkeeping (throttled sound / events / flash)
    this._beamLastT = -10;
    /** End point of the last Tempest beam tick (online: clients draw this bot's beam to it). */
    this.beamEnd = new THREE.Vector3();
    this._arcEventAt = -10;
    this._arcFlashAt = -10;
  }

  /**
   * One-time setup after the manager assigned identity (name / team / color).
   * @param {{name:string, color:number|THREE.Color, team:number, difficulty:string}} o
   */
  setup({ name, color, team, difficulty }) {
    this.name = name;
    this.team = team;
    this.color.set(color);
    this.difficulty = difficulty;
    this.preset = getPreset(difficulty);
    this.model = new BotModel({ color: this.color.clone(), team });
    this.model.setVisible(false);
    this.game.scene.add(this.model.root);
    this.brain = new BotBrain(this, this.preset);
  }

  /** Remove the model from the scene and release per-instance resources. */
  dispose() {
    if (this.model) {
      if (this.model.root.parent) this.model.root.parent.remove(this.model.root);
      for (const id in this._weaponModels) {
        const w = this._weaponModels[id];
        if (w && w.root && w.root.parent) w.root.parent.remove(w.root);
      }
      this.model.dispose();
      this.model = null;
    }
    this._weaponModels = {};
  }

  // ------------------------------------------------------------------ lifecycle

  /**
   * (Re)spawn: resets physics, picks a weighted-random primary weapon, refills ammo.
   * @param {THREE.Vector3} position feet position
   * @param {number} yaw
   */
  spawn(position, yaw = 0) {
    super.spawn(position, yaw);
    const t = this.game.time;
    this.crouch = 0;
    this.height = HUMANOID.height;
    this.eyeHeight = HUMANOID.height - HUMANOID.eyeFromTop;
    this.bodyYaw = yaw;
    this.speed = 0;
    this._pushX = this._pushZ = 0;
    this._noSnapUntil = t + 0.2;
    this._stepDist = 0;
    this._bloom = 0;
    this._firingUntil = 0;
    this._abortCharge();
    this._syncCapsule();

    spawnLoadout(this.nades);
    this.grenades = this.preset.grenades;
    this.inv = {};
    this.owned = [];
    this._addWeaponInternal('pistol');
    const primary = this._pickPrimary();
    if (primary !== 'pistol') this._addWeaponInternal(primary);
    this.weaponId = primary;
    this._lastPrimary = primary;
    this.reloading = false;
    this._reloadEndAt = -1;
    this.equipUntil = t + 0.5;
    this.nextFireAt = t + 0.3;

    if (this.model) {
      this.model.setWeapon(this._getWeaponModel(primary));
      this.model.root.position.copy(this.position);
      this.model.root.rotation.set(0, yaw, 0);
      if (typeof this.model.reset === 'function') this.model.reset();
      this.model.setVisible(true);
    }
    if (this.brain) this.brain.reset();
  }

  /**
   * Weighted-random primary weapon from the match's "Bot arsenal" (game.match.arsenal, else the saved
   * setting). Re-reads the arsenal on every call and remembers it in `this.arsenal`, which
   * `giveWeapon` and the brain's pad logic use. All weapons off -> 'pistol'.
   * @returns {string} weapon id
   */
  _pickPrimary() {
    this.arsenal = resolveArsenal(this.game);
    const lo = this.game.modes && this.game.modes.loadoutFor(this);   // Escalation: the weapon of this bot's tier
    if (lo) return lo.primary;
    return pickArsenalWeapon(this.arsenal);
  }

  /**
   * Escalation tier change: keep the sidearm, replace everything else with `id` at full ammo and draw it.
   * @param {string} id weapon id
   */
  setEscalationWeapon(id) {
    const def = WEAPONS[id];
    if (!def || !this.alive) return false;
    const pistol = this.inv.pistol;
    this.inv = {};
    this.owned = [];
    this._addWeaponInternal('pistol');
    if (pistol) this.inv.pistol = pistol;
    if (id !== 'pistol' && this._addWeaponInternal(id) && Number.isFinite(def.reserveMax)) this.inv[id].reserve = def.reserveMax;
    this.weaponId = '';
    this.selectWeapon(id);
    this._lastPrimary = id;
    if (this.brain) this.brain.intent.weapon = null;
    return true;
  }

  _addWeaponInternal(id) {
    const def = WEAPONS[id];
    if (!def) return false;
    this.inv[id] = { mag: def.magSize, reserve: def.reserveStart };
    this.owned.push(id);
    return true;
  }

  /**
   * Build this bot's (batched) weapon model for every weapon up front, while the match loads: the first model of a
   * weapon kind also builds its shared template, which cost a ~50 ms frame when it happened at a respawn.
   * @param {string[]} [ids] weapon ids (default: all)
   */
  prebuildWeaponModels(ids = WEAPON_ORDER) {
    for (const id of ids) this._getWeaponModel(id);
  }

  /** The prebuilt weapon model of `id` when it is not in the bot's hands (Game.warmup draws it once), else null. */
  spareWeaponModel(id) {
    const w = this._weaponModels[id];
    return w && w.root && !w.root.parent ? w : null;
  }

  _getWeaponModel(id) {
    let w = this._weaponModels[id];
    if (!w) {
      try {
        w = createWeaponModel(id, { view: false, batched: true });
      } catch (err) {
        if (!_warnedModels.has(id)) {
          _warnedModels.add(id);
          console.warn(`[bot] createWeaponModel('${id}') failed, using a placeholder:`, err && err.message);
        }
        w = createPlaceholderWeapon(id);
      }
      this._weaponModels[id] = w;
    }
    return w;
  }

  _syncCapsule() {
    const r = this.radius;
    this.capsule.radius = r;
    this.capsule.start.set(this.position.x, this.position.y + r, this.position.z);
    this.capsule.end.set(this.position.x, this.position.y + this.height - r, this.position.z);
  }

  /** @param {object} info death payload from Combat */
  onDeath(info) {
    super.onDeath(info);
    const game = this.game;
    this.reloading = false;
    this._abortCharge();
    if (this.model) {
      this.model.root.position.copy(this.position);
      this.model.root.rotation.y = this.bodyYaw;
      this.model.root.updateMatrixWorld(true);
      let meshes = [];
      try {
        meshes = this.model.breakApart() || [];
      } catch (err) {
        console.error('[bot] breakApart failed', err);
      }
      const chest = this.getChestPosition(_aim);
      game.effects.gibs(meshes, {
        velocity: this.velocity.clone(),
        direction: info && info.direction ? info.direction.clone() : new THREE.Vector3(0, 1, 0),
        point: info && info.point ? info.point.clone() : chest.clone(),
      });
      this.model.setVisible(false);
    }
    game.audio.play('bot_death', { position: this.position.clone() });
    if (this.brain) this.brain.onDeath(info);
  }

  // ------------------------------------------------------------------ inventory (pickups)

  /**
   * Weapon pickup: new weapon or reserve refill. Returns true if anything changed. A weapon that is
   * switched off in the match's bot arsenal is refused (the pad stays available for the player).
   * @param {string} id
   */
  giveWeapon(id) {
    const def = WEAPONS[id];
    if (!def || !this.alive) return false;
    if (!this.inv[id]) {
      if (this.arsenal[id] === 'off') return false;
      this._addWeaponInternal(id);
      return true;
    }
    return this._refillReserve(id, def.magSize / Math.max(1, def.reserveMax === Infinity ? def.magSize : def.reserveMax));
  }

  _refillReserve(id, fraction) {
    const def = WEAPONS[id];
    const inv = this.inv[id];
    if (!def || !inv || !Number.isFinite(def.reserveMax)) return false;
    if (inv.reserve >= def.reserveMax) return false;
    inv.reserve = Math.min(def.reserveMax, inv.reserve + Math.ceil(def.reserveMax * fraction));
    return true;
  }

  /**
   * Ammo pickup.
   * @param {string|null} id weapon id, or null for all owned weapons
   * @param {number} fraction fraction of reserveMax to add
   */
  addAmmo(id, fraction) {
    if (!this.alive) return false;
    let changed = false;
    if (id) {
      changed = this._refillReserve(id, fraction);
    } else {
      for (const w of this.owned) changed = this._refillReserve(w, fraction) || changed;
    }
    return changed;
  }

  /** Frag count (legacy readers / writers); the full table is `nades`. */
  get grenades() { return this.nades.frag; }
  set grenades(v) { this.nades.frag = Math.max(0, v | 0); }

  /**
   * @param {number} n
   * @param {string} [type='frag']
   */
  addGrenades(n, type = 'frag') {
    if (!this.alive) return false;
    return addToInventory(this.nades, type, n);
  }

  /** Rounds in the current magazine. */
  get ammo() {
    const i = this.inv[this.weaponId];
    return i ? i.mag : 0;
  }

  /** Reserve rounds of the current weapon. */
  get reserve() {
    const i = this.inv[this.weaponId];
    return i ? i.reserve : 0;
  }

  /**
   * Instantly relocate (unstick rescue). Keeps health / ammo; clears velocity and navigation state.
   * @param {THREE.Vector3} position feet position
   * @param {number} yaw
   */
  teleportTo(position, yaw = this.yaw) {
    this.position.copy(position);
    this.velocity.set(0, 0, 0);
    this.yaw = yaw;
    this.bodyYaw = yaw;
    this.pitch = 0;
    this.onGround = false;
    this._pushX = this._pushZ = 0;
    this._noSnapUntil = this.game.time + 0.2;
    this._syncCapsule();
    if (this.model) {
      this.model.root.position.copy(this.position);
      this.model.root.rotation.y = yaw;
      if (typeof this.model.reset === 'function') this.model.reset();
    }
    if (this.brain) this.brain.onTeleport();
  }

  /** True while the equip animation of a just-selected weapon plays. */
  get equipping() {
    return this.game.time < this.equipUntil;
  }

  applyImpulse(v) {
    super.applyImpulse(v);
    // a knock-up, or a hard shove of any direction (> 5 m/s, the player's rule in PlayerController.impulse): airborne
    // for a moment, so ground braking does not eat a Gale / blast shove within a metre and enemies can be pushed off ledges
    if (v.y > 1.5 || v.lengthSq() > 25) {
      this.onGround = false;
      this._noSnapUntil = this.game.time + 0.3;
    }
  }

  launch(v) {
    super.launch(v);
    this._noSnapUntil = this.game.time + 0.35;
  }

  // ------------------------------------------------------------------ per-frame

  /** @param {number} dt seconds */
  update(dt) {
    if (!this.alive || !(dt > 0)) return;
    this.brain.update(dt);
    this._move(dt);
    this._updateWeaponState(dt);
    this._handleWeaponIntent();
    this._updateModel(dt);
  }

  // ------------------------------------------------------------------ locomotion

  _move(dt) {
    const game = this.game;
    const t = game.time;
    const col = game.world.collision;
    const it = this.brain.intent;
    const v = this.velocity;
    const cap = this.capsule;

    this._updateCrouch(dt, it.crouch);

    const shockSlow = this.shockedUntil > t ? 0.35 : 1;   // Static grenade: 35 % speed while shocked
    let wx = it.moveX * it.speed * shockSlow;
    let wz = it.moveZ * it.speed * shockSlow;
    if (this.crouch > 0.4) {
      const s = MOVE.crouch / Math.max(MOVE.crouch, it.speed || 1);
      if (s < 1) { wx *= s; wz *= s; }
    }
    wx += this._pushX;
    wz += this._pushZ;
    this._pushX = 0;
    this._pushZ = 0;

    const wasGround = this.onGround;
    if (wasGround) {
      const k = 1 - Math.exp(-MOVE.groundAccel * dt);
      v.x += (wx - v.x) * k;
      v.z += (wz - v.z) * k;
    } else {
      // Quake-style air control: add speed toward the wish direction up to the wish speed, never brake.
      // (keeps jump-pad arcs and rocket-jump velocity intact while still allowing steering)
      const ws = Math.hypot(wx, wz);
      if (ws > 0.05) {
        const ux = wx / ws, uz = wz / ws;
        const add = ws - (v.x * ux + v.z * uz);
        if (add > 0) {
          const a = Math.min(add, MOVE.airAccel * dt);
          v.x += ux * a;
          v.z += uz * a;
        }
      }
    }

    let grounded = wasGround;
    if (it.jump && grounded && t - this._lastJump > 0.35 && this.crouch < 0.3) {
      v.y = MOVE.jump;
      grounded = false;
      this._lastJump = t;
      this._noSnapUntil = t + 0.25;
      this._playNear('jump', 0.5, 22);
    }
    // gravity always applies: standing / walking bots are pressed into the floor a hair each frame, so contact
    // detection reports "on ground" without a ground ray (v.y is zeroed again below when grounded)
    v.y = Math.max(v.y - GRAVITY * dt, -MOVE.terminal);
    const fallSpeed = wasGround ? 0 : -v.y;

    const gx = v.x, gz = v.z;
    const res = col.moveCapsule(cap, v, dt);
    // Grounded follows contact with a walkable surface. It cannot be tested through v.y: on a slope the projected
    // velocity keeps an upward component. Ignored right after a jump / launch / knock-up.
    let nowGround = res.onGround && t >= this._noSnapUntil;
    if (nowGround) {
      if (!res.hitWall) {
        // keep the intended horizontal velocity on slopes (the collision projection would bleed speed)
        v.x = gx;
        v.z = gz;
      }
      v.y = 0;
    }
    if (!nowGround && grounded && v.y <= 0.1 && t >= this._noSnapUntil) {
      const gap = this._probeGround(0.35);
      if (gap >= 0) {
        if (gap > 0.004) {
          cap.start.y -= gap;
          cap.end.y -= gap;
        }
        nowGround = true;
        v.y = 0;
      }
    }
    if (nowGround && !wasGround) {
      v.y = 0;
      if (fallSpeed > 9) this._playNear(fallSpeed > 16 ? 'land_hard' : 'land', 0.6, 25);
    }
    this.onGround = nowGround;
    if (res.hitCeiling && v.y > 0) v.y = 0;

    this.position.set(cap.start.x, cap.start.y - cap.radius, cap.start.z);
    this.speed = Math.hypot(v.x, v.z);

    if (nowGround && this.speed > 1.2) {
      this._stepDist += this.speed * dt;
      if (this._stepDist > MOVE.stride) {
        this._stepDist = 0;
        this._playNear('footstep', 0.45 + Math.min(0.3, this.speed * 0.04), 26, 0.92 + Math.random() * 0.16);
      }
    }
  }

  /** Vertical gap to walkable ground below the capsule (one ray), or -1 when none within maxDrop. */
  _probeGround(maxDrop) {
    const cap = this.capsule;
    const r = cap.radius;
    _org.copy(cap.start);
    const hit = this.game.world.collision.raycast(_org, _down, r + maxDrop + 0.1);
    if (!hit || hit.normal.y < 0.65) return -1;
    const gap = hit.distance - r / hit.normal.y;
    return gap > maxDrop ? -1 : Math.max(0, gap);
  }

  _updateCrouch(dt, want) {
    let c = this.crouch;
    if (want) c = Math.min(1, c + dt * 7);
    else if (c > 0 && this._canStand()) c = Math.max(0, c - dt * 7);
    if (c !== this.crouch) {
      this.crouch = c;
      const h = lerp(HUMANOID.height, HUMANOID.crouchHeight, c);
      this.height = h;
      this.eyeHeight = h - HUMANOID.eyeFromTop;
      this.capsule.end.set(this.capsule.start.x, this.capsule.start.y + h - 2 * this.capsule.radius, this.capsule.start.z);
    }
  }

  _canStand() {
    const cap = this.capsule;
    _standCapsule.radius = cap.radius;
    _standCapsule.start.copy(cap.start);
    _standCapsule.end.set(cap.start.x, cap.start.y + HUMANOID.height - 2 * cap.radius, cap.start.z);
    const r = this.game.world.collision.capsuleIntersect(_standCapsule);
    return !r || !(r.depth > 0.02);
  }

  _playNear(name, volume, range, rate = 1) {
    const cam = this.game.camera.position;
    const dx = cam.x - this.position.x, dy = cam.y - this.position.y, dz = cam.z - this.position.z;
    if (dx * dx + dy * dy + dz * dz > range * range) return;
    this.game.audio.play(name, { position: this.position, volume, rate });
  }

  // ------------------------------------------------------------------ weapons

  /**
   * Switch weapon (starts the equip delay, cancels a reload).
   * @param {string} id
   * @returns {boolean} true if switched
   */
  selectWeapon(id) {
    if (id === this.weaponId || !this.inv[id]) return false;
    const def = WEAPONS[id];
    this._abortCharge();
    this.weaponId = id;
    this.reloading = false;
    this._reloadEndAt = -1;
    this.equipUntil = this.game.time + (def.equipTime || 0.35);
    this._bloom = 0;
    if (this.model) this.model.setWeapon(this._getWeaponModel(id));
    this._playNear('weapon_switch', 0.5, 20);
    return true;
  }

  /** Begin reloading the current weapon. @returns {boolean} true if a reload started */
  startReload() {
    if (this.reloading) return false;
    const def = WEAPONS[this.weaponId];
    const inv = this.inv[this.weaponId];
    if (!def || !inv || inv.mag >= def.magSize || inv.reserve <= 0) return false;
    this._abortCharge();
    this.reloading = true;
    this._reloadT = 0;
    this._shellsAdded = 0;
    this._reloadEndAt = -1;
    this._reloadDur = def.reloadTime + (inv.mag === 0 ? (def.reloadEmptyExtra || 0) : 0);
    this._playNear('reload_start', 0.5, 22);
    return true;
  }

  /** Stop a (shell) reload, keeping shells already loaded. */
  cancelReload() {
    this.reloading = false;
    this._reloadEndAt = -1;
  }

  _updateWeaponState(dt) {
    const def = WEAPONS[this.weaponId];
    const inv = this.inv[this.weaponId];
    if (!def || !inv) return;
    // spread bloom recovery
    if (this._bloom > 0) this._bloom = Math.max(0, this._bloom - (def.spread ? def.spread.recovery : 0.1) * dt);

    if (!this.reloading) return;
    this._reloadT += dt;
    if (def.reloadMode === 'shell') {
      const start = def.reloadStart ?? 0.4, per = def.shellTime ?? 0.45, end = def.reloadEnd ?? 0.3;
      while (this._reloadEndAt < 0 && inv.mag < def.magSize && inv.reserve > 0
        && this._reloadT >= start + (this._shellsAdded + 1) * per) {
        inv.mag++;
        if (Number.isFinite(inv.reserve)) inv.reserve--;
        this._shellsAdded++;
        this._playNear('reload_insert', 0.45, 20);
      }
      if (this._reloadEndAt < 0 && (inv.mag >= def.magSize || inv.reserve <= 0)) this._reloadEndAt = this._reloadT + end;
      if (this._reloadEndAt >= 0 && this._reloadT >= this._reloadEndAt) {
        this.reloading = false;
        this._reloadEndAt = -1;
        this._playNear('reload_end', 0.5, 20);
      }
    } else if (this._reloadT >= this._reloadDur) {
      const take = Math.min(def.magSize - inv.mag, inv.reserve);
      inv.mag += take;
      if (Number.isFinite(inv.reserve)) inv.reserve -= take;
      this.reloading = false;
      this._playNear('reload_end', 0.5, 20);
    }
  }

  _handleWeaponIntent() {
    const it = this.brain.intent;
    if (it.weapon) {
      this.selectWeapon(it.weapon);
      it.weapon = null;
    }
    const def = WEAPONS[this.weaponId];
    const inv = this.inv[this.weaponId];
    if (!def || !inv) return;
    if (this.reloading && it.fire && def.reloadMode === 'shell' && inv.mag > 0) this.cancelReload();
    if (!this.reloading && (it.reload || inv.mag <= 0)) this.startReload();
    if (it.fire && this.shockedUntil <= this.game.time) this.tryFire();   // shocked bots cannot fire
    else if (this._chargeStart >= 0 && this.game.time - this._chargeSeen > 0.6) this._abortCharge();
  }

  /** True while a Javelin charge is building (the brain keeps the bot still). */
  get charging() { return this._chargeStart >= 0; }

  /** Cancel a charge without firing (no ammo spent). */
  _abortCharge() {
    this._chargeStart = -1;
    if (this._chargeLoop) { this._chargeLoop.stop(); this._chargeLoop = null; }
  }

  /**
   * Javelin: charge (cyan muzzle glow + rising whine = the victim's warning), then release once `def.bot.charge` seconds have passed.
   * @returns {boolean} true while charging or after the shot
   */
  _chargeAndFire(def, inv) {
    const game = this.game;
    const t = game.time;
    const muzzle = this._muzzlePosition(_muz);
    this._chargeSeen = t;
    if (this._chargeStart < 0) {
      this._chargeStart = t;
      this._chargeGlowAt = 0;
      this._chargeLoop = game.audio.playLoop(def.chargeSound || 'rail_charge', { volume: 0.7, rate: 0.7, position: muzzle });
    }
    const held = t - this._chargeStart;
    const need = def.bot && def.bot.charge ? def.bot.charge : 0.95;
    const frac = clamp(held / def.charge.time, 0, 1);
    if (this._chargeLoop) { this._chargeLoop.setRate(0.7 + 1.5 * frac); this._chargeLoop.setPosition(muzzle); }
    if (t >= this._chargeGlowAt) {
      this._chargeGlowAt = t + 0.15;
      chargeGlow(game, muzzle, this.getAimDirection(_dir), frac);
    }
    if (held >= need) {
      const power = frac;
      this._abortCharge();
      this._fire(def, inv, power);
    }
    return true;
  }

  /** Fire the current weapon if allowed (ammo, cooldown, equip, reload). @returns {boolean} */
  tryFire() {
    const game = this.game;
    const t = game.time;
    const def = WEAPONS[this.weaponId];
    const inv = this.inv[this.weaponId];
    if (!def || !inv || this.reloading || t < this.nextFireAt || t < this.equipUntil || inv.mag <= 0) return false;
    if (def.charge) return this._chargeAndFire(def, inv);
    this._fire(def, inv);
    return true;
  }

  _muzzlePosition(out) {
    const m = this.model;
    if (m) {
      m.root.position.copy(this.position);
      m.root.rotation.y = this.bodyYaw;
      m.root.updateMatrixWorld(true);
      m.getMuzzleWorldPosition(out);
      // guard against a degenerate model (muzzle far from the eye)
      if (out.distanceToSquared(this.getEyePosition(_org)) < 9) return out;
    }
    return this.getEyePosition(out);
  }

  _fire(def, inv, power = 1) {
    const game = this.game;
    const t = game.time;
    const eye = this.getEyePosition(_eye);
    const dir = this.getAimDirection(_dir);
    const muzzle = this._muzzlePosition(_muz);
    const scale = this.preset.damageScale;
    const mom = def.speedBonus ? momentumOf(def, this.speed) : 0;   // Slipstream: speed feeds damage / spread / rate
    const sp = def.spread || { hip: 0.02, ads: 0.004, moving: 0.03, air: 0.04, perShot: 0, max: 0.06, recovery: 0.1 };

    // spread: bots aim "mostly steady": pattern weapons use hip spread, single bullets lean toward ads
    const hSpeed = this.speed;
    let base = sp.ads + (sp.hip - sp.ads) * (def.pellets > 1 ? 1 : 0.4);
    base += (sp.moving - sp.hip) * 0.5 * clamp(hSpeed / MOVE.run, 0, 1);
    if (!this.onGround) base += (sp.air - sp.hip) * 0.3;
    if (this.crouch > 0.5) base *= 0.75;
    const spread = (base + this._bloom) * this.preset.spreadScale * spreadScale(def, mom);

    this.stats.shots++;
    if (def.kind === 'beam') { this._fireBeam(def, inv, eye, dir, muzzle, spread, scale); return; }
    if (def.kind === 'blast') { this._fireBlast(def, inv, eye, dir, muzzle); return; }
    if (def.kind === 'projectile' && def.projectile) {
      const p = def.projectile;
      // converge on the point the crosshair rests on (like the player), launched from the muzzle
      const wall = game.world.raycast(eye, dir, 80);
      const dist = wall ? wall.distance : 80;
      _aim.copy(eye).addScaledVector(dir, dist);
      _org.copy(muzzle);
      if (!game.combat.canSee(eye, _org)) _org.copy(eye).addScaledVector(dir, Math.max(0.1, Math.min(0.6, dist - 0.3)));
      _pdir.subVectors(_aim, _org);
      if (_pdir.lengthSq() < 0.01) _pdir.copy(dir); else _pdir.normalize();
      randomInCone(_pdir, spread, _pdir);
      game.projectiles.spawnRocket({
        owner: this,
        origin: _org,
        direction: _pdir,
        speed: p.speed,
        damage: def.damage * scale,
        splashDamage: p.splashDamage * scale,
        radius: p.splashRadius,
      });
    } else if (def.charge) {
      randomInCone(dir, spread, _pdir);
      fireRail(game, this, { origin: eye, dir: _pdir, muzzle, def, power, dmgScale: scale });
    } else {
      const tracers = def.pellets > 3 ? 3 : def.pellets;
      for (let i = 0; i < def.pellets; i++) {
        randomInCone(dir, spread, _pdir);
        const hit = game.combat.fireBullet({
          shooter: this,
          origin: eye,
          direction: _pdir,
          damage: def.damage * scale * damageScale(def, mom),
          weapon: def.id,
          range: def.range,
          headshotMult: def.headshotMult,
          falloff: def.falloff || undefined,
          tracerFrom: i < tracers ? muzzle : null,
          tracerColor: tracerFor(def, mom),
        });
        if (hit && hit.entity) this.stats.pelletHits++;
      }
    }

    game.audio.play(def.sound, { position: muzzle, rate: soundRate(def, mom) });
    const fl = def.flash;
    game.effects.muzzleFlash(muzzle, dir, { scale: fl ? clamp(fl.size / 0.25, 0.6, 1.8) : 1, color: fl ? fl.color : def.tracerColor });
    game.events.emit('weapon:fire', { shooter: this, weapon: def.id, origin: eye.clone(), direction: dir.clone() });

    inv.mag--;
    let interval = 1 / Math.max(0.1, def.fireRate * rateScale(def, mom));
    interval *= randRange(0.96, 1.14);
    this.nextFireAt = t + interval;
    this._firingUntil = t + 0.14;
    if (sp.perShot) this._bloom = Math.min(Math.max(0, sp.max - base), this._bloom + sp.perShot);
    const rc = def.recoil || { pitch: 0.01, yaw: 0.003 };
    this.brain.kick(rc.pitch * 0.75, (Math.random() * 2 - 1) * rc.yaw * 1.5);
    this.brain.onShot();
  }

  /** Tempest tick (24 Hz): damage + chain + beam visual via special/arc.js, with throttled sound / muzzle flash / event. */
  _fireBeam(def, inv, eye, dir, muzzle, spread, scale) {
    const game = this.game;
    const t = game.time;
    // exact tick rate at any frame rate: a late frame applies up to 3 owed ticks at once (damage x n, ammo - n)
    const cad = beamCadence(t, this.nextFireAt, this._beamLastT, 1 / def.fireRate);
    randomInCone(dir, spread, _pdir);
    const res = fireArc(game, this, { origin: eye, dir: _pdir, muzzle, def, dmgScale: scale * cad.n });
    this.beamEnd.copy(eye).addScaledVector(_pdir, res.dist);
    if (res.hit && res.hit.entity) this.stats.pelletHits++;
    if (t - this._beamLastT > 0.2) game.audio.play('arc_burst', { position: muzzle });      // a new burst (cd 0.3 s in the sound)
    this._beamLastT = t;
    if (t - this._arcFlashAt > 0.12) {
      this._arcFlashAt = t;
      game.effects.muzzleFlash(muzzle, dir, { scale: 0.7, color: def.flash.color });
    }
    if (t - this._arcEventAt >= def.beam.eventInterval) {
      this._arcEventAt = t;
      game.events.emit('weapon:fire', { shooter: this, weapon: def.id, origin: eye.clone(), direction: dir.clone() });
    }
    inv.mag = Math.max(0, inv.mag - cad.n);
    this.nextFireAt = cad.next;             // no random interval jitter for a continuous beam
    this._firingUntil = t + 0.14;
    this.brain.onShot();
  }

  /** Gale blast: cone shove / reflect via combat.blast (bots get the same small self push as the player). */
  _fireBlast(def, inv, eye, dir, muzzle) {
    const game = this.game;
    const t = game.time;
    const b = def.blast;
    game.combat.blast(this, eye, dir, b, false);
    game.effects.galeBlast(muzzle, dir, { range: b.range, halfAngle: b.halfAngle });
    game.audio.play(def.sound, { position: muzzle });
    game.events.emit('weapon:fire', { shooter: this, weapon: def.id, origin: eye.clone(), direction: dir.clone() });
    inv.mag--;
    this.nextFireAt = t + (1 / Math.max(0.1, def.fireRate)) * randRange(0.96, 1.14);
    this._firingUntil = t + 0.3;
    this.brain.kick(def.recoil.pitch * 0.75, (Math.random() * 2 - 1) * def.recoil.yaw * 1.5);
    this.brain.onShot();
  }

  /**
   * Throw a grenade.
   * @param {THREE.Vector3} velocity launch velocity
   * @param {number} fuse seconds until detonation
   * @param {string} [type='frag'] grenade type
   * @returns {boolean} thrown
   */
  throwGrenade(velocity, fuse, type = 'frag') {
    if (!(this.nades[type] > 0) || !this.alive) return false;
    const game = this.game;
    const eye = this.getEyePosition(_eye);
    _dir.copy(velocity).normalize();
    // keep the spawn point out of walls
    const wall = game.world.raycast(eye, _dir, 0.6);
    const off = wall ? Math.max(0.05, wall.distance - 0.2) : 0.45;
    _org.copy(eye).addScaledVector(_dir, off);
    game.projectiles.spawnGrenade({ owner: this, origin: _org, velocity: velocity.clone(), fuse, type });
    this.nades[type]--;
    this.stats.grenades++;
    this._firingUntil = game.time + 0.4;
    this._playNear('grenade_throw', 0.7, 30);
    return true;
  }

  // ------------------------------------------------------------------ model

  _updateModel(dt) {
    const m = this.model;
    if (!m) return;
    const game = this.game;
    const t = game.time;
    const v = this.velocity;
    const brain = this.brain;

    // body yaw: face the aim while fighting, otherwise face the direction of travel
    let target = this.yaw;
    if (!brain.faceAim && this.speed > 1.0) target = yawFromDirection(v.x, v.z);
    const diff = wrapAngle(target - this.bodyYaw);
    const rate = 10 * dt;
    this.bodyYaw += clamp(diff, -rate, rate);
    const off = wrapAngle(this.yaw - this.bodyYaw);
    const maxOff = 1.15;
    if (off > maxOff) this.bodyYaw = wrapAngle(this.yaw - maxOff);
    else if (off < -maxOff) this.bodyYaw = wrapAngle(this.yaw + maxOff);
    this.bodyYaw = wrapAngle(this.bodyYaw);

    m.root.position.copy(this.position);
    m.root.rotation.y = this.bodyYaw;

    // animation LOD: far away or behind the camera the pose is refreshed at ~20 Hz (position stays per-frame)
    const mgr = game.bots;
    const cp = mgr.camPos, cf = mgr.camFwd;
    const cx = this.position.x - cp.x, cy = this.position.y - cp.y, cz = this.position.z - cp.z;
    const d2 = cx * cx + cy * cy + cz * cz;
    this._lodDt += dt;
    if (d2 > 36 && (d2 > 1600 || cx * cf.x + cy * cf.y + cz * cf.z < -2) && ((mgr.frameCount + this.id) % 3) !== 0) return;
    dt = this._lodDt;
    this._lodDt = 0;

    const sinY = Math.sin(this.bodyYaw), cosY = Math.cos(this.bodyYaw);
    const forwardSpeed = -sinY * v.x - cosY * v.z;
    const strafeSpeed = cosY * v.x - sinY * v.z;
    m.update(dt, {
      forwardSpeed,
      strafeSpeed,
      speed: this.speed,
      onGround: this.onGround,
      crouch: this.crouch,
      aimPitch: this.pitch,
      aimYawOffset: wrapAngle(this.yaw - this.bodyYaw),
      firing: t < this._firingUntil,
      aiming: brain.faceAim || t < this._firingUntil,
      reloading: this.reloading,
      alive: this.alive,
    });
  }
}
