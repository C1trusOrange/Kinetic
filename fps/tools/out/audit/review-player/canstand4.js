import { r2 } from './common.js';
export async function setup(game, report) {
  const R = report.custom = { pts: [] };
  const p = game.player; game.autotest.duration = 1e9; game.state = 'loading';
  const mv = p.move;
  for (const [x, z] of [[0, 22], [0, 23], [0, 24], [0.5, 23], [-0.5, 23], [1, 22.5], [-1, 22.5], [2, 24], [-2, 24], [0, 21], [1.5, 21]]) {
    const cap = mv.capsule; mv.crouched = true; p.height = 1.15;
    cap.start.set(x, 1.5 + 0.4, z); cap.end.set(x, 1.5 + 0.4 + 1.15 - 0.8, z);
    const st = mv._canStand();
    const cl = mv._capsuleClear(x, 1.5, z);
    R.pts.push({ x, z, canStand: st, capsuleClear: cl });
  }
  report.done = true;
}
export function drive() {}
