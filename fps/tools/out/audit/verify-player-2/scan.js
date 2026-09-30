// Verifier: scan floors with low ceilings; compare PlayerController._canStand() to ground truth (standing capsule clearance via capsuleIntersect + upward ray)
import * as THREE from 'three';
import { r2 } from './common.js';
export async function setup(game, report) {
  const R = report.custom = { map: game.world.mapId, spots: 0, wrongTrue: 0, wrongFalse: 0, examples: [] };
  const p = game.player; game.autotest.duration = 1e9; game.state = 'loading';
  const mv = p.move, coll = game.world.collision, b = game.world.bounds;
  const STEP = parseFloat(new URLSearchParams(location.search).get('step') || '0.5');
  const down = new THREE.Vector3(0, -1, 0), up = new THREE.Vector3(0, 1, 0);
  const o = new THREE.Vector3();
  const cap = mv.capsule;
  const std = { start: new THREE.Vector3(), end: new THREE.Vector3(), radius: 0.4 };
  for (let x = b.min.x + 0.25; x < b.max.x; x += STEP) {
    for (let z = b.min.z + 0.25; z < b.max.z; z += STEP) {
      let y = b.max.y + 5;
      for (let k = 0; k < 10; k++) {
        o.set(x, y, z);
        const h = coll.raycast(o, down, 300);
        if (!h) break;
        y = h.point.y - 0.05;
        if (h.normal.y < 0.7) continue;
        const fy = h.point.y;
        // crouched capsule must fit here
        mv.crouched = true; p.height = 1.15;
        cap.start.set(x, fy + 0.4 + 0.01, z); cap.end.set(x, fy + 0.4 + 0.01 + 1.15 - 0.8, z);
        const inter = coll.capsuleIntersect(cap);
        if (inter && inter.depth > 0.02) continue;
        // ground truth: does the STANDING capsule (feet at fy+0.01) fit? use capsuleIntersect on standing capsule
        // (one-sided planes: inside-of-box case not relevant here) AND an upward ray from the center-line for the head
        const sc = mv._capA;
        sc.start.set(x, fy + 0.4 + 0.01, z); sc.end.set(x, fy + 0.01 + 1.8 - 0.4, z);
        const si = coll.capsuleIntersect(sc);
        // head sphere top must be free: cast up from capsule top-sphere centre-line
        o.set(x, fy + 0.02, z);
        const u = coll.raycast(o, up, 3);
        const headroom = u ? u.distance : 9;
        const truthBlocked = (si && si.depth > 0.03) || headroom < 1.78;
        if (!truthBlocked) continue;
        if (headroom < 1.17) continue; // crouched capsule (1.15) must actually fit under the ceiling
        R.spots++;
        // now the actual code under test, with the capsule at the crouch pose
        cap.start.set(x, fy + 0.4 + 0.01, z); cap.end.set(x, fy + 0.4 + 0.01 + 1.15 - 0.8, z);
        const can = mv._canStand();
        if (can) {
          R.wrongTrue++;
          if (R.examples.length < 40) R.examples.push({ x: r2(x), y: r2(fy), z: r2(z), headroom: r2(headroom), depth: si ? r2(si.depth) : 0, ceilN: u ? u.normal.toArray().map(r2) : null, floorN: h.normal.toArray().map(r2) });
        }
      }
    }
  }
  mv.crouched = false; p.height = 1.8;
  report.done = true;
}
export function drive() {}
