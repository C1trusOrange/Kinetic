// cycles through the five weapons, 4 s each: hip for 2.4 s then ADS
export function setup(game, report) {
  report.custom = { t0wall: +(performance.now() / 1000).toFixed(2) };
  game.player.god = true;
  // give everything
  for (const id of ['pistol', 'rifle', 'shotgun', 'sniper', 'rocket']) game.player.giveWeapon(id);
}
let last = -1;
export function drive(t, dt, game, report) {
  const slot = Math.min(5, Math.floor(t / 4) + parseInt(game.params.get('first') || '1', 10));
  const local = t - Math.floor(t / 4) * 4;
  if (slot !== last) { last = slot; game.input.setVirtual('weapon' + slot, true); }
  else game.input.setVirtual('weapon' + slot, false);
  game.input.setVirtual('ads', !game.params.get('noads') && local > 2.5 && local < 3.9);
  report.custom.slot = slot;
}
