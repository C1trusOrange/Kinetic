import * as THREE from 'three';
import { GRENADE_TYPES, GRENADE_ORDER, GRENADE_SPECIALS } from './WeaponDefs.js';
import { GrenadeFX } from '../fx/GrenadeFX.js';

/**
 * Grenade types beyond the frag: inventory helpers (shared by the player's WeaponSystem, bots and pickups) and
 * GrenadeSystem, which owns the behaviour of the special grenades on top of the Projectiles physics:
 *
 *  - Vortex   sticks to the first surface, becomes a gravity well (pulls + peels off the floor + crushes players, bots,
 *             rockets and grenades) and collapses into an outward fling.
 *  - Static   cookable chain-shock: arcs to the nearest enemies in line of sight, damages and SHOCKS them.
 *  - Kinetic  displacement blast (real knockback, little damage, wall-slam "splat" damage afterwards).
 *  - Smoke    a smoke volume that blocks bot vision (Combat.smokes / canSee({smoke:true})) and veils the player's view.
 */

// ------------------------------------------------------------------ inventory helpers

/** A fresh per-type grenade count table. */
export function newInventory() {
  const inv = {};
  for (const t of GRENADE_ORDER) inv[t] = 0;
  return inv;
}

/**
 * Spawn grenades (a loadout pool's `grenades` option, see Loadout.js). Overwrites every count of `inv`.
 *   'standard' (default, also any unknown mode)  frag 2 + smoke 1 + one of vortex / static / kinetic: `special` when
 *              given (e.g. decided by a multiplayer host), else random
 *   'frag'     the frag start count only
 *   'none'     no grenades
 * @param {Record<string, number>} inv per-type count table
 * @param {string} [mode='standard']
 * @param {string|null} [special] vortex | static | kinetic
 * @returns {Record<string, number>} inv
 */
export function spawnLoadout(inv, mode = 'standard', special = null) {
  if (mode === 'none' || mode === 'frag') {
    for (const t of GRENADE_ORDER) inv[t] = mode === 'frag' && t === 'frag' ? GRENADE_TYPES.frag.start || 0 : 0;
    return inv;
  }
  for (const t of GRENADE_ORDER) inv[t] = GRENADE_TYPES[t].start || 0;
  const pool = GRENADE_SPECIALS.filter(t => t !== 'smoke');
  const pick = pool.includes(special) ? special : pool[(Math.random() * pool.length) | 0];
  inv[pick] = Math.max(inv[pick], 1);
  return inv;
}

/** Add `n` grenades of a type up to its max carry. @returns {boolean} true if any were added */
export function addToInventory(inv, type, n = 1) {
  const def = GRENADE_TYPES[type];
  if (!def) return false;
  const before = inv[type] | 0;
  inv[type] = Math.min(def.maxCarry, before + Math.max(1, n | 0));
  return inv[type] > before;
}

/** Next type (in HUD order, wrapping) that has stock; `current` when nothing else is held. */
export function nextHeldType(inv, current, dir = 1) {
  const n = GRENADE_ORDER.length;
  const i0 = Math.max(0, GRENADE_ORDER.indexOf(current));
  for (let k = 1; k <= n; k++) {
    const t = GRENADE_ORDER[(i0 + dir * k + n * k) % n];
    if (t !== current && inv[t] > 0) return t;
  }
  return current;
}

/** Total grenades held. */
export function totalGrenades(inv) {
  let s = 0;
  for (const t of GRENADE_ORDER) s += inv[t] | 0;
  return s;
}

/** The per-type table of any entity (the player's lives in WeaponSystem). */
export function inventoryOf(entity) {
  if (!entity) return null;
  if (entity.isPlayer) return entity.game.weapons ? entity.game.weapons.nades : null;
  return entity.nades || null;
}

/**
 * Grenade crate: `amount` frag plus one special (the pickup's `extra` type, else random among the types the
 * collector still has room for). Records what was given in `pickup.lastGrant` for the HUD toast.
 * @returns {boolean} true if anything was consumed
 */
export function grantCrate(entity, pickup) {
  const inv = inventoryOf(entity);
  const fragBefore = inv ? inv.frag : 0;
  let any = !!entity.addGrenades(pickup.amount ?? 2, 'frag');
  const fragGot = inv ? inv.frag - fragBefore : (pickup.amount ?? 2);
  let special = null;
  if (inv) {
    const pinned = pickup.extra && GRENADE_TYPES[pickup.extra] && pickup.extra !== 'frag' ? pickup.extra : null;
    if (pinned) {
      if (inv[pinned] < GRENADE_TYPES[pinned].maxCarry) special = pinned;
    } else {
      const room = GRENADE_SPECIALS.filter(t => inv[t] < GRENADE_TYPES[t].maxCarry);
      if (room.length) special = room[(Math.random() * room.length) | 0];
    }
  }
  if (special && entity.addGrenades(1, special)) any = true; else special = null;
  pickup.lastGrant = { frag: fragGot, special };
  return any;
}

// ------------------------------------------------------------------ scratch

const UP = new THREE.Vector3(0, 1, 0);
const _center = new THREE.Vector3();
const _origin = new THREE.Vector3();
const _chest = new THREE.Vector3();
const _d = new THREE.Vector3();
const _lift = new THREE.Vector3();

const hostileTo = (owner, e) => e !== owner && !(owner && owner.team === e.team);

// ------------------------------------------------------------------ the system

export class GrenadeSystem {
  /**
   * @param {object} game
   * @param {import('./Projectiles.js').Projectiles} projectiles
   */
  constructor(game, projectiles) {
    this.game = game;
    this.proj = projectiles;
    this.fx = new GrenadeFX(game);
    /** Deployed vortex grenades (references into projectiles.grenades). */
    this.wells = [];
    /** Entities recently knocked by a Kinetic Charge: {e, until, prevH, peakH, owner}. */
    this.splats = [];
    this._zapT = 0;
  }

  init() {
    this.fx.init();
  }

  clear() {
    this.wells.length = 0;
    this.splats.length = 0;
    if (this.game.combat) this.game.combat.smokes.length = 0;
    this.fx.clear();
  }

  // ------------------------------------------------------------------ grenade lifecycle hooks (Projectiles)

  /** Free per-grenade resources (rig, loop) when a grenade leaves the pool. */
  onRelease(g) {
    if (g.loop) { g.loop.stop(); g.loop = null; }
    this.fx.vortexRelease(g);
    const i = this.wells.indexOf(g);
    if (i >= 0) this.wells.splice(i, 1);
    g.state = 'flight';
  }

  /** Vortex touched a surface (or its flight timed out: `hit` null). */
  stick(g, hit) {
    g.state = 'deploy';
    g.stateT = 0;
    g.liftT = 0;
    g.crushT = 0;
    if (hit) {
      g.position.copy(hit.point).addScaledVector(hit.normal, 0.12);
      g.normal.copy(hit.normal);
    } else {
      g.normal.set(0, 1, 0);
    }
    g.velocity.set(0, 0, 0);
    g.resting = true;
    g.center.copy(g.position).addScaledVector(g.normal, hit ? 0.9 : 0);
    g.group.position.copy(g.position);
    g.fuse = g.def.deploy + g.def.duration;
    this.wells.push(g);
    this.fx.vortexAcquire(g);
    if (hit) this.fx.vortexStick(g);          // scorch decal only on a real surface
    this.game.audio.play('vortex_deploy', { position: g.center });
  }

  /**
   * Per-frame update of a stuck vortex. Returns 0 (keep) or 1 (collapse now).
   */
  updateStuck(g, dt) {
    g.age += dt;
    g.stateT += dt;
    const def = g.def;
    if (g.state === 'deploy') {
      g.fuse = def.deploy + def.duration - g.stateT;
      if (g.stateT >= def.deploy) {
        g.state = 'active';
        g.stateT = 0;
        g.model.visible = false;
        g.glow.visible = false;
        g.loop = this.game.audio.playLoop('vortex_loop', { position: g.center, volume: 1, rate: 0.8 });
      }
      this.fx.vortexTick(g, dt);
      return 0;
    }
    g.fuse = def.duration - g.stateT;
    if (g.loop) {
      g.loop.setRate(0.8 + 0.8 * (g.stateT / def.duration));
      g.loop.setPosition(g.center);
    }
    this._vortexActive(g, dt);
    this.fx.vortexTick(g, dt);
    return g.stateT >= def.duration ? 1 : 0;
  }

  /** Flight timed out over a void: deploy where it is. */
  deployInAir(g) {
    this.stick(g, null);
  }

  _vortexActive(g, dt) {
    const game = this.game;
    const def = g.def;
    const center = g.center;
    const R = def.radius;
    const owner = g.owner;
    g.liftT += dt;
    const doLift = g.liftT >= def.lift.every;
    if (doLift) g.liftT = 0;
    g.crushT += dt;
    const doCrush = g.crushT >= 0.25;
    if (doCrush) g.crushT -= 0.25;

    const ents = game.entities;
    for (let i = 0; i < ents.length; i++) {
      const e = ents[i];
      if (!e.alive) continue;
      e.getChestPosition(_chest);
      _d.subVectors(center, _chest);
      const d = _d.length();
      if (d > R || d < 0.05) continue;
      _d.multiplyScalar(1 / d);
      const k = Math.pow(1 - d / R, 0.8);
      const accel = def.pull * k;
      const v = e.velocity;
      const vt = v.x * _d.x + v.y * _d.y + v.z * _d.z;
      // grounded players fight ground friction (7 /s), so the pull is boosted there; bots use the wish-velocity nudge below
      const boost = e.isPlayer && e.onGround ? 3 : 1;
      const add = Math.min(accel * boost * dt, Math.max(0, def.maxPullSpeed - vt));
      if (e.onGround) {
        // direct velocity add (ground friction of applyImpulse is bypassed); bots also get a wish-velocity nudge
        const h = Math.hypot(_d.x, _d.z);
        if (h > 0.01) {
          v.x += (_d.x / h) * add;
          v.z += (_d.z / h) * add;
          if (e.isBot) {
            e._pushX += (_d.x / h) * def.maxPullSpeed * k * 0.85;
            e._pushZ += (_d.z / h) * def.maxPullSpeed * k * 0.85;
          }
        }
      } else {
        v.x += _d.x * add;
        v.y += _d.y * add;
        v.z += _d.z * add;
      }
      // swirl
      const sw = accel * 0.28 * dt;
      v.x += -_d.z * sw;
      v.z += _d.x * sw;
      // peel grounded entities off the floor in the inner band
      if (doLift && e.onGround && d <= def.lift.radius) e.applyImpulse(_lift.set(0, def.lift.impulseY, 0));
      // crush in the core
      if (doCrush && d <= def.crush.radius) {
        game.combat.applyDamage(e, {
          amount: def.crush.dps * 0.25 * (e === owner ? def.selfScale : 1), attacker: owner, weapon: 'vortex',
          point: _chest.clone(), direction: _d.clone(),
        });
      }
    }

    // other projectiles: grenades orbit / fall in, rockets curve into the core
    const grens = this.proj.grenades;
    for (let i = 0; i < grens.length; i++) {
      const o = grens[i];
      if (o === g || (o.state && o.state !== 'flight')) continue;
      _d.subVectors(center, o.position);
      const d = _d.length();
      if (d > R || d < 0.05) continue;
      _d.multiplyScalar(1 / d);
      const k = Math.pow(1 - d / R, 0.8);
      const a = def.pull * k * dt;
      o.velocity.addScaledVector(_d, a);
      o.velocity.x += -_d.z * a * 0.5;
      o.velocity.z += _d.x * a * 0.5;
      o.resting = false;
    }
    const rockets = this.proj.rockets;
    for (let i = 0; i < rockets.length; i++) {
      const r = rockets[i];
      _d.subVectors(center, r.position);
      const d = _d.length();
      if (d > R || d < 0.05) continue;
      _d.multiplyScalar(1 / d);
      const k = 1 - d / R;
      r.direction.lerp(_d, Math.min(1, 10 * k * dt)).normalize();
    }
  }

  // ------------------------------------------------------------------ detonation

  /**
   * A special grenade went off (fuse ran out / popped / collapsed). `g` is the (already released) pooled entry.
   * @param {string} type
   * @param {THREE.Vector3} position contact point
   * @param {THREE.Vector3} normal contact normal
   * @param {object|null} owner
   * @param {object|null} g
   */
  detonate(type, position, normal, owner, g = null) {
    switch (type) {
      case 'vortex': this._vortexCollapse(g ? g.center : position, owner); break;
      case 'static': this._staticBurst(position, normal, owner); break;
      case 'kinetic': this._kineticBlast(position, normal, owner); break;
      case 'smoke': this._smokePop(position, normal, owner); break;
      default: break;
    }
  }

  _vortexCollapse(centerIn, owner) {
    const game = this.game;
    const def = GRENADE_TYPES.vortex;
    const c = def.collapse;
    _center.copy(centerIn);
    game.combat.radialDamage(_center, {
      radius: c.radius, damage: c.damage, attacker: owner, weapon: 'vortex', knockback: c.knockback, selfScale: def.selfScale,
    });
    this.fx.vortexCollapse(_center, c.radius);
    game.audio.play('vortex_collapse', { position: _center });
    game.events.emit('explosion', { position: _center.clone(), radius: c.radius, owner, weapon: 'vortex' });
  }

  _staticBurst(position, normal, owner) {
    const game = this.game;
    const def = GRENADE_TYPES.static;
    const R = def.radius;
    _center.copy(position).addScaledVector(normal, 0.15);
    _origin.copy(_center);
    _origin.y += 0.3;
    const list = [];
    for (const e of game.entities) {
      if (!e.alive || e === owner || !hostileTo(owner, e)) continue;
      e.getChestPosition(_chest);
      const d = _chest.distanceTo(_origin);
      if (d > R) continue;
      if (!game.combat.canSee(_origin, _chest)) continue;
      list.push({ e, d });
    }
    list.sort((a, b) => a.d - b.d);
    const targets = list.slice(0, def.arcs);
    const chests = [];
    for (const t of targets) {
      const e = t.e;
      e.getChestPosition(_chest);
      chests.push(_chest.clone());
      _d.subVectors(_chest, _origin);
      if (_d.lengthSq() < 1e-6) _d.set(0, 1, 0);
      _d.normalize();
      game.combat.applyDamage(e, {
        amount: def.arcDamage, attacker: owner, weapon: 'static', point: _chest.clone(), direction: _d.clone(),
        knockback: _d.clone().multiplyScalar(def.knockback),
      });
      if (!e.isProtected()) e.shock(def.shock);
      game.audio.play('shock_hit', { position: _chest });
    }
    // the thrower is shocked too when standing in the burst
    if (owner && owner.alive) {
      owner.getChestPosition(_chest);
      if (_chest.distanceTo(_origin) <= R && game.combat.canSee(_origin, _chest)) {
        _d.subVectors(_chest, _origin).normalize();
        game.combat.applyDamage(owner, {
          amount: def.arcDamage * def.selfScale, attacker: owner, weapon: 'static', point: _chest.clone(), direction: _d.clone(),
        });
        if (!owner.isProtected()) owner.shock(def.selfShock);
        chests.push(_chest.clone());
      }
    }
    this.fx.staticBurst(_origin, chests, R);
    game.audio.play('static_burst', { position: _center });
    game.events.emit('explosion', { position: _center.clone(), radius: R, owner, weapon: 'static' });
  }

  _kineticBlast(position, normal, owner) {
    const game = this.game;
    const def = GRENADE_TYPES.kinetic;
    _center.copy(position).addScaledVector(normal, 0.15);
    game.combat.radialDamage(_center, {
      radius: def.radius, damage: def.damage, attacker: owner, weapon: 'kinetic', knockback: def.knockback,
      selfScale: def.selfScale, selfKnock: def.selfKnock,
    });
    // tag everything the blast reached: a big sudden loss of horizontal speed afterwards is a wall slam (splat damage)
    const now = game.time;
    for (const e of game.entities) {
      if (!e.alive) continue;
      e.getChestPosition(_chest);
      if (_chest.distanceTo(_center) > def.radius) continue;
      if (e !== owner && owner && owner.team === e.team) continue;
      if (!game.combat.canSee(_center, _chest)) continue;
      if (owner && e !== owner) e._shovedBy = { attacker: owner, at: now };   // launched off the map = ring-out (Game kill plane)
      const hs = Math.hypot(e.velocity.x, e.velocity.z);
      const rec = this.splats.find(s => s.e === e);
      if (rec) { rec.until = now + 1.8; rec.prevH = hs; rec.peakH = hs; rec.owner = owner; rec.since = now; }
      else this.splats.push({ e, until: now + 1.8, prevH: hs, peakH: hs, owner, since: now });
    }
    this.fx.kineticBlast(_center, def.radius);
    game.audio.play('charge_blast', { position: _center });
    game.events.emit('explosion', { position: _center.clone(), radius: def.radius, owner, weapon: 'kinetic' });
  }

  _smokePop(position, normal, owner) {
    const game = this.game;
    const def = GRENADE_TYPES.smoke;
    _center.copy(position);
    _center.y += normal.y < -0.5 ? -1.0 : 1.4;
    game.combat.addSmoke(_center, def.radius, def.duration);
    this.fx.smokeCloud(_center, def.radius, def.duration);
    game.audio.play('smoke_pop', { position: _center });
    game.events.emit('smoke', { position: _center.clone(), radius: def.radius, owner });
  }

  // ------------------------------------------------------------------ per-frame

  update(dt) {
    const game = this.game;
    const combat = game.combat;
    if (combat) combat.updateSmokes();
    this._updateProximity(dt);
    this._updateShocked(dt);
    this._updateSplats(dt);
    this.fx.update(dt);
  }

  /** Vortex vignette + a little camera shake while the camera is inside a live well. */
  _updateProximity(dt) {
    let prox = 0;
    if (this.wells.length) {
      const cam = this.game.camera.position;
      for (const g of this.wells) {
        if (g.state !== 'active') continue;
        const d = cam.distanceTo(g.center);
        const p = Math.max(0, 1 - d / g.def.radius);
        if (p > prox) prox = p;
      }
    }
    this.fx.setVortexProximity(prox * 0.9);
    const pl = this.game.player;
    if (prox > 0.15 && pl && pl.alive && typeof pl.addShake === 'function') pl.addShake(prox * 0.5 * dt);
  }

  /** Sparks on every shocked body. */
  _updateShocked(dt) {
    this._zapT -= dt;
    if (this._zapT > 0) return;
    this._zapT = 0.08;
    for (const e of this.game.entities) if (e.alive && e.isShocked()) this.fx.zap(e);
  }

  /** Kinetic wall-slam: a big sudden drop of horizontal speed shortly after a blast deals splat damage. */
  _updateSplats(dt) {
    if (this.splats.length === 0) return;
    const game = this.game;
    const now = game.time;
    const def = GRENADE_TYPES.kinetic;
    for (let i = this.splats.length - 1; i >= 0; i--) {
      const s = this.splats[i];
      const e = s.e;
      if (!e.alive || now > s.until) { this.splats.splice(i, 1); continue; }
      const hs = Math.hypot(e.velocity.x, e.velocity.z);
      if (hs > s.peakH) s.peakH = hs;
      const drop = s.prevH - hs;
      if (s.prevH >= 8 && drop >= 6 && drop >= 0.55 * s.prevH && now - s.since > 0.05) {
        let dmg = Math.min(def.splatMax, Math.max(8, (s.prevH - 4) * 2.0));
        if (e === s.owner) dmg *= def.selfScale * 2;
        e.getChestPosition(_chest);
        game.combat.applyDamage(e, {
          amount: dmg, attacker: s.owner, weapon: 'kinetic', point: _chest.clone(), direction: _d.set(e.velocity.x, 0, e.velocity.z).normalize().clone(),
        });
        this.fx.splat(_chest);
        game.audio.play('impact_robot', { position: _chest, volume: 1 });
        this.splats.splice(i, 1);
        continue;
      }
      s.prevH = hs;
    }
  }
}
