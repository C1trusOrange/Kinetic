// Verify finding 1 via the REAL throw path (input action 'grenade'), plus finding 6 instrumentation.
import * as THREE from 'three';
const rec = { explosions: [], damage: [], deaths: [], spawnOwners: [], raycast: { calls: 0, hits: 0, restingCalls: 0, restingHits: 0 } };
let phase = 0, t0 = 0, inGren = false;
export function setup(game, report) {
  report.custom = rec;
  game.player.god = false;
  const P = game.projectiles;
  const origSpawn = P.spawnGrenade.bind(P);
  P.spawnGrenade = (o) => { rec.spawnOwners.push(o.owner === game.player ? 'PLAYER' : (o.owner && o.owner.name) || null); return origSpawn(o); };
  const origUG = P._updateGrenade.bind(P);
  const origRC = game.combat.raycast.bind(game.combat);
  game.combat.raycast = function (o, d, m, ig) {
    const r = origRC(o, d, m, ig);
    if (inGren) {
      rec.raycast.calls++; if (r) rec.raycast.hits++;
      const g = P.grenades[0];
      if (g && g.resting) { rec.raycast.restingCalls++; if (r) rec.raycast.restingHits++; }
    }
    return r;
  };
  P._updateGrenade = function (g, dt, k) { inGren = true; const r = origUG(g, dt, k); inGren = false; return r; };
  game.events.on('explosion', e => rec.explosions.push({ t: +game.time.toFixed(2), weapon: e.weapon, ownerIsPlayer: e.owner === game.player, owner: e.owner ? e.owner.name : null }));
  game.events.on('damage', e => rec.damage.push({ t: +game.time.toFixed(2), weapon: e.weapon, amount: +e.amount.toFixed(1), attacker: e.attacker ? (e.attacker === game.player ? 'PLAYER' : e.attacker.name) : null, target: e.target === game.player ? 'PLAYER' : e.target.name }));
  game.events.on('death', e => rec.deaths.push({ t: +game.time.toFixed(2), weapon: e.weapon, attacker: e.attacker ? (e.attacker === game.player ? 'PLAYER' : e.attacker.name) : null, victim: e.victim === game.player ? 'PLAYER' : e.victim.name }));
}
export function drive(t, dt, game, report) {
  const p = game.player, inp = game.input;
  if (t < 1.5) return;
  if (phase === 0) {
    rec.kills0 = p.kills; rec.hp0 = p.health; rec.mode = game.match && game.match.mode; rec.pTeam = p.team;
    rec.bots = game.bots.list.map(b => ({ n: b.name, team: b.team }));
    inp.setVirtual('grenade', true); phase = 1; t0 = t; // pull pin, cook
  } else if (phase === 1 && t - t0 > 0.6) {
    inp.setVirtual('grenade', false); phase = 2; t0 = t; // release -> throw
  } else if (phase === 2 && t - t0 > 4.5) {
    rec.kills1 = p.kills; rec.hp1 = p.health; rec.alive = p.alive;
    rec.finalOwnerOfSpawned = rec.spawnOwners;
    phase = 3;
  }
}
