const rec = { shots: 0, t0: null, t1: null, dts: [] };
export function setup(game, report) {
  report.custom = rec;
  game.player.god = true;
  game.events.on('weapon:fire', e => { if (e.shooter === game.player && rec.t0 !== null && rec.t1 === null) rec.shots++; });
}
export function drive(t, dt, game, report) {
  const w = game.weapons, inp = game.input;
  if (t < 1.0) return;
  if (rec.t0 === null) { rec.t0 = game.time; }
  if (rec.t1 === null) {
    w.inv.rifle.ammo = 32; w.ammo = 32;
    inp.setVirtual('fire', true);
    rec.dts.push(dt);
    if (game.time - rec.t0 >= 8) { rec.t1 = game.time; inp.setVirtual('fire', false); rec.simSeconds = +(rec.t1 - rec.t0).toFixed(3); rec.perSec = +(rec.shots / rec.simSeconds).toFixed(3); rec.meanDt = +(rec.dts.reduce((a, b) => a + b, 0) / rec.dts.length).toFixed(4); rec.hz = +(1 / rec.meanDt).toFixed(1); rec.dts = rec.dts.length; }
  }
}
