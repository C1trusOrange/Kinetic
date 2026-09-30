const rec = { log: [] };
let phase = 0, t0 = 0;
export function setup(game, report) { report.custom = rec; game.player.god = true; }
const snap = (game, k) => { const w = game.weapons; rec.log.push([k, { state: game.state, cooking: w.cooking, gState: w.gState, dots: w.previewDots.visible, dotsCount: w.previewDots.count, ring: w.previewRing.visible, inScene: w.previewDots.parent === game.scene }]); };
export function drive(t, dt, game, report) {
  const w = game.weapons, inp = game.input;
  if (phase === 0 && t > 1.0) { inp.setVirtual('grenade', true); phase = 1; t0 = t; }
  if (phase === 1 && t - t0 > 0.7) {
    snap(game, 'before quit');
    game.pause(); snap(game, 'paused'); game.quitToMenu(); snap(game, 'after quitToMenu (sync)'); phase = 2;
    for (const ms of [100, 300, 600, 1000, 1500]) setTimeout(() => { snap(game, "menu +" + ms + "ms"); window.__QLOG = rec.log; if (ms === 1500) window.__QDONE = true; }, ms);
  }
}
