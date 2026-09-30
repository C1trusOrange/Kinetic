const rec = { log: [] };
let phase = 0, t0 = 0;
export function setup(game, report) { report.custom = rec; game.player.god = true; }
export function drive(t, dt, game, report) {
  const w = game.weapons, p = game.player, inp = game.input;
  if (game.state === 'menu') return;
  if (phase === 0 && t > 0.5) { inp.setVirtual('grenade', true); phase = 1; t0 = t; }
  if (phase === 1 && t - t0 > 1.0) {
    rec.log.push(['cooking', { cooking: w.cooking, dots: w.previewDots.visible, ring: w.previewRing.visible, count: w.previewDots.count }]);
    game.pause();
    phase = 2;
  }
  if (phase === 2) {
    game.quitToMenu();
    inp.setVirtual('grenade', false);
    phase = 3;
    window.__QC_DONE__ = true;
  }
}
