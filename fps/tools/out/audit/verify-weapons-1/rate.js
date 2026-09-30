const rec = { real: null, sim: {} };
let shots = 0, phase = 0, t0 = 0, gt0 = 0, frames = 0;
export function setup(game, report) {
  report.custom = rec;
  game.player.god = true;
  game.events.on('weapon:fire', () => { shots++; });
}
export function drive(t, dt, game, report) {
  const w = game.weapons, inp = game.input;
  if (phase === 0 && t > 1.0) {
    // direct fixed-step sims (weapons.update only), rifle, held, infinite ammo
    for (const hz of [30, 60, 75, 90, 120, 144, 240]) {
      const d = 1 / hz;
      w.inv.rifle.ammo = 9999; w.ammo = 9999; w.nextFireAt = 0;
      inp.setVirtual('fire', true);
      shots = 0;
      const start = game.time;
      const n = Math.round(hz * 10);
      for (let i = 0; i < n; i++) { game.time += d; w.inv.rifle.ammo = 9999; w.ammo = 9999; w.update(d); }
      rec.sim[hz] = { shots, perSec: +(shots / (game.time - start)).toFixed(3) };
      inp.setVirtual('fire', false);
      w.update(d);
    }
    rec.rifleFireRate = w.current.fireRate; rec.curId = w.currentId;
    phase = 1; t0 = t; gt0 = game.time; shots = 0; frames = 0;
    w.inv.rifle.ammo = 9999; w.ammo = 9999; w.nextFireAt = 0;
    inp.setVirtual('fire', true);
  } else if (phase === 1) {
    frames++;
    w.inv.rifle.ammo = 9999; w.ammo = 9999;
    if (game.time - gt0 >= 6) { inp.setVirtual('fire', false); rec.real = { shots, sim: +(game.time - gt0).toFixed(3), perSec: +(shots / (game.time - gt0)).toFixed(3), frames, hz: +(frames / (game.time - gt0)).toFixed(1) }; phase = 2; }
  }
}
