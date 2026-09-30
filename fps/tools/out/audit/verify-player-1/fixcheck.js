import * as THREE from 'three';
import { Capsule } from 'three/addons/math/Capsule.js';
import { teleport, r2 } from './common.js';
export async function setup(game, report) {
  const R = report.custom = { cases: [] };
  const p = game.player; game.autotest.duration = 1e9; game.state = 'loading';
  const mv = p.move, coll = game.world.collision;
  const up = new THREE.Vector3(0, 1, 0);
  const cap = new Capsule(new THREE.Vector3(), new THREE.Vector3(), 0.4);
  const o = new THREE.Vector3();
  for (const [x, z] of [[0, 22], [-1, 22.5], [2, 24], [0.5, 23], [1, 22.5], [-2, 24], [0.2, 25], [-1.5, 21]]) {
    const fy = 1.5;
    mv.crouched = true; p.height = 1.15;
    mv.capsule.start.set(x, fy + 0.4, z); mv.capsule.end.set(x, fy + 0.75, z);
    const canStand = mv._canStand();
    // standing capsule intersect (fix suggestion 1)
    cap.start.set(x, fy + 0.4, z); cap.end.set(x, fy + 1.4, z);
    const ci = coll.capsuleIntersect(cap);
    // contact based (fix suggestion 2)
    cap.start.set(x, fy + 0.4, z); cap.end.set(x, fy + 1.4, z);
    const c = coll.resolveCapsule(cap);
    let ceilContact = false; for (let k = 0; k < c.count; k++) if (c.normals[k].y < -0.5 && c.depths[k] > 0.02) ceilContact = true;
    // upward raycast fix
    let rayBlocked = false;
    for (const [ox, oz] of [[0,0],[0.24,0],[-0.24,0],[0,0.24],[0,-0.24]]) {
      o.set(x + ox, fy + 0.02, z + oz);
      const h = coll.raycast(o, up, 1.8);
      if (h && h.normal.y < -0.5) rayBlocked = true;
    }
    R.cases.push({ x, z, canStand, capIntersectDepth: ci ? r2(ci.depth) : 0, ceilContactBlocked: ceilContact, rayBlocked });
  }
  mv.crouched = false; p.height = 1.8;
  report.done = true;
}
export function drive() {}
