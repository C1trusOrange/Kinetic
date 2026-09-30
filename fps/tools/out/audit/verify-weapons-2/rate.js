const rec = { shots: 0, t0: null, t1: null, n: 0, sumDt: 0, gaps: {} };
let lastFire = null;
export function setup(game, report) {
  report.custom = rec;
  game.player.god = true;
  game.events.on('weapon:fire', e => {
    if (e.shooter !== game.player || rec.t0 === null || rec.t1 !== null) return;
    rec.shots++;
    if (lastFire !== null) { const g = (game.time - lastFire).toFixed(3); rec.gaps[g] = (rec.gaps[g] || 0) + 1; }
    lastFire = game.time;
  });
}
export function drive(t, dt, game, report) {
  const w = game.weapons, inp = game.input;
  if (t < 1.0) return;
  if (rec.t0 === null) rec.t0 = game.time;
  if (rec.t1 === null) {
    w.inv.rifle.ammo = 32; w.ammo = 32;
    inp.setVirtual('fire', true);
    rec.n++; rec.sumDt += dt;
    if (game.time - rec.t0 >= 6) { rec.t1 = game.time; inp.setVirtual('fire', false); rec.perSec = +(rec.shots / (rec.t1 - rec.t0)).toFixed(3); rec.hz = +(rec.n / rec.sumDt).toFixed(1); rec.def = game.weapons.current.fireRate; }
  }
}
