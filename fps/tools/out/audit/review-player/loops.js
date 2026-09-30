// Loop sounds / grapple visuals across pause, match end, quit to menu.
import { teleport, keys, releaseAll, r2, hs, loopInfo } from './common.js';

const mode = new URLSearchParams(location.search).get('mode2') || 'end';
let phase = 0, t0 = 0;

export async function setup(game, report) {
  report.custom = { mode };
  game.player.god = true;
  game.autotest.duration = 9999;
}

export function drive(t, dt, game, report) {
  const R = report.custom;
  const p = game.player;
  if (phase === 0 && t > 0.6) {
    phase = 1; t0 = t;
    if (mode === 'slide') {
      teleport(game, 0, 0, 20, 0, 0);
      p.velocity.set(0, 0, -13);
    } else {
      teleport(game, 14, 0, 0, -Math.PI / 2, 0.83);
    }
  }
  if (phase === 1) {
    const lt = t - t0;
    if (mode === 'slide') {
      keys(game, { forward: true, crouch: lt > 0.05 });
      if (lt > 0.4) {
        R.beforeStop = { sliding: p.isSliding, ...loopInfo(game), slideLoop: p._slideLoop && p._slideLoop.stop !== undefined };
        phase = 2; t0 = t;
        R.triggerState = game.state;
        game.pause();
        setTimeout(() => {
          R.afterPause1500 = { ...loopInfo(game), sliding: p.isSliding, slideLoopIsNoop: p._slideLoop.constructor === Object && Object.keys(p._slideLoop).length === 4 };
          report.done = true;
        }, 2000);
      }
    } else {
      keys(game, { grapple: lt > 0.1 && lt < 0.15 });
      if (p.grapple.attached && !R.attT) R.attT = lt;
      if (R.attT && lt > R.attT + 0.25) {
        R.beforeStop = { attached: p.grapple.attached, gstate: p.grapple.state, ...loopInfo(game), gvis: p.grapple.group.visible };
        phase = 2; t0 = t;
        if (mode === 'end') game.endMatch('score');
        if (mode === 'pause') setTimeout(() => game.pause(), 0);
        if (mode === 'quit') setTimeout(() => game.quitToMenu(), 0);
        setTimeout(() => {
          R.after4s = { attached: p.grapple.attached, gstate: p.grapple.state, ...loopInfo(game), gvis: p.grapple.group.visible, alive: p.alive };
          report.done = true;
        }, 4500);
      }
    }
  }
}
