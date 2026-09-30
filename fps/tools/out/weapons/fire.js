// Weapons scenario: cycles weapons, fires, reloads, aims, throws a grenade, bashes.
const log = [];
const counts = { fire: 0, switch: 0, explosion: 0, damage: 0 };
let last = -1;
const fired = {};

export function setup(game, report) {
  game.events.on('weapon:fire', e => { counts.fire++; fired[e.weapon] = (fired[e.weapon] || 0) + 1; });
  game.events.on('weapon:switch', e => { counts.switch++; log.push(['switch', +game.time.toFixed(2), e.weapon]); });
  game.events.on('explosion', e => { counts.explosion++; log.push(['explosion', +game.time.toFixed(2), e.weapon, +e.radius.toFixed(1)]); });
  game.events.on('damage', () => { counts.damage++; });
  game.player.god = true;
  report.custom = { log, counts, fired, snaps: [] };
  window.__W = game.weapons;
}

const S = (t, a, b) => t >= a && t < b;

export function drive(t, dt, game, report) {
  const inp = game.input;
  const w = game.weapons;
  if (t > 0.2 && !game._gaveW) { game._gaveW = true; log.push(['give sniper', w.giveWeapon('sniper')], ['give rocket', w.giveWeapon('rocket')]); log.push(['owned', w.owned.join(',')]); }
  // rifle burst
  inp.setVirtual('fire', S(t, 1.0, 1.7) || S(t, 4.2, 4.25) || S(t, 4.6, 4.65) || S(t, 5.0, 5.05) || S(t, 6.3, 6.35) || S(t, 7.6, 7.65) || S(t, 12.6, 12.65) || S(t, 14.0, 14.05));
  inp.setVirtual('reload', S(t, 2.0, 2.05) || S(t, 8.2, 8.25));
  inp.setVirtual('weapon1', S(t, 4.0, 4.05));
  inp.setVirtual('weapon3', S(t, 6.0, 6.05));
  inp.setVirtual('weapon4', S(t, 10.5, 10.55));
  inp.setVirtual('weapon5', S(t, 12.0, 12.05));
  inp.setVirtual('ads', S(t, 10.9, 12.0));
  inp.setVirtual('grenade', S(t, 15.0, 16.0));
  inp.setVirtual('melee', S(t, 17.0, 17.05));
  inp.setVirtual('lastWeapon', S(t, 17.6, 17.65));
  if (t - last >= 0.5) {
    last = t;
    report.custom.snaps.push(`t${t.toFixed(1)} ${w.currentId} ${w.ammo}/${w.reserve === Infinity ? 'inf' : w.reserve} rl${w.reloading ? w.reloadProgress.toFixed(2) : 0} ads${w.adsAmount.toFixed(2)} sc${w.scoped ? 1 : 0} spr${w.spreadAngle.toFixed(4)} gr${w.grenades} cook${w.cookProgress.toFixed(2)} pg${game.projectiles.grenades.length} pr${game.projectiles.rockets.length}`);
  }
}

export function finish(game, report) {
  const w = game.weapons;
  report.custom.final = { id: w.currentId, owned: w.owned.join(','), grenades: w.grenades };
}
