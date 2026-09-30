import { cells } from './testmap3.js';
import { r2 } from './common.js';
export async function setup(game, report) {
  const R = report.custom = { total: 0, clearWrong: 0, standWrong: 0, rows: [] };
  const p = game.player; game.autotest.duration = 1e9; game.state = 'loading';
  const mv = p.move;
  for (const c of cells) {
    // standing capsule fits when clearance >= 1.82 (never here) -> _capsuleClear must be false
    const cl = mv._capsuleClear(c.x, c.H, c.z);
    // crouched capsule (1.15) on the ledge top: can it stand? Only crouched-fits if clear >= 1.15 (always here). _canStand must be false (standing 1.8 > clear)
    const cap = mv.capsule; mv.crouched = true; p.height = 1.15;
    cap.start.set(c.x, c.H + 0.4, c.z); cap.end.set(c.x, c.H + 0.4 + 1.15 - 0.8, c.z);
    const st = mv._canStand();
    R.total++;
    if (cl) R.clearWrong++;
    if (st) R.standWrong++;
    if (cl || st) R.rows.push({ ...c, clearTrue: cl, standTrue: st });
  }
  report.done = true;
}
export function drive() {}
