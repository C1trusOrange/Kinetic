import { WEAPON_WEIGHTS } from '/src/ai/BotConfig.js';
// Force every bot to spawn with the rocket launcher and record how rockets/grenades behave near walls and the owner.
const R = { rockets: 0, rocketOriginBlocked: 0, rocketOriginNearWall: 0, selfSplash: 0, selfDamage: 0, selfKills: 0, explosions: 0, grenades: 0, grenadeOriginBlocked: 0,
  grenadeSelfDamage: 0, minOwnerDist: 99, samples: [], shots: 0, hits: 0 };
let patched = false;
export function setup(game, report) {
  report.custom = report.custom || {};
  report.custom.R = R;
  for (const k in WEAPON_WEIGHTS) WEAPON_WEIGHTS[k] = k === 'rocket' ? 1 : 0;
  // respawn everyone so the weights apply
  for (const b of game.bots.list) game.respawnEntity(b);
  if (patched) return;
  patched = true;
  const P = game.projectiles;
  const origRocket = P.spawnRocket.bind(P);
  P.spawnRocket = function (o) {
    R.rockets++;
    const owner = o.owner;
    if (owner) {
      const eye = owner.getEyePosition(new game.player.position.constructor());
      if (!game.combat.canSee(eye, o.origin)) { R.rocketOriginBlocked++; if (R.samples.length < 8) R.samples.push({ k: 'blocked', eye: eye.toArray(), org: o.origin.toArray() }); }
      // is the origin inside/very close to a wall along its own travel direction?
      const hit = game.world.raycast(o.origin, o.direction, 1.2);
      if (hit) { R.rocketOriginNearWall++; if (R.samples.length < 8) R.samples.push({ k: 'nearwall', d: +hit.distance.toFixed(2), eye: eye.toArray(), org: o.origin.toArray() }); }
    }
    return origRocket(o);
  };
  const origGren = P.spawnGrenade.bind(P);
  P.spawnGrenade = function (o) {
    R.grenades++;
    const eye = o.owner.getEyePosition(new game.player.position.constructor());
    if (!game.combat.canSee(eye, o.origin)) R.grenadeOriginBlocked++;
    return origGren(o);
  };
  const origExp = P.explode.bind(P);
  P.explode = function (pos, o = {}) {
    R.explosions++;
    if (o.owner && o.owner.alive) {
      const d = o.owner.position.distanceTo(pos);
      R.minOwnerDist = Math.min(R.minOwnerDist, d);
      if (d < 3) R.selfSplash++;
    }
    return origExp(pos, o);
  };
  game.events.on('damage', e => { if (e.attacker && e.attacker === e.target) { R.selfDamage++; if (e.weapon === 'grenade') R.grenadeSelfDamage++; } });
  game.events.on('death', e => { if (e.attacker === e.victim || (e.attacker === null && e.weapon !== 'fall')) R.selfKills++; });
}
export function drive() {}
export function finish(game, report) {
  R.botStats = game.bots.list.map(b => ({ n: b.name, w: b.weaponId, shots: b.stats.shots, dmg: Math.round(b.stats.damage), gren: b.stats.grenades, k: b.kills, d: b.deaths }));
}
