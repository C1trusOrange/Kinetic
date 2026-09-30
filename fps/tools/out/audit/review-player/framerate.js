// Frame-rate independence: same time-based input script at several frame rates; compare end state.
import * as THREE from 'three';
import { teleport, keys, releaseAll, r2, hs } from './common.js';

export async function setup(game, report) {
  const R = report.custom = { runs: {} };
  const p = game.player;
  p.god = true;
  game.autotest.duration = 1e9;
  game.state = 'loading';
  const script = (t) => ({
    forward: t >= 0.0 && t < 3.9,
    sprint: t >= 0.0 && t < 3.9,
    crouch: t >= 1.5 && t < 2.3,
    jump: (t >= 2.5 && t < 2.5 + 1 / 30) || (t >= 3.0 && t < 3.0 + 1 / 30),
  });
  for (const fps of [240, 120, 60, 30, 20]) {
    const DT = 1 / fps;
    teleport(game, -25, 0, 0, -Math.PI / 2, 0);
    p.weaponsBlocked = true;
    game.time = 0;
    const N = Math.round(4.0 * fps);
    const states = {}; let maxV = 0, lastLog = [];
    for (let i = 0; i < N; i++) {
      const t = i * DT;
      const k = script(t);
      for (const [a, v] of Object.entries(k)) game.input.setVirtual(a, v);
      game.input.update(); game.update(DT); game.input.endFrame();
      states[p.move.state] = (states[p.move.state] || 0) + 1;
      maxV = Math.max(maxV, hs(p));
      if (Math.abs(t - 1.4) < DT / 2 || Math.abs(t - 2.4) < DT / 2 || Math.abs(t - 3.4) < DT / 2) lastLog.push([r2(t), r2(p.position.x), r2(p.position.y), r2(hs(p)), p.move.state]);
    }
    R.runs[fps] = { pos: [r2(p.position.x), r2(p.position.y), r2(p.position.z)], v: [r2(p.velocity.x), r2(p.velocity.y), r2(p.velocity.z)], maxV: r2(maxV), log: lastLog };
    releaseAll(game);
    // reset all inputs and let things settle
    for (let i = 0; i < 30; i++) { game.input.update(); game.update(1 / 60); game.input.endFrame(); }
  }
  report.done = true;
}
export function drive() {}
