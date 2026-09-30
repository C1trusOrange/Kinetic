const rec = { log: [], dmg: [] };
const L = (k, v) => rec.log.push([k, v]);
let phase = 0, t0 = 0, spawnFuse = null, tPin = null;
export function setup(game, report) {
  report.custom = rec;
  game.player.god = false;
  game.events.on('damage', e => { if (e.target === game.player) rec.dmg.push({ t: +game.time.toFixed(2), w: e.weapon, a: +e.amount.toFixed(1), att: e.attacker ? 'p' : null }); });
  game.events.on('explosion', e => L('explosion', { t: +game.time.toFixed(2), w: e.weapon, owner: !!e.owner }));
}
export function drive(t, dt, game, report) {
  const w = game.weapons, p = game.player, inp = game.input;
  const el = t - t0;
  const gl = game.projectiles.grenades;
  switch (phase) {
    case 0: if (t > 1.8) { p.spawnProtectedUntil = 0; L('grenades start', w.grenades); inp.setVirtual('grenade', true); tPin = t; phase = 1; t0 = t; } break;
    case 1: // cook past fuse
      if (el > 0.5 && w.grenades === 1 && !rec.cookCountLogged) { rec.cookCountLogged = 1; L('count after pin', w.grenades); }
      if (w.gState === 4 && !rec.cookoff) { rec.cookoff = +(t - tPin).toFixed(2); L('cookoff after', rec.cookoff); L('projectile grenades', gl.length); L('hp', p.health); }
      if (el > 4.0) { inp.setVirtual('grenade', false); phase = 2; t0 = t; }
      break;
    case 2:
      if (el > 1.0) { p.health = 100; L('state after cookoff', { g: w.gState, cooking: w.cooking, grenades: w.grenades }); phase = 3; t0 = t; }
      break;
    case 3: inp.setVirtual('grenade', true); tPin = t; phase = 4; t0 = t; break;
    case 4:
      if (el > 1.5) { inp.setVirtual('grenade', false); phase = 5; t0 = t; }
      break;
    case 5:
      if (gl.length && spawnFuse === null) { spawnFuse = +gl[0].fuse.toFixed(2); L('thrown fuse at first sight', { fuse: spawnFuse, sincePin: +(t - tPin).toFixed(2), count: w.grenades }); }
      if (el > 3.0) { L('end', { grenades: w.grenades, live: gl.length }); phase = 6; }
      break;
  }
}
