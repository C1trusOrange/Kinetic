/**
 * Tempest (weapon 'arc') - one tick of the continuous chain-lightning beam.
 *
 * Shared by the player's WeaponSystem and by Bot so both behave identically (and so it can be driven from a test):
 *   fireArc(game, shooter, { origin, dir, muzzle, def, dmgScale }) -> { hit, dist, chained }
 * One call = one tick (def.fireRate ticks per second while the trigger is held): a ray from `origin` along `dir`
 * (range def.range) damages the first entity with falloff, then up to def.beam.chainMax further hostile entities
 * within def.beam.chainRadius of the impact point (in line of sight of it) take def.beam.chainScale of that damage.
 * The visuals (beam channel, chain arcs, impact) are emitted here too; callers may re-call `updateBeamVisual` every
 * frame between ticks so the beam stays glued to the muzzle.
 */
import * as THREE from 'three';

const _end = new THREE.Vector3();
const _chest = new THREE.Vector3();
const _at = new THREE.Vector3();
const _org = new THREE.Vector3();
const _best = [null, null];
const _bestD = [Infinity, Infinity];

/**
 * Damage multiplier of a beam tick at distance `d` (linear falloff def.falloff.start..end down to .min).
 * @param {object} def weapon def
 * @param {number} d
 */
export function arcFalloff(def, d) {
  const f = def.falloff;
  if (!f || d <= f.start) return 1;
  const k = Math.min(1, (d - f.start) / Math.max(1e-3, f.end - f.start));
  return 1 - (1 - f.min) * k;
}

const _cad = { n: 1, next: 0 };

/**
 * Tick cadence of a held beam that stays exact at any frame rate. `dueAt` is when this tick was scheduled, `lastTickAt`
 * the time of the previous tick. While the beam is continuous (previous tick less than 3 intervals ago) a frame that
 * arrives late owes up to 3 ticks, which the caller applies at once (damage x n, ammo - n); a fresh burst owes one.
 * Returns a shared object { n, next } (next = the next scheduled tick time).
 * @param {number} now
 * @param {number} dueAt
 * @param {number} lastTickAt
 * @param {number} step seconds per tick
 */
export function beamCadence(now, dueAt, lastTickAt, step) {
  if (!(dueAt > 0) || now - lastTickAt >= step * 3) { _cad.n = 1; _cad.next = now + step; return _cad; }
  const n = Math.min(3, 1 + Math.max(0, Math.floor((now - dueAt) / step)));
  _cad.n = n;
  _cad.next = dueAt + n * step;
  return _cad;
}

/**
 * Fire one beam tick.
 * @param {object} game
 * @param {object} shooter entity
 * @param {{origin:THREE.Vector3, dir:THREE.Vector3, muzzle?:THREE.Vector3, def:object, dmgScale?:number, key?:string}} o
 * @returns {{hit:object|null, dist:number, chained:number}}
 */
export function fireArc(game, shooter, o) {
  const def = o.def;
  const b = def.beam;
  const combat = game.combat;
  const fx = game.effects;
  const range = def.range;
  const hit = combat.raycast(o.origin, o.dir, range, shooter);
  const dist = hit ? hit.distance : range;
  _end.copy(o.origin).addScaledVector(o.dir, dist);

  let chained = 0;
  let dmg = 0;
  let team = shooter ? shooter.team : 0;
  if (hit && hit.entity) {
    dmg = def.damage * (o.dmgScale ?? 1) * arcFalloff(def, dist);
    fx.arcHit(hit.point, hit.normal, hit.entity);
    combat.applyDamage(hit.entity, {
      amount: dmg, attacker: shooter, weapon: def.id, headshot: false, point: hit.point, direction: o.dir.clone(),
    });
  } else if (hit) {
    fx.arcHit(hit.point, hit.normal, null);
    dmg = def.damage * (o.dmgScale ?? 1) * arcFalloff(def, dist);
  }

  // ---- chain: the nearest hostile entities around the impact point
  if (hit && b.chainMax > 0) {
    _at.copy(hit.point);
    if (!hit.entity) _at.addScaledVector(hit.normal, 0.12);
    const cr2 = b.chainRadius * b.chainRadius;
    _best[0] = _best[1] = null;
    _bestD[0] = _bestD[1] = Infinity;
    const ents = game.entities;
    for (let i = 0; i < ents.length; i++) {
      const e = ents[i];
      if (!e.alive || e === shooter || e === hit.entity || e.team === team) continue;
      e.getChestPosition(_chest);
      const d2 = _chest.distanceToSquared(_at);
      if (d2 > cr2) continue;
      if (d2 < _bestD[0]) {
        _best[1] = _best[0]; _bestD[1] = _bestD[0];
        _best[0] = e; _bestD[0] = d2;
      } else if (d2 < _bestD[1]) {
        _best[1] = e; _bestD[1] = d2;
      }
    }
    const n = Math.min(b.chainMax, 2);
    for (let k = 0; k < n; k++) {
      const e = _best[k];
      if (!e) break;
      e.getChestPosition(_chest);
      if (!combat.canSee(_at, _chest)) continue;
      chained++;
      fx.lightning(_at, _chest, { color: b.color, core: b.core, width: 0.05, life: 0.07, jitter: 0.22 });
      fx.arcHit(_chest, null, e);
      combat.applyDamage(e, {
        amount: dmg * b.chainScale, attacker: shooter, weapon: def.id, headshot: false, point: _chest.clone(), direction: o.dir.clone(),
      });
    }
  }

  // ---- the beam itself
  updateBeamVisual(game, shooter, o.muzzle || o.origin, _end, def);
  return { hit, dist, chained };
}

/**
 * (Re)draw the beam of `shooter` from `from` to `to`; call every tick and, for the local player, every frame.
 * @param {object} game
 * @param {object} shooter
 * @param {THREE.Vector3} from
 * @param {THREE.Vector3} to
 * @param {object} def weapon def (uses def.beam)
 */
export function updateBeamVisual(game, shooter, from, to, def) {
  const b = def.beam;
  game.effects.channel('arc:' + (shooter ? shooter.id : 0), from, to, {
    color: b.color, core: b.core, width: b.width, jitter: b.jitter, forks: 1,
  });
}

/**
 * Number of hostile entities the beam would chain to right now (test helper).
 * @param {object} game
 * @param {THREE.Vector3} point
 * @param {object} shooter
 * @param {object} def
 */
export function countChainTargets(game, point, shooter, def) {
  let n = 0;
  const r2 = def.beam.chainRadius * def.beam.chainRadius;
  for (const e of game.entities) {
    if (!e.alive || e === shooter || e.team === shooter.team) continue;
    e.getChestPosition(_org);
    if (_org.distanceToSquared(point) <= r2) n++;
  }
  return Math.min(n, def.beam.chainMax);
}
