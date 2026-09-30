import * as THREE from 'three';
import { teleport, releaseAll, r2 } from './common.js';
export async function setup(game, report) {
  const R = report.custom = { cases: [] };
  const p = game.player; p.god = true; game.autotest.duration = 1e9; game.state = 'loading';
  const mv = p.move, coll = game.world.collision;
  const DT = 1 / 60;
  const std = mv._capA;
  for (const [x, z] of [[9.85, 17.35], [9.85, 17.5], [10.0, 17.35], [10.0, 17.5], [9.7, 17.5], [10.3, 17.5]]) {
    teleport(game, x, 0, z, 0, 0);
    releaseAll(game);
    for (let i = 0; i < 30; i++) { game.input.setVirtual('crouch', true); game.input.update(); game.update(DT); game.input.endFrame(); }
    const h0 = p.height, y0 = p.position.y;
    // ground truth: standing capsule intersect
    std.start.set(p.position.x, p.position.y + 0.4, p.position.z); std.end.set(p.position.x, p.position.y + 1.4, p.position.z);
    const si = coll.capsuleIntersect(std);
    for (let i = 0; i < 40; i++) { game.input.setVirtual('crouch', false); game.input.update(); game.update(DT); game.input.endFrame(); }
    // after: standing capsule overlap?
    std.start.set(p.position.x, p.position.y + 0.4, p.position.z); std.end.set(p.position.x, p.position.y + 1.4, p.position.z);
    const si2 = p.height > 1.7 ? coll.capsuleIntersect(std) : null;
    R.cases.push({ at: [x, z], hCrouch: r2(h0), y0: r2(y0), standOverlapDepthTruth: si ? r2(si.depth) : 0, normal: si ? si.normal.toArray().map(r2) : null, hAfter: r2(p.height), yAfter: r2(p.position.y), xz: [r2(p.position.x), r2(p.position.z)], overlapAfter: si2 ? r2(si2.depth) : 0 });
  }
  releaseAll(game);
  report.done = true;
}
export function drive() {}
