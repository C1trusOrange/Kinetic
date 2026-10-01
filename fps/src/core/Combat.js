import * as THREE from 'three';
import { galeBlast, tagShove, updateShoves } from '../weapons/special/gale.js';

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _end = new THREE.Vector3();
const _chest = new THREE.Vector3();
const _head = new THREE.Vector3();

/** Ray (origin o, unit dir d) vs sphere. Returns distance or -1. */
function raySphere(o, d, c, r) {
  const lx = c.x - o.x, ly = c.y - o.y, lz = c.z - o.z;
  const tca = lx * d.x + ly * d.y + lz * d.z;
  const d2 = lx * lx + ly * ly + lz * lz - tca * tca;
  const r2 = r * r;
  if (d2 > r2) return -1;
  const thc = Math.sqrt(r2 - d2);
  let t = tca - thc;
  if (t < 0) t = tca + thc;
  return t < 0 ? -1 : t;
}

/**
 * Ray vs capsule (segment a-b, radius r). Returns approximate entry distance or -1.
 * Uses closest points between the ray and the segment (exact for rays perpendicular to the axis).
 */
function rayCapsule(o, d, a, b, r) {
  const ex = b.x - a.x, ey = b.y - a.y, ez = b.z - a.z;
  const wx = o.x - a.x, wy = o.y - a.y, wz = o.z - a.z;
  const B = d.x * ex + d.y * ey + d.z * ez;       // d.e
  const C = ex * ex + ey * ey + ez * ez;          // e.e
  const D = d.x * wx + d.y * wy + d.z * wz;       // d.w
  const E = ex * wx + ey * wy + ez * wz;          // e.w
  const det = B * B - C;                          // (d.d = 1)
  let s, t;
  if (Math.abs(det) < 1e-8) { s = 0; t = -D; }
  else { t = (D * C - B * E) / det; s = (B * D - E) / det; }
  s = Math.max(0, Math.min(1, s));
  t = B * s - D;               // best t for clamped s
  if (t < 0) t = 0;
  s = C > 1e-8 ? Math.max(0, Math.min(1, (B * t + E) / C)) : 0; // best s for clamped t
  const px = o.x + d.x * t - (a.x + ex * s);
  const py = o.y + d.y * t - (a.y + ey * s);
  const pz = o.z + d.z * t - (a.z + ez * s);
  const dist2 = px * px + py * py + pz * pz;
  if (dist2 > r * r) return -1;
  const back = Math.sqrt(r * r - dist2);
  return Math.max(0, t - back);
}

/**
 * Shared combat rules: ray queries against world + entities, bullet firing, damage, deaths,
 * radial (explosion) damage. Used by the player's WeaponSystem, bots and projectiles.
 *
 * Events emitted on game.events:
 *   'damage' {target, attacker, amount, weapon, headshot, point, direction}
 *   'death'  {victim, attacker, weapon, headshot, point, direction}
 */
export class Combat {
  constructor(game) {
    this.game = game;
    this._hit = { distance: 0, point: new THREE.Vector3(), normal: new THREE.Vector3(), entity: null, part: null, surface: null };
    /** Live smoke volumes `{pos, r, until}` (Smoke Screen). They block bot SIGHT (canSee with {smoke:true}), never bullets or blasts. */
    this.smokes = [];
    // firing (player or bot, once per trigger pull) ends the shooter's spawn protection; grenades: Projectiles.spawnGrenade
    game.events.on('weapon:fire', e => { if (e.shooter) e.shooter.breakSpawnProtection(); });
  }

  /**
   * Register a smoke volume (max 6 alive; the oldest is dropped).
   * @param {THREE.Vector3} position sphere centre
   * @param {number} radius metres
   * @param {number} duration seconds
   */
  addSmoke(position, radius, duration) {
    const s = { pos: position.clone(), r: radius, until: this.game.time + duration, born: this.game.time };
    this.smokes.push(s);
    while (this.smokes.length > 6) this.smokes.shift();
    return s;
  }

  /** Drop expired smoke volumes. */
  updateSmokes() {
    const t = this.game.time;
    for (let i = this.smokes.length - 1; i >= 0; i--) if (t >= this.smokes[i].until) this.smokes.splice(i, 1);
  }

  /**
   * Length (m) of the segment a->b that lies inside any live smoke volume (thins out over the last 2 s).
   * Both ends inside the same volume and closer than 3 m count as clear (a body inside still sees ~3 m).
   */
  smokeChord(a, b) {
    const list = this.smokes;
    if (list.length === 0) return 0;
    const t = this.game.time;
    const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
    const len2 = dx * dx + dy * dy + dz * dz;
    const len = Math.sqrt(len2);
    if (len < 1e-4) return 0;
    let total = 0;
    for (let i = 0; i < list.length; i++) {
      const s = list[i];
      if (t >= s.until) continue;
      const r = s.r * Math.min(1, Math.max(0.35, (s.until - t) / 2));
      const inA = (a.x - s.pos.x) ** 2 + (a.y - s.pos.y) ** 2 + (a.z - s.pos.z) ** 2 < r * r;
      const inB = (b.x - s.pos.x) ** 2 + (b.y - s.pos.y) ** 2 + (b.z - s.pos.z) ** 2 < r * r;
      if (inA && inB && len < 3) continue;
      // chord of the infinite line through the sphere ([tc - h, tc + h] metres along a->b), clipped to the segment
      const cx = s.pos.x - a.x, cy = s.pos.y - a.y, cz = s.pos.z - a.z;
      const tc = (cx * dx + cy * dy + cz * dz) / len;
      const perp2 = cx * cx + cy * cy + cz * cz - tc * tc;
      if (perp2 >= r * r) continue;
      const h = Math.sqrt(r * r - perp2);
      const c0 = Math.max(0, tc - h), c1 = Math.min(len, tc + h);
      if (c1 > c0) total += c1 - c0;
    }
    return total;
  }

  /**
   * Nearest hit along a ray against world geometry and alive entities.
   * @param {THREE.Vector3} origin
   * @param {THREE.Vector3} dir unit direction
   * @param {number} maxDist
   * @param {object|null} ignore entity to skip (the shooter)
   * @returns {{distance:number, point:THREE.Vector3, normal:THREE.Vector3, entity:object|null,
   *            part:string|null, surface:string|null}|null}  NEW object (safe to keep)
   */
  raycast(origin, dir, maxDist, ignore = null) {
    let best = null;
    const w = this.game.world.raycast(origin, dir, maxDist);
    let limit = maxDist;
    if (w) {
      best = { distance: w.distance, point: w.point.clone(), normal: w.normal.clone(), entity: null, part: null, surface: w.surface };
      limit = w.distance;
    }
    for (const e of this.game.entities) {
      if (!e.alive || e === ignore) continue;
      // broad phase: distance from the ray to the entity's center
      const cx = e.position.x, cy = e.position.y + e.height * 0.5, cz = e.position.z;
      const tc = (cx - origin.x) * dir.x + (cy - origin.y) * dir.y + (cz - origin.z) * dir.z;
      if (tc < -1.5 || tc > limit + 1.5) continue;
      const qx = origin.x + dir.x * tc - cx, qy = origin.y + dir.y * tc - cy, qz = origin.z + dir.z * tc - cz;
      if (qx * qx + qy * qy + qz * qz > 2.2 * 2.2) continue;

      const boxes = e.getHitboxes();
      for (const hb of boxes) {
        const t = hb.type === 'sphere'
          ? raySphere(origin, dir, hb.center, hb.radius)
          : rayCapsule(origin, dir, hb.start, hb.end, hb.radius);
        if (t < 0 || t >= limit) continue;
        limit = t;
        const point = origin.clone().addScaledVector(dir, t);
        const normal = new THREE.Vector3();
        if (hb.type === 'sphere') normal.subVectors(point, hb.center);
        else {
          const seg = _v1.subVectors(hb.end, hb.start);
          const len2 = seg.lengthSq() || 1e-6;
          const s = Math.max(0, Math.min(1, _v2.subVectors(point, hb.start).dot(seg) / len2));
          normal.subVectors(point, _v3.copy(hb.start).addScaledVector(seg, s));
        }
        if (normal.lengthSq() < 1e-8) normal.copy(dir).negate();
        normal.normalize();
        best = { distance: t, point, normal, entity: e, part: hb.part, surface: 'robot' };
      }
    }
    return best;
  }

  /** Per-frame combat bookkeeping (Gale wall-splat detection). Called by Game.update right after bots.update. */
  update(dt) {
    const net = this.game.net;
    if (net && !net.authority) return;   // online clients: the host detects wall splats
    updateShoves(this.game, dt);
  }

  /**
   * Gale cone blast: shove + damage hostile entities, reflect rockets / grenades, push the shooter off the nearest
   * surface. See weapons/special/gale.js.
   * @param {object} shooter
   * @param {THREE.Vector3} origin
   * @param {THREE.Vector3} dir unit aim direction
   * @param {object} b WEAPONS.gale.blast
   * @param {boolean} [ads=false]
   * @returns {{hits:number, reflected:number}}
   */
  blast(shooter, origin, dir, b, ads = false) {
    const net = this.game.net;
    if (net && net.isClient) return net.client.hooks.blast(shooter, origin, dir, b, ads);   // the host runs it (mp-arsenal)
    return galeBlast(this.game, shooter, origin, dir, b, ads);
  }

  /**
   * True if the straight segment a->b is not blocked by world geometry. With `opts.smoke` (bot perception only) a
   * segment crossing 1.4 m or more of a live smoke volume is blocked too.
   */
  canSee(a, b, opts = null) {
    _dir.subVectors(b, a);
    const d = _dir.length();
    if (d < 1e-4) return true;
    _dir.multiplyScalar(1 / d);
    if (this.game.world.raycast(a, _dir, Math.max(0, d - 0.05))) return false;
    if (opts && opts.smoke && this.smokes.length && this.smokeChord(a, b) >= 1.4) return false;
    return true;
  }

  /**
   * Fire one hitscan bullet (call once per pellet). Handles damage, impact FX and the tracer.
   * @param {object} o
   * @param {object|null} o.shooter      entity firing (ignored by the ray)
   * @param {THREE.Vector3} o.origin     ray origin (usually the eye)
   * @param {THREE.Vector3} o.direction  unit direction (spread already applied)
   * @param {number} o.damage            base damage at close range
   * @param {string} o.weapon            weapon id for kill feed ('rifle', ...)
   * @param {number} [o.range=250]
   * @param {number} [o.headshotMult=2]
   * @param {{start:number,end:number,min:number}} [o.falloff]  damage scales to `min` between start..end meters
   * @param {THREE.Vector3} [o.tracerFrom] visual tracer start (muzzle); omit or null for no tracer
   * @param {number|string} [o.tracerColor]
   * @returns hit (see raycast) or null
   */
  fireBullet(o) {
    const range = o.range ?? 250;
    const hit = this.raycast(o.origin, o.direction, range, o.shooter ?? null);
    _end.copy(o.origin).addScaledVector(o.direction, hit ? hit.distance : range);
    if (o.tracerFrom) this.game.effects.tracer(o.tracerFrom, _end, { color: o.tracerColor });
    if (!hit) return null;

    if (hit.entity) {
      let dmg = o.damage;
      const f = o.falloff;
      if (f && hit.distance > f.start) {
        const k = Math.min(1, (hit.distance - f.start) / Math.max(1e-3, f.end - f.start));
        dmg *= 1 - (1 - f.min) * k;
      }
      const headshot = hit.part === 'head';
      if (headshot) dmg *= o.headshotMult ?? 2;
      else if (hit.part === 'legs') dmg *= 0.8;
      this.game.effects.hitSpark(hit.point, hit.normal, hit.entity);
      this.applyDamage(hit.entity, {
        amount: dmg, attacker: o.shooter ?? null, weapon: o.weapon, headshot,
        point: hit.point, direction: o.direction,
      });
    } else {
      this.game.effects.impact(hit.point, hit.normal, hit.surface);
    }
    return hit;
  }

  /**
   * Apply damage to an entity. Handles friendly fire (off in TDM), spawn protection, god mode,
   * knockback, the 'damage' event and death. Returns the damage actually dealt.
   * @param {object} target entity
   * @param {{amount:number, attacker?:object|null, weapon?:string, headshot?:boolean,
   *          point?:THREE.Vector3, direction?:THREE.Vector3, knockback?:THREE.Vector3}} info
   */
  applyDamage(target, info) {
    // online clients never apply damage: their own hits become claims the host validates (favor the shooter)
    const net = this.game.net;
    if (net && !net.authority) return net.client.claimDamage ? net.client.claimDamage(target, info) : 0;
    if (!target || !target.alive) return 0;
    const match = this.game.match;
    if (match && match.over) return 0;
    if (match && match.phase === 'countdown') return 0;   // online countdown: nobody takes damage
    const attacker = info.attacker ?? null;
    const friendly = attacker && attacker !== target && attacker.team === target.team;
    if (friendly) return 0;
    // spawn-protected entities ignore knockback from anyone else (nobody can be shoved off a void map or rocket-launched
    // around while immune); self knockback (rocket jumps, Gale self push) is unaffected
    if (info.knockback && (attacker === target || !target.isProtected())) {
      target.applyImpulse(info.knockback, info);   // a RemotePlayer forwards it to its client
      if (info.shove) tagShove(this.game, target, info);
    }
    if (target.god || target.isProtected()) return 0;
    if (attacker && attacker !== target && attacker.spawnProtectedUntil > this.game.time) {
      attacker.breakSpawnProtection(); // attacking breaks your own spawn protection
    }

    const dealt = target.takeDamage({ ...info, attacker });
    if (dealt <= 0) return 0;
    this.game.events.emit('damage', {
      target, attacker, amount: dealt, weapon: info.weapon ?? 'unknown', headshot: !!info.headshot,
      point: info.point ?? null, direction: info.direction ?? null,
    });
    if (target.health <= 0 && target.alive) this.kill(target, info);
    return dealt;
  }

  /** Kill an entity immediately (also used for the kill plane). Emits 'death'. */
  kill(target, info = {}) {
    const net = this.game.net;
    if (net && !net.authority) return;   // deaths come from the host
    if (!target.alive) return;
    target.health = 0;
    target.alive = false;
    const payload = {
      victim: target,
      attacker: info.attacker ?? null,
      weapon: info.weapon ?? 'unknown',
      headshot: !!info.headshot,
      point: info.point ?? null,
      direction: info.direction ?? null,
    };
    const fx = net && net.fx;   // online: gibs and death sounds are made by every machine itself
    if (fx) fx.suspend();
    try {
      target.onDeath(payload);
    } catch (err) {
      console.error('[combat] onDeath threw', err);
    } finally {
      if (fx) fx.resume();
    }
    this.game.events.emit('death', payload);
  }

  /**
   * Explosion damage with linear falloff, line-of-sight check and knockback.
   * The attacker takes `selfScale` of the damage but full knockback (rocket jumping).
   * @param {THREE.Vector3} center  keep it slightly off surfaces (e.g. hit.point + normal*0.1)
   * @param {{radius:number, damage:number, attacker?:object|null, weapon?:string,
   *          knockback?:number, selfScale?:number, selfKnock?:number}} o  selfKnock = multiplier on the attacker's own knockback
   */
  radialDamage(center, o) {
    const net = this.game.net;
    if (net && !net.authority) return;   // explosions damage on the host only
    const radius = o.radius;
    const knock = o.knockback ?? 12;
    const selfScale = o.selfScale ?? 0.4;
    for (const e of this.game.entities.slice()) {
      if (!e.alive) continue;
      e.getChestPosition(_chest);
      e.getEyePosition(_head);
      // distance to the closest point of the entity's vertical axis
      const cy = Math.max(e.position.y, Math.min(e.position.y + e.height, center.y));
      _v1.set(e.position.x, cy, e.position.z);
      const dist = Math.max(0, _v1.distanceTo(center) - e.radius);
      if (dist > radius) continue;
      if (!this.canSee(center, _chest) && !this.canSee(center, _head) && !this.canSee(center, _v1)) continue;

      const falloff = 1 - dist / radius;
      _dir.subVectors(_chest, center);
      if (_dir.lengthSq() < 1e-6) _dir.set(0, 1, 0);
      _dir.normalize();
      const kv = _dir.clone().multiplyScalar(knock * (0.35 + 0.65 * falloff));
      kv.y += knock * 0.25 * falloff;
      let dmg = o.damage * (0.15 + 0.85 * falloff);
      if (e === o.attacker) { dmg *= selfScale; if (o.selfKnock != null) kv.multiplyScalar(o.selfKnock); }
      this.applyDamage(e, {
        amount: dmg, attacker: o.attacker ?? null, weapon: o.weapon ?? 'explosion',
        point: _chest.clone(), direction: _dir.clone(), knockback: kv,
      });
    }
  }
}
