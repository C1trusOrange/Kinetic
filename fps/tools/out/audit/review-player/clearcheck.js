import * as THREE from 'three';
import { teleport, releaseAll, r2 } from './common.js';
export async function setup(game, report) {
  const R = report.custom = {};
  const p = game.player; p.god = true;
  game.autotest.duration = 1e9; game.state = 'loading';
  const mv = p.move, coll = game.world.collision;
  const test = (name, x, y, z) => {
    const c = mv._capA;
    c.start.set(x, y + 0.4 + 0.02, z);
    c.end.set(x, y + 1.8 - 0.4 + 0.02, z);
    const s0 = c.start.clone(), e0 = c.end.clone();
    const inter0 = coll.capsuleIntersect(c);
    const res = coll.resolveCapsule(c);
    R[name] = { clear: mv._capsuleClear(x, y, z), penetrationBefore: inter0 ? r2(inter0.depth) : 0, contacts: Array.from({ length: res.count }, (_, i) => [r2(res.normals[i].x), r2(res.normals[i].y), r2(res.normals[i].z), r2(res.depths[i])]), startDelta: [r2(c.start.x - s0.x), r2(c.start.y - s0.y), r2(c.start.z - s0.z)] };
  };
  test('lowSlabLedge_0.47in', 0, 1.5, 20.47);
  test('lowSlabLedge_1.5in', 0, 1.5, 21.5);
  test('lowSlabLedge_3in', 0, 1.5, 23.0);
  test('thickSlabLedge', -17, 1.2, 21.0);
  test('highCeilLedge', 13, 1.5, 21.0);
  report.done = true;
}
export function drive() {}
