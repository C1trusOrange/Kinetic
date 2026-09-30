// Verifier: grapple attached, then end the match / quit to menu; sample audio loops and grapple visuals.
import { teleport, keys, releaseAll, r2, loopInfo } from './common.js';
const mode = new URLSearchParams(location.search).get('mode2') || 'end';
let phase = 0, t0 = 0;
export async function setup(game, report) { report.custom = { mode }; game.player.god = true; game.autotest.duration = 9999; }
export function drive(t, dt, game, report) {
  const R = report.custom, p = game.player;
  if (phase === 0 && t > 0.6) { phase = 1; t0 = t; teleport(game, 14, 0, 0, -Math.PI / 2, 0.83); }
  if (phase === 1) {
    const lt = t - t0;
    keys(game, { grapple: lt > 0.1 && lt < 0.15 });
    if (p.grapple.attached && !R.attT) R.attT = lt;
    if (R.attT && lt > R.attT + 0.25) {
      R.before = { gstate: p.grapple.state, ...loopInfo(game), gvis: p.grapple.group.visible, anchor: p.grapple.anchor.toArray().map(r2) };
      phase = 2;
      if (mode === 'end') game.endMatch('score');
      if (mode === 'quit') setTimeout(() => game.quitToMenu(), 0);
      const sample = (label, ms) => setTimeout(() => {
        R[label] = { gstate: p.grapple.state, ...loopInfo(game), gvis: p.grapple.group.visible, alive: p.alive, ropeVis: p.grapple.rope.visible, endTimer: game._endTimer, loops: game.audio.loops.size };
      }, ms);
      sample('t1s', 1000); sample('t4s', 4500);
      setTimeout(() => { report.done = true; }, 5000);
    }
  }
}
