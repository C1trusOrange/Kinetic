const log = [];
export function setup(game, report) {
  report.custom = { log };
  const w = game.weapons;
  w.giveWeapon('rocket');
  game.events.on('explosion', e => log.push(['explosion', +game.time.toFixed(3), e.position.toArray().map(v => +v.toFixed(2))]));
}
let fired = false;
export function drive(t, dt, game, report) {
  const w = game.weapons, p = game.player;
  if (t > 1.0 && !fired) { fired = true; w._applyWeapon('rocket'); w.switchState = 0; w.equipAmount = 1; p.pitch = -0.02; game.input.setVirtual('fire', true); }
  if (t > 1.05) game.input.setVirtual('fire', false);
  for (const r of game.projectiles.rockets) log.push(['r', +t.toFixed(3), +dt.toFixed(3), r.position.toArray().map(v => +v.toFixed(2)), r.direction.toArray().map(v => +v.toFixed(3))]);
  if (t > 3) report.done = true;
}
