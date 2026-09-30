import { rooms } from './testmap2.js';
import { r2 } from './common.js';
export async function setup(game, report) {
  const R = report.custom = { out: [] };
  const p = game.player; game.autotest.duration = 1e9; game.state = 'loading';
  const mv = p.move, coll = game.world.collision;
  for (const rm of rooms.slice(0, 14)) {
    const c = mv._capA;
    const y = 0;
    c.start.set(rm.x, y + 0.4 + 0.02, rm.z);
    c.end.set(rm.x, y + 1.8 - 0.4 + 0.02, rm.z);
    const s0 = c.start.clone();
    const res = coll.resolveCapsule(c);
    R.out.push({ clear: rm.clear, thick: rm.thick, floorFirst: rm.floorFirst, clearRes: mv._capsuleClear(rm.x, y, rm.z), contacts: Array.from({ length: res.count }, (_, i) => [r2(res.normals[i].y), r2(res.depths[i])]), dy: r2(c.start.y - s0.y) });
  }
  report.done = true;
}
export function drive() {}
