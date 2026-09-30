// Boundary holes: horizontal rays from just inside the play volume to just outside; a miss = the player can leave the arena there (at that height).
import * as THREE from 'three';
import { r2 } from './common.js';
export async function setup(game, report) {
  const R = report.custom = { map: game.world.mapId, holes: [], byY: {} };
  game.autotest.duration = 1e9; game.state = 'loading';
  const coll = game.world.collision, b = game.world.bounds;
  const dirs = [['+x', 1, 0], ['-x', -1, 0], ['+z', 0, 1], ['-z', 0, -1]];
  let n = 0;
  for (const [name, dx, dz] of dirs) {
    const along = dx !== 0 ? 'z' : 'x';
    const lo = b.min[along] + 1, hi = b.max[along] - 1;
    for (let a = lo; a <= hi; a += 1.0) {
      for (let y = 0.6; y <= b.max.y - 1; y += 1.0) {
        const edge = dx > 0 ? b.max.x : dx < 0 ? b.min.x : dz > 0 ? b.max.z : b.min.z;
        const o = new THREE.Vector3(dx !== 0 ? edge - dx * 2.5 : a, y, dz !== 0 ? edge - dz * 2.5 : a);
        const dir = new THREE.Vector3(dx, 0, dz);
        const h = coll.raycast(o, dir, 8);
        if (!h) {
          n++;
          const k = name + '@' + r2(a);
          R.byY[name + ':' + Math.floor(y)] = (R.byY[name + ':' + Math.floor(y)] || 0) + 1; if (R.holes.length < 60) R.holes.push([name, r2(a), r2(y)]);
        }
      }
    }
  }
  R.missCount = n;
  report.done = true;
}
export function drive() {}
