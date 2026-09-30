import * as THREE from 'three';
import { r2 } from './common.js';
export async function setup(game, report) {
  const R = report.custom = { map: game.world.mapId, pts: [] };
  const p = game.player; game.autotest.duration = 1e9; game.state = 'loading';
  const mv = p.move, coll = game.world.collision;
  const cap = mv.capsule;
  const up = new THREE.Vector3(0, 1, 0), o = new THREE.Vector3();
  function test(x, fy, z) {
    mv.crouched = true; p.height = 1.15;
    cap.start.set(x, fy + 0.41, z); cap.end.set(x, fy + 0.41 + 0.35, z);
    const inter = coll.capsuleIntersect(cap);
    const can = mv._canStand();
    o.set(x, fy + 0.02, z);
    const u = coll.raycast(o, up, 3);
    return { x: r2(x), z: r2(z), can, headroom: u ? r2(u.distance) : null, ceilN: u ? u.normal.toArray().map(r2) : null, crouchDepth: inter ? r2(inter.depth) : 0 };
  }
  const centers = [[10, 0, 17.5], [0.25, 20.1, 0.25]];
  for (const [cx, cy, cz] of centers) {
    for (let dx = -0.3; dx <= 0.31; dx += 0.15) for (let dz = -0.3; dz <= 0.31; dz += 0.15) {
      R.pts.push(test(cx + dx, cy, cz + dz));
    }
  }
  mv.crouched = false; p.height = 1.8;
  report.done = true;
}
export function drive() {}
