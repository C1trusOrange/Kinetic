import * as THREE from 'three';
import { WEAPONS } from '/src/weapons/WeaponDefs.js';
const S = { emptyHold: {}, reloadStuck: [], fireBlocked: {}, weaponTime: {}, reloadTimeMax: {}, switches: 0, emptyEngaged: 0, samples: 0, noAmmoAll: 0 };
export async function setup(game, report) { report.custom = S; for (const b of game.bots.list) { b._rs = 0; b._empt = 0; b._fb = 0; } }
export function drive(t, dt, game) {
  for (const b of game.bots.list) {
    if (!b.alive) { b._rs = 0; b._empt = 0; continue; }
    const inv = b.inv[b.weaponId]; const def = WEAPONS[b.weaponId];
    S.weaponTime[b.weaponId] = (S.weaponTime[b.weaponId] || 0) + dt;
    if (b.reloading) { b._rs += dt; if (b._rs > (def.reloadTime + 1.5)) { if (S.reloadStuck.length < 10) S.reloadStuck.push({ bot: b.name, w: b.weaponId, rs: +b._rs.toFixed(1), mag: inv.mag, res: inv.reserve, t: +t.toFixed(1) }); } S.reloadTimeMax[b.weaponId] = Math.max(S.reloadTimeMax[b.weaponId] || 0, b._rs); }
    else b._rs = 0;
    if (inv.mag <= 0 && !(inv.reserve > 0)) {
      b._empt += dt;
      if (b._empt > 1.5) { S.emptyHold[b.weaponId] = (S.emptyHold[b.weaponId] || 0) + dt; }
    } else b._empt = 0;
    // brain wants to fire, but the weapon can't (mag>0, not reloading, not equipping, ready) => blocked?
    if (b.brain.intent.fire && inv.mag > 0 && !b.reloading && game.time >= b.nextFireAt && game.time >= b.equipUntil) { /* would have fired this frame */ }
  }
}
export function finish(game) {
  for (const k in S.weaponTime) S.weaponTime[k] = +S.weaponTime[k].toFixed(0);
  for (const k in S.emptyHold) S.emptyHold[k] = +S.emptyHold[k].toFixed(1);
  for (const k in S.reloadTimeMax) S.reloadTimeMax[k] = +S.reloadTimeMax[k].toFixed(1);
  S.stats = game.bots.list.map(b => `${b.name}:${b.stats.shots}/${b.stats.pelletHits}/g${b.stats.grenades}`).join(' ');
}
