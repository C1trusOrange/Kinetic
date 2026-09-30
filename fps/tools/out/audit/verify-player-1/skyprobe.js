import * as THREE from 'three';
import { r2 } from './common.js';
export async function setup(game, report) {
  const R = report.custom = { rows: [], tri: null };
  const p = game.player; game.autotest.duration = 1e9; game.state = 'loading';
  const mv = p.move, coll = game.world.collision;
  const up = new THREE.Vector3(0, 1, 0);
  const cap = mv.capsule;
  const o = new THREE.Vector3();
  for (let x = 9; x <= 11.01; x += 0.25) {
    for (let z = 16.5; z <= 18.51; z += 0.25) {
      o.set(x, 0.02, z);
      const u = coll.raycast(o, up, 3);
      mv.crouched = true; p.height = 1.15;
      cap.start.set(x, 0.4, z); cap.end.set(x, 0.75, z);
      const inter = coll.capsuleIntersect(cap);
      const can = mv._canStand();
      const clr = mv._capsuleClear(x, 0, z);
      R.rows.push([x, z, u ? r2(u.distance) : null, u ? u.normal.toArray().map(r2).join(',') : null, inter ? r2(inter.depth) : 0, can, clr]);
    }
  }
  // what solid is above
  o.set(10, 0.02, 17.5);
  const u = coll.raycast(o, up, 3);
  if (u) R.tri = { a: u.triangle.a.toArray().map(r2), b: u.triangle.b.toArray().map(r2), c: u.triangle.c.toArray().map(r2), surface: u.surface };
  mv.crouched = false; p.height = 1.8;
  report.done = true;
}
export function drive() {}
