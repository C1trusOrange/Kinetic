/**
 * Gale (weapon 'gale') - repulsor cone.
 *
 *   galeBlast(game, shooter, origin, dir, b, ads)  the whole blast: shove + damage every hostile entity in the cone,
 *                                                  reflect rockets / grenades, push the shooter off the nearest surface
 *   reflectProjectiles(game, origin, dir, o)       redirect live rockets / grenades in the cone (owner -> shooter)
 *   tagShove(game, target, info)                   called by Combat.applyDamage when a shove knockback was applied
 *   updateShoves(game, dt)                         called by Combat.update every frame: wall-splat detection
 *
 * Shared by WeaponSystem (player) and Bot. `b` is WEAPONS.gale.blast.
 * Events emitted: 'shove' {target, attacker, weapon, speed}, 'splat' {victim, attacker, damage}, 'reflect' {owner, kind}.
 */
import * as THREE from 'three';
import { clamp } from '../../core/utils.js';

const _to = new THREE.Vector3();
const _chest = new THREE.Vector3();
const _head = new THREE.Vector3();
const _kv = new THREE.Vector3();
const _aim = new THREE.Vector3();
const _fwd = new THREE.Vector3(0, 0, -1);
const _sd = new THREE.Vector3();
const _n = new THREE.Vector3();

// ------------------------------------------------------------------ blast

/**
 * Fire one Gale blast.
 * @param {object} game
 * @param {object} shooter entity firing
 * @param {THREE.Vector3} origin blast origin (the eye)
 * @param {THREE.Vector3} dir unit aim direction
 * @param {object} b WEAPONS.gale.blast
 * @param {boolean} [ads=false] focus mode: tighter cone, longer range
 * @param {{selfPush?: boolean}} [opts] selfPush false: no push on the shooter (online, a client predicts its own push
 *   with galeSelfPush and the host runs the rest of the blast)
 * @returns {{hits:number, reflected:number}}
 */
export function galeBlast(game, shooter, origin, dir, b, ads = false, opts = {}) {
  const combat = game.combat;
  const fx = game.effects;
  const range = ads ? (b.adsRange ?? b.range) : b.range;
  const half = ads ? b.adsHalfAngle : b.halfAngle;
  let hits = 0;

  // ---- shove + damage
  const ents = game.entities;
  for (let i = 0; i < ents.length; i++) {
    const e = ents[i];
    if (!e.alive || e === shooter) continue;
    if (shooter && e.team === shooter.team) continue;                 // friendlies are untouched
    e.getChestPosition(_chest);
    _to.subVectors(_chest, origin);
    const d = _to.length();
    if (d < 0.05 || d > range + e.radius) continue;
    _to.multiplyScalar(1 / d);
    const ang = Math.acos(clamp(_to.dot(dir), -1, 1));
    if (ang > half + Math.atan2(e.radius, Math.max(d, 0.6))) continue;
    if (!combat.canSee(origin, _chest)) {
      e.getEyePosition(_head);
      if (!combat.canSee(origin, _head)) continue;
    }
    const f = clamp(1 - d / range, 0, 1);
    const dmg = b.damageMin + (b.damage - b.damageMin) * f;
    const push = b.push * (b.pushMin + (1 - b.pushMin) * f);
    const kv = new THREE.Vector3().copy(dir).multiplyScalar(push);
    kv.y += b.lift * (0.5 + 0.5 * f);
    fx.hitSpark(_chest, _n.copy(dir).negate(), e);
    fx.galeRing(_chest, dir, { size: 1.2 });
    combat.applyDamage(e, {
      amount: dmg, attacker: shooter, weapon: 'gale', headshot: false, point: _chest.clone(), direction: dir.clone(), knockback: kv,
      shove: b.splat ? { dropMin: b.splatDrop, perMs: b.splatPerMs, max: b.splatMax } : null,
    });
    hits++;
  }

  // ---- reflect rockets / grenades
  let reflected = 0;
  if (b.reflect) {
    reflected = reflectProjectiles(game, origin, dir, {
      range, halfAngle: half, radius: b.reflectRadius, owner: shooter, speedMul: b.reflectSpeedMul,
    });
  }

  if (opts.selfPush !== false) galeSelfPush(game, shooter, origin, dir, b);
  return { hits, reflected };
}

/**
 * The blast's push on the shooter itself: off the nearest surface along the aim (walls add a little lift), or a
 * small recoil push when nothing is in range.
 */
export function galeSelfPush(game, shooter, origin, dir, b) {
  if (!shooter || !shooter.alive) return;
  const sp = game.world.raycast(origin, dir, b.selfRange);
  if (sp) {
    const push = b.selfPush * (1 - sp.distance / b.selfRange);
    _kv.copy(dir).multiplyScalar(-push);
    // walls give a little extra lift; a floor blast already points straight up
    _kv.y += push * b.selfLift * (1 - clamp(_kv.y / Math.max(push, 1e-3), 0, 1));
    shooter.applyImpulse(_kv);
  } else {
    shooter.applyImpulse(_kv.copy(dir).multiplyScalar(-b.noSurfacePush));
  }
}

// ------------------------------------------------------------------ reflection

/**
 * Redirect every hostile rocket / grenade inside the cone along the aim (towards the crosshair point).
 * The owner becomes the shooter (so the projectile is hostile to its former owner), the speed is multiplied and the
 * age is reset (a reflected grenade ignores its new owner for 0.15 s).
 * @param {object} game
 * @param {THREE.Vector3} origin
 * @param {THREE.Vector3} dir unit aim
 * @param {{range:number, halfAngle:number, radius?:number, owner:object, speedMul?:number}} o
 * @returns {number} projectiles reflected
 */
export function reflectProjectiles(game, origin, dir, o) {
  const pj = game.projectiles;
  if (!pj) return 0;
  const owner = o.owner;
  const radius = o.radius ?? 1.2;
  const mul = o.speedMul ?? 1.1;
  // where the crosshair points: reflected projectiles fly towards it (parallel to the aim when nothing is hit)
  const hit = game.world.raycast(origin, dir, 120);
  const target = _aim.copy(origin).addScaledVector(dir, hit ? hit.distance : 120);
  let count = 0;

  const inCone = (p) => {
    _to.subVectors(p, origin);
    const d = _to.length();
    if (d > o.range + radius) return false;
    if (d < 1e-3) return true;
    _to.multiplyScalar(1 / d);
    const ang = Math.acos(clamp(_to.dot(dir), -1, 1));
    return ang <= o.halfAngle + Math.atan2(radius, Math.max(d, 0.5));
  };
  const hostile = (po) => po !== owner && (!po || !owner || po.team !== owner.team);   // own projectiles pass, team-mates' too

  const rockets = pj.rockets || [];
  for (let i = 0; i < rockets.length; i++) {
    const r = rockets[i];
    if (!r.active || !hostile(r.owner) || !inCone(r.position)) continue;
    _sd.subVectors(target, r.position);
    if (_sd.lengthSq() < 9) _sd.copy(dir); else _sd.normalize();
    r.direction.copy(_sd);
    r.owner = owner;
    r.speed *= mul;
    r.age = 0;
    if (r.group) r.group.quaternion.setFromUnitVectors(_fwd, r.direction);
    game.effects.galeRing(r.position, dir, { size: 2.2, white: true, life: 0.25 });
    game.events.emit('reflect', { owner, kind: 'rocket' });
    count++;
  }
  const grenades = pj.grenades || [];
  for (let i = 0; i < grenades.length; i++) {
    const g = grenades[i];
    if (!g.active || !hostile(g.owner) || !inCone(g.position)) continue;
    _sd.subVectors(target, g.position);
    if (_sd.lengthSq() < 9) _sd.copy(dir); else _sd.normalize();
    const sp = Math.max(g.velocity.length(), 16);
    g.velocity.copy(_sd).multiplyScalar(sp);
    g.velocity.y += 2;
    g.owner = owner;
    g.age = 0;
    g.resting = false;
    g.fuse = Math.max(g.fuse, 0.6);
    game.effects.galeRing(g.position, dir, { size: 1.6, white: true, life: 0.25 });
    game.events.emit('reflect', { owner, kind: 'grenade' });
    count++;
  }
  if (count > 0 && game.audio) game.audio.play('gale_reflect', { position: origin });
  return count;
}

// ------------------------------------------------------------------ wall splat

/**
 * Tag a target that just received a shove knockback so a hard stop within 1.5 s counts as a wall splat.
 * @param {object} game
 * @param {object} target
 * @param {{attacker?:object, weapon?:string, shove?:{dropMin:number, perMs:number, max:number}}} info
 */
export function tagShove(game, target, info) {
  const s = info.shove;
  if (!s) return;
  const vx = target.velocity.x, vz = target.velocity.z;
  const sp = Math.hypot(vx, vz);
  target._shove = {
    attacker: info.attacker || null, weapon: info.weapon || 'gale',
    until: game.time + 1.5, armedAt: game.time + 0.05,
    lastSp: sp, dx: sp > 0.1 ? vx / sp : 0, dz: sp > 0.1 ? vz / sp : 0,
    dropMin: s.dropMin, perMs: s.perMs, max: s.max,
  };
  target._shovedBy = { attacker: info.attacker || null, at: game.time };     // ring-out credit (Game kill plane)
  game.events.emit('shove', { target, attacker: info.attacker || null, weapon: info.weapon || 'gale', speed: sp });
}

/**
 * Per-frame splat detection (call from Combat.update, after every entity moved this frame): a one-frame horizontal
 * speed drop of at least `dropMin` m/s AND 45 % of the previous speed on a tagged (recently shoved) entity is a wall
 * / rail contact and deals min(max, (drop - 5) * perMs) damage credited to the shover as weapon 'splat'.
 * @param {object} game
 */
export function updateShoves(game) {
  const ents = game.entities;
  const now = game.time;
  for (let i = 0; i < ents.length; i++) {
    const e = ents[i];
    const s = e._shove;
    if (!s) continue;
    if (!e.alive || now > s.until) { e._shove = null; continue; }
    const vx = e.velocity.x, vz = e.velocity.z;
    const sp = Math.hypot(vx, vz);
    if (now >= s.armedAt) {
      const drop = s.lastSp - sp;
      if (drop >= s.dropMin && drop >= 0.45 * s.lastSp) {
        e._shove = null;
        splat(game, e, s, Math.min(s.max, (drop - 5) * s.perMs), drop);
        continue;
      }
    }
    s.lastSp = sp;
    if (sp > 1) { s.dx = vx / sp; s.dz = vz / sp; }
  }
}

function splat(game, e, s, damage, drop) {
  const fx = game.effects;
  e.getChestPosition(_chest);
  // wall-aligned shock ring: look for the surface we hit along the previous travel direction
  _sd.set(s.dx, 0, s.dz);
  const wall = _sd.lengthSq() > 0.01 ? game.world.raycast(_chest, _sd, 1.6) : null;
  if (wall) {
    fx.impact(wall.point, wall.normal, wall.surface || 'concrete');
    fx.galeRing(wall.point, wall.normal, { size: 2.4, white: true, life: 0.3 });
  } else {
    fx.galeRing(_chest, _sd.set(0, 1, 0), { size: 2.0, white: true, life: 0.3 });
  }
  if (game.audio) game.audio.play('splat', { position: _chest });
  game.combat.applyDamage(e, {
    amount: damage, attacker: s.attacker, weapon: 'splat', headshot: false,
    point: _chest.clone(), direction: new THREE.Vector3(s.dx, 0, s.dz),
  });
  game.events.emit('splat', { victim: e, attacker: s.attacker, damage, drop });
}
