// holds one weapon (param first=slot) with optional ADS (param ads=1)
export function setup(game, report) {
  report.custom = {};
  game.player.god = true;
  for (const id of ['pistol', 'rifle', 'shotgun', 'sniper', 'rocket']) game.player.giveWeapon(id);
}
let sent = false;
export function drive(t, dt, game, report) {
  const slot = parseInt(game.params.get('first') || '2', 10);
  if (!sent && t > 0.3) { sent = true; game.input.setVirtual('weapon' + slot, true); }
  else game.input.setVirtual('weapon' + slot, false);
  game.input.setVirtual('ads', game.params.get('ads') === '1' && t > 1.8);
}
