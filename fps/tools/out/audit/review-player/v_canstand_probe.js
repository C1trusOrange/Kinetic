// Show WHY _canStand() is true under a 1.28 m ceiling: the ceiling push-down is undone by the floor push-up inside resolveCapsule().
import * as THREE from 'three';
import { r2 } from './common.js';
export async function setup(game, report) {
  const R = report.custom = { pts: [] };
  const p = game.player; game.autotest.duration = 1e9; game.state = 'loading';
  const mv = p.move, coll = game.world.collision;
  const pts = [[-1.25, 20.1, 0.25], [0.25, 20.1, 0.25], [10, 0, 17.5]];
  for (const [x, y, z] of pts) {
    mv.crouched = true; p.height = 1.15;
    mv.capsule.start.set(x, y + 0.4, z); mv.capsule.end.set(x, y + 0.4 + 0.35, z);
    const can = mv._canStand();
    // replicate _canStand()'s internals and log the contact sequence
    const c = mv._capA;
    c.start.copy(mv.capsule.start); c.end.set(c.start.x, c.start.y + 1.0, c.start.z);
    const s0 = c.start.clone();
    const res = coll.resolveCapsule(c);
    R.pts.push({ at: [x, y, z], canStand: can, contacts: Array.from({ length: res.count }, (_, i) => [r2(res.normals[i].x), r2(res.normals[i].y), r2(res.normals[i].z), r2(res.depths[i])]), netStartDisplacement: r2(c.start.y - s0.y) });
  }
  mv.crouched = false; p.height = 1.8;
  report.done = true;
}
export function drive() {}
