// Verifier: _capsuleClear vs headroom truth over real map floors (mantle landing test)
import * as THREE from 'three';
import { r2 } from './common.js';
export async function setup(game, report) {
  const R = report.custom = { map: game.world.mapId, spots: 0, wrongClear: 0, examples: [] };
  const p = game.player; game.autotest.duration = 1e9; game.state = 'loading';
  const mv = p.move, coll = game.world.collision, b = game.world.bounds;
  const STEP = parseFloat(new URLSearchParams(location.search).get('step') || '0.6');
  const down = new THREE.Vector3(0, -1, 0), up = new THREE.Vector3(0, 1, 0);
  const o = new THREE.Vector3();
  for (let x = b.min.x + 0.25; x < b.max.x; x += STEP) {
    for (let z = b.min.z + 0.25; z < b.max.z; z += STEP) {
      let y = b.max.y + 5;
      for (let k = 0; k < 10; k++) {
        o.set(x, y, z);
        const h = coll.raycast(o, down, 300);
        if (!h) break;
        y = h.point.y - 0.05;
        if (h.normal.y < 0.85) continue;
        const fy = h.point.y;
        o.set(x, fy + 0.02, z);
        const u = coll.raycast(o, up, 3);
        const headroom = u ? u.distance : 9;
        if (headroom > 1.7 || headroom < 0.3) continue;
        // require the standing capsule to have no wall-ish overlap: cast horizontal rays at knee height to ensure open space around (radius .5)
        let open = true;
        for (let a = 0; a < 8; a++) {
          const ang = a * Math.PI / 4;
          o.set(x, fy + 0.5, z);
          const d = new THREE.Vector3(Math.cos(ang), 0, Math.sin(ang));
          if (coll.raycast(o, d, 0.55)) { open = false; break; }
        }
        if (!open) continue;
        R.spots++;
        const clr = mv._capsuleClear(x, fy, z);
        if (clr) {
          R.wrongClear++;
          if (R.examples.length < 25) R.examples.push({ x: r2(x), y: r2(fy), z: r2(z), headroom: r2(headroom), ceilN: u ? u.normal.toArray().map(r2) : null });
        }
      }
    }
  }
  report.done = true;
}
export function drive() {}
