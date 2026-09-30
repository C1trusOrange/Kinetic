// Scan real map floors that have a ceiling 1.2..1.75 m above (crouched capsule fits, standing capsule must NOT):
// does PlayerController._canStand() / _capsuleClear() agree?
import * as THREE from 'three';
import { r2 } from './common.js';
export async function setup(game, report) {
  const R = report.custom = { map: game.world.mapId, spots: 0, canStandTrue: 0, clearTrue: 0, examples: [] };
  const p = game.player; game.autotest.duration = 1e9; game.state = 'loading';
  const mv = p.move, coll = game.world.collision, b = game.world.bounds;
  const STEP = parseFloat(new URLSearchParams(location.search).get('step') || '0.75');
  const down = new THREE.Vector3(0, -1, 0), up = new THREE.Vector3(0, 1, 0);
  const o = new THREE.Vector3();
  const cap = mv.capsule;
  for (let x = b.min.x + 0.5; x < b.max.x; x += STEP) {
    for (let z = b.min.z + 0.5; z < b.max.z; z += STEP) {
      let y = b.max.y + 5;
      for (let k = 0; k < 8; k++) {
        o.set(x, y, z);
        const h = coll.raycast(o, down, 200);
        if (!h) break;
        y = h.point.y - 0.05;
        if (h.normal.y < 0.985) continue;
        const fy = h.point.y;
        // headroom above the floor
        o.set(x, fy + 0.02, z);
        const u = coll.raycast(o, up, 3.0);
        if (!u || u.distance < 1.2 || u.distance > 1.72) continue;
        // crouched capsule must fit here (no penetration) and not be overlapping walls
        mv.crouched = true; p.height = 1.15;
        cap.start.set(x, fy + 0.4, z); cap.end.set(x, fy + 0.4 + 1.15 - 0.8, z);
        const inter = coll.capsuleIntersect(cap);
        if (inter && inter.depth > 0.03) continue;
        // ledge must be a real surface for standing: skip if a wall is within radius (would confuse test)
        R.spots++;
        const can = mv._canStand();
        const clr = mv._capsuleClear(x, fy, z);
        if (can) R.canStandTrue++;
        if (clr) R.clearTrue++;
        if ((can || clr) && R.examples.length < 12) R.examples.push({ x: r2(x), y: r2(fy), z: r2(z), headroom: r2(u.distance), canStand: can, capsuleClear: clr, ceilN: u.normal.toArray().map(r2) });
      }
    }
  }
  mv.crouched = false; p.height = 1.8;
  report.done = true;
}
export function drive() {}
