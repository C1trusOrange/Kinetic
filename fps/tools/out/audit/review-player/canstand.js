import * as THREE from 'three';
import { rooms } from './testmap2.js';
import { r2 } from './common.js';
export async function setup(game, report) {
  const R = report.custom = { results: [], wrong: 0, total: 0 };
  const p = game.player; p.god = true;
  game.autotest.duration = 1e9; game.state = 'loading';
  const mv = p.move;
  for (const rm of rooms) {
    // crouched capsule standing on the room floor (feet y = 0), 1.15 tall
    const c = mv.capsule;
    mv.crouched = true;
    c.start.set(rm.x, 0.4, rm.z);
    c.end.set(rm.x, 0.4 + 1.15 - 0.8, rm.z);
    p.height = 1.15;
    const can = mv._canStand();
    const shouldBe = rm.clear >= 1.8 + 0.03;   // never in this grid
    const cl = mv._capsuleClear(rm.x, 0, rm.z);
    (R.clearWrong = R.clearWrong || []); if (cl) R.clearWrong.push(rm);
    R.total++;
    if (can !== shouldBe) { R.wrong++; R.results.push({ ...rm, can }); }
  }
  report.done = true;
}
export function drive() {}
