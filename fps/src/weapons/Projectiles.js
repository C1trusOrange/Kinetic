import * as THREE from 'three';
import { createRocketModel, createGrenadeModel } from './WeaponModels.js';
import { WEAPONS, GRENADE, GRENADE_TYPES, GRENADE_ORDER } from './WeaponDefs.js';
import { GrenadeSystem } from './GrenadeTypes.js';
import { GRAVITY } from '../core/constants.js';
import { randRange } from '../core/utils.js';

const ROCKET_MAX_AGE = 6;
const ROCKET_LOOKAHEAD = 0.06;
const GRENADE_RADIUS = 0.07;
const GRENADE_RESTITUTION = 0.45;
const GRENADE_BOUNCE_FRICTION = 0.72;
const GRENADE_ROLL_DRAG = 3.4;
const GRENADE_AIR_DRAG = 0.12;
const REST_SPEED = 1.3;

const _fwd = new THREE.Vector3(0, 0, -1);
const _dir = new THREE.Vector3();
const _tmp = new THREE.Vector3();
const _tmp2 = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _boomPos = new THREE.Vector3();
const _boomN = new THREE.Vector3();
const _boomC = new THREE.Vector3();

/** Soft red glow used for the blinking grenade beacon. */
function makeGlowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.25, 'rgba(255,120,90,0.85)');
  grad.addColorStop(1, 'rgba(255,40,20,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * Rockets (swept collision, direct hits, trails), bouncing frag grenades with fuse, and the shared
 * explosion routine. Meshes are pooled; the pools grow on demand and never shrink.
 */
export class Projectiles {
  /** @param {object} game */
  constructor(game) {
    this.game = game;
    /** Active grenades `{position, velocity, fuse, owner, ...}` (AI avoidance reads these). */
    this.grenades = [];
    /** Active rockets `{position, direction, owner, ...}`. */
    this.rockets = [];
    this.root = new THREE.Group();
    this.root.name = 'projectiles';
    game.scene.add(this.root);
    this._rocketPool = [];
    this._grenadePool = [];
    this._glowMat = null;
    /** Beacon glow materials per grenade type (frag = _glowMat). */
    this._glowMats = {};
    this._lastBounceSound = -1;
    /** Special grenade behaviour (Vortex / Static / Kinetic / Smoke), see GrenadeTypes.js. */
    this.types = new GrenadeSystem(game, this);
  }

  /** Pre-creates a few pooled meshes. */
  init() {
    this._glowMat = new THREE.SpriteMaterial({
      map: makeGlowTexture(), color: new THREE.Color(2.2, 0.5, 0.35), transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending, fog: false,
    });
    for (let i = 0; i < 4; i++) this._rocketPool.push(this._makeRocket());
    for (let i = 0; i < 6; i++) this._grenadePool.push(this._makeGrenade());
    for (const t of GRENADE_ORDER) this._glowMatFor(t);
    this.types.init();
  }

  /**
   * Objects Game.warmup adds to the scenes while a match loads (removed again afterwards): a world model of every
   * grenade type, which also builds the special grenades' templates now, and the same models for the first-person
   * hand in the view scene. The special grenades are otherwise created on the first throw (by anyone), and their
   * materials had only view-scene shader programs: the first special grenade in the world compiled a new program
   * mid-match (a 400-650 ms freeze). A beacon sprite per type warms the tinted glow materials.
   * @returns {{world: THREE.Object3D[], view: THREE.Object3D[]}}
   */
  prewarmObjects() {
    const world = [], view = [];
    for (const t of GRENADE_ORDER) {
      world.push(createGrenadeModel(t), new THREE.Sprite(this._glowMatFor(t)));
      view.push(createGrenadeModel(t));
    }
    return { world, view };
  }

  /** Beacon glow material for a grenade type (cached; same soft texture, tinted). */
  _glowMatFor(type) {
    if (type === 'frag' || !GRENADE_TYPES[type]) return this._glowMat;
    let m = this._glowMats[type];
    if (!m) {
      const c = new THREE.Color(GRENADE_TYPES[type].color).multiplyScalar(2.1);
      m = this._glowMats[type] = new THREE.SpriteMaterial({
        map: this._glowMat.map, color: c, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
      });
    }
    return m;
  }

  // ------------------------------------------------------------------ pooling

  _makeRocket() {
    const group = new THREE.Group();
    const model = createRocketModel();
    group.add(model);
    group.visible = false;
    this.root.add(group);
    return {
      active: false, group, model, owner: null,
      position: new THREE.Vector3(), direction: new THREE.Vector3(0, 0, -1),
      speed: 42, age: 0, damage: 105, splashDamage: 95, radius: 4.8, knockback: 15, selfScale: 0.35, spin: 0,
    };
  }

  _makeGrenade() {
    const group = new THREE.Group();
    const model = createGrenadeModel();
    group.add(model);
    const glow = new THREE.Sprite(this._glowMat || new THREE.SpriteMaterial({ color: 0xff5040 }));
    glow.scale.setScalar(0.12);
    group.add(glow);
    group.visible = false;
    this.root.add(group);
    return {
      active: false, group, model, glow, owner: null,
      position: new THREE.Vector3(), velocity: new THREE.Vector3(),
      fuse: 0, fuseTotal: 1, age: 0, resting: false,
      normal: new THREE.Vector3(0, 1, 0), spinAxis: new THREE.Vector3(1, 0, 0), spinRate: 0,
      // grenade type state (GrenadeTypes.js): type, def, state 'flight' | 'deploy' | 'active' (vortex), well centre, timers
      type: 'frag', def: GRENADE_TYPES.frag, danger: GRENADE_TYPES.frag.danger, models: { frag: model },
      state: 'flight', stateT: 0, liftT: 0, crushT: 0, popAt: -1, center: new THREE.Vector3(), rig: null, loop: null, fxAcc: 0,
    };
  }

  // ------------------------------------------------------------------ spawning

  /**
   * Fire a rocket.
   * @param {{owner:object, origin:THREE.Vector3, direction:THREE.Vector3, speed?:number, damage?:number,
   *          splashDamage?:number, radius?:number}} o
   */
  spawnRocket({ owner, origin, direction, speed, damage, splashDamage, radius }) {
    const def = WEAPONS.rocket;
    const p = def.projectile;
    const r = this._rocketPool.find(x => !x.active) || (this._rocketPool.push(this._makeRocket()), this._rocketPool[this._rocketPool.length - 1]);
    r.active = true;
    r.owner = owner || null;
    r.position.copy(origin);
    r.direction.copy(direction).normalize();
    r.speed = speed ?? p.speed;
    r.damage = damage ?? def.damage;
    r.splashDamage = splashDamage ?? p.splashDamage;
    r.radius = radius ?? p.splashRadius;
    r.knockback = p.knockback;
    r.selfScale = p.selfScale;
    r.age = 0;
    r.spin = Math.random() * 6.28;
    r.group.position.copy(r.position);
    r.group.quaternion.setFromUnitVectors(_fwd, r.direction);
    r.group.visible = true;
    this.rockets.push(r);
    return r;
  }

  /**
   * Throw a grenade.
   * @param {{owner:object, origin:THREE.Vector3, velocity:THREE.Vector3, fuse:number, type?:string}} o
   *        type: 'frag' (default) | 'vortex' | 'static' | 'kinetic' | 'smoke'
   */
  spawnGrenade({ owner, origin, velocity, fuse, type = 'frag' }) {
    const g = this._grenadePool.find(x => !x.active) || (this._grenadePool.push(this._makeGrenade()), this._grenadePool[this._grenadePool.length - 1]);
    g.active = true;
    g.owner = owner || null;
    if (!GRENADE_TYPES[type]) type = 'frag';
    g.type = type;
    g.def = GRENADE_TYPES[type];
    g.danger = g.def.danger;
    g.state = 'flight';
    g.stateT = 0;
    g.popAt = -1;
    g.fxAcc = 0;
    let tm = g.models[type];
    if (!tm) {
      tm = g.models[type] = createGrenadeModel(type);
      g.group.add(tm);
    }
    if (g.model !== tm) {
      g.model.visible = false;
      tm.visible = true;
      g.model = tm;
    }
    g.model.visible = true;
    g.glow.material = this._glowMatFor(type);
    g.position.copy(origin);
    g.velocity.copy(velocity);
    g.fuse = Math.max(0.05, fuse ?? GRENADE.fuse);
    g.fuseTotal = Math.max(0.5, g.fuse);
    g.age = 0;
    g.resting = false;
    g.normal.set(0, 1, 0);
    g.spinAxis.set(randRange(-1, 1), randRange(-0.3, 0.3), randRange(-1, 1)).normalize();
    g.spinRate = randRange(9, 15);
    g.model.quaternion.identity();
    g.group.position.copy(g.position);
    g.group.visible = true;
    g.glow.visible = true;
    this.grenades.push(g);
    return g;
  }

  // ------------------------------------------------------------------ explosions

  /**
   * Area damage + visuals + sound + 'explosion' event.
   * @param {THREE.Vector3} position  contact point (the centre is offset 0.15 m along `normal`)
   * @param {{owner?:object, weapon?:string, radius?:number, damage?:number, knockback?:number,
   *          normal?:THREE.Vector3, selfScale?:number}} [o]
   */
  explode(position, o = {}) {
    const game = this.game;
    const weapon = o.weapon || 'rocket';
    const isGrenade = weapon === 'grenade';
    const rp = WEAPONS.rocket.projectile;
    const radius = o.radius ?? (isGrenade ? GRENADE.radius : rp.splashRadius);
    const damage = o.damage ?? (isGrenade ? GRENADE.damage : rp.splashDamage);
    const knockback = o.knockback ?? (isGrenade ? GRENADE.knockback : rp.knockback);
    const selfScale = o.selfScale ?? (isGrenade ? GRENADE.selfScale : rp.selfScale);
    const owner = o.owner || null;

    const center = new THREE.Vector3().copy(position);
    if (o.normal) center.addScaledVector(o.normal, 0.15);

    game.combat.radialDamage(center, { radius, damage, attacker: owner, weapon, knockback, selfScale });
    game.effects.explosion(center, { radius, normal: o.normal });
    game.audio.play('explosion', { position: center, volume: isGrenade ? 0.9 : 1 });

    // shove nearby live grenades around (they are physical objects)
    for (const g of this.grenades) {
      const d = _tmp.subVectors(g.position, center).length();
      if (d >= radius || d < 1e-4) continue;
      const k = 1 - d / radius;
      g.velocity.addScaledVector(_tmp.multiplyScalar(1 / d), knockback * 0.9 * k);
      g.velocity.y += 3 * k;
      g.resting = false;
    }

    game.events.emit('explosion', { position: center.clone(), radius, owner, weapon });
  }

  // ------------------------------------------------------------------ update

  /** @param {number} dt */
  update(dt) {
    const killY = this.game.world && this.game.world.killY != null ? this.game.world.killY : -100;
    for (let i = this.rockets.length - 1; i >= 0; i--) {
      const r = this.rockets[i];
      if (this._updateRocket(r, dt, killY)) {
        this.rockets.splice(i, 1);
        this._releaseRocket(r);
      }
    }
    for (let i = this.grenades.length - 1; i >= 0; i--) {
      const g = this.grenades[i];
      const detonate = this._updateGrenade(g, dt, killY);
      if (detonate !== 0) {
        // Release clears g.owner and frees the pooled entry for reuse, so read everything explode() needs first.
        const owner = g.owner;
        const type = g.type;
        _boomPos.copy(g.position);
        _boomN.copy(g.normal);
        _boomC.copy(g.center);
        this.grenades.splice(i, 1);
        this._releaseGrenade(g);
        if (detonate === 1) {
          if (type === 'frag') this.explode(_boomPos, { owner, weapon: 'grenade', normal: _boomN });
          else this.detonate(type, _boomPos, _boomN, owner, _boomC);
        }
      }
    }
    this.types.update(dt);
  }

  /**
   * Detonate a grenade type at a point (fuse, pop, collapse or cooked off in hand).
   * @param {string} type
   * @param {THREE.Vector3} position
   * @param {THREE.Vector3} normal
   * @param {object|null} owner
   * @param {THREE.Vector3} [center] vortex well centre
   */
  detonate(type, position, normal, owner, center = null) {
    if (type === 'frag') this.explode(position, { owner, weapon: 'grenade', normal });
    else this.types.detonate(type, position, normal, owner, center ? { center } : null);
  }

  /** Returns true when the rocket is finished (already exploded). */
  _updateRocket(r, dt, killY) {
    const game = this.game;
    r.age += dt;
    const step = r.speed * dt;
    const hit = game.combat.raycast(r.position, r.direction, step + ROCKET_LOOKAHEAD, r.owner);
    if (hit) {
      if (hit.entity) {
        game.combat.applyDamage(hit.entity, {
          amount: r.damage, attacker: r.owner, weapon: 'rocket', headshot: false,
          point: hit.point, direction: r.direction.clone(),
        });
      }
      this.explode(hit.point, {
        owner: r.owner, weapon: 'rocket', radius: r.radius, damage: r.splashDamage,
        knockback: r.knockback, selfScale: r.selfScale, normal: hit.normal,
      });
      return true;
    }
    r.position.addScaledVector(r.direction, step);
    if (r.age > ROCKET_MAX_AGE) {
      this.explode(r.position, { owner: r.owner, weapon: 'rocket', radius: r.radius, damage: r.splashDamage, knockback: r.knockback, selfScale: r.selfScale });
      return true;
    }
    if (r.position.y < killY) return true;

    r.group.position.copy(r.position);
    r.spin += dt * 9;
    r.model.rotation.z = r.spin;
    _tmp.copy(r.position).addScaledVector(r.direction, -0.32);
    game.effects.trail(_tmp, { type: 'rocket' });
    return false;
  }

  /** Returns 0 (keep), 1 (detonate) or 2 (discard silently). */
  _updateGrenade(g, dt, killY) {
    const game = this.game;
    if (g.state !== 'flight') return this.types.updateStuck(g, dt);   // deployed Vortex
    g.age += dt;
    g.fuse -= dt;
    if (g.fuse <= 0) {
      if (g.def.stick) { this.types.deployInAir(g); return 0; }
      return 1;
    }
    if (g.position.y < killY) return 2;

    // integrate: gravity + light air drag, swept against the world/entities (sub-stepped for corners)
    g.velocity.y -= GRAVITY * dt;
    if (!g.resting) g.velocity.multiplyScalar(1 - GRENADE_AIR_DRAG * dt);
    let remaining = dt;
    let bounced = false;
    let contact = false;
    let impactSpeed = 0;
    for (let iter = 0; iter < 3 && remaining > 1e-5; iter++) {
      const speed = g.velocity.length();
      if (speed < 1e-4) break;
      _dir.copy(g.velocity).multiplyScalar(1 / speed);
      const travel = speed * remaining;
      const hit = game.combat.raycast(g.position, _dir, travel + GRENADE_RADIUS, g.age < 0.15 ? g.owner : null);
      if (!hit) {
        g.position.addScaledVector(g.velocity, remaining);
        break;
      }
      const n = hit.normal;
      // place the centre on the contact surface (exact for planes, robust at grazing angles)
      g.position.copy(hit.point).addScaledVector(n, GRENADE_RADIUS + 0.003);
      remaining = Math.max(0, remaining - Math.max(0, hit.distance - GRENADE_RADIUS) / speed);
      const vn = g.velocity.dot(n);
      if (vn < 0) {
        if (g.def.stick) { this.types.stick(g, hit); return 0; }
        contact = true;
        if (hit.entity == null) g.normal.copy(n);
        impactSpeed = Math.max(impactSpeed, -vn);
        const floorLike = n.y > 0.6;
        if (-vn < REST_SPEED && floorLike) {
          // resting / rolling: kill the normal component, keep sliding, drag applied below
          g.velocity.addScaledVector(n, -vn);
        } else {
          const e = hit.entity ? 0.28 : GRENADE_RESTITUTION;
          g.velocity.addScaledVector(n, -(1 + e) * vn);
          // tangential friction on a real bounce
          const vt = g.velocity.dot(n);
          _tmp.copy(n).multiplyScalar(vt);
          _tmp2.subVectors(g.velocity, _tmp).multiplyScalar(GRENADE_BOUNCE_FRICTION);
          g.velocity.copy(_tmp).add(_tmp2);
          bounced = true;
          g.spinAxis.set(randRange(-1, 1), randRange(-1, 1), randRange(-1, 1)).normalize();
        }
      }
    }

    if (contact) {
      const floorLike = g.normal.y > 0.6;
      if (floorLike && g.velocity.lengthSq() < 60) {
        // rolling drag on the ground
        const drag = Math.max(0, 1 - GRENADE_ROLL_DRAG * dt);
        g.velocity.x *= drag;
        g.velocity.z *= drag;
      }
      g.resting = floorLike && impactSpeed < REST_SPEED;
    } else {
      g.resting = false;
    }
    if (g.resting && g.velocity.lengthSq() < 0.02) g.velocity.set(0, 0, 0);
    // Smoke pops a moment after its first touch
    if (g.def.popDelay) {
      if (contact && g.popAt < 0) g.popAt = g.age + g.def.popDelay;
      if (g.popAt >= 0 && g.age >= g.popAt) return 1;
    }

    if (bounced && impactSpeed > 2.5 && game.time - this._lastBounceSound > 0.07) {
      this._lastBounceSound = game.time;
      game.audio.play('grenade_bounce', { position: g.position, volume: Math.min(1, impactSpeed / 9), rate: randRange(0.92, 1.08) });
    }

    // visuals
    g.group.position.copy(g.position);
    const speed = g.velocity.length();
    if (speed > 0.15) {
      _q.setFromAxisAngle(g.spinAxis, g.spinRate * Math.min(1, speed / 6) * dt);
      g.model.quaternion.premultiply(_q);
    }
    // blinking beacon: faster as the fuse burns down
    const t = g.fuseTotal - g.fuse;
    const freq = 2.5 + 9 * (t / g.fuseTotal);
    const phase = (t * freq) % 1;
    g.glow.visible = phase < 0.3;
    g.glow.position.set(0, 0.075, 0);
    if (g.type === 'frag') { if (speed > 3) game.effects.trail(g.position, { type: 'grenade' }); }
    else this.types.fx.flightTick(g, dt);
    return 0;
  }

  _releaseRocket(r) {
    r.active = false;
    r.owner = null;
    r.group.visible = false;
  }

  _releaseGrenade(g) {
    if (g.type !== 'frag') this.types.onRelease(g);
    g.active = false;
    g.owner = null;
    g.group.visible = false;
  }

  /** Remove every projectile (match start / restart). */
  clear() {
    for (const r of this.rockets) this._releaseRocket(r);
    for (const g of this.grenades) this._releaseGrenade(g);
    this.rockets.length = 0;
    this.grenades.length = 0;
    this.types.clear();
  }
}
