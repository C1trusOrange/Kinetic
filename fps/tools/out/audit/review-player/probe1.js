import * as THREE from 'three';
import { teleport, r2 } from './common.js';
export async function setup(game, report) {
  const R = report.custom = {};
  const p = game.player; p.god = true;
  game.autotest.duration = 1e9; game.state = 'loading';
  const coll = game.world.collision;
  const rc = (o, d, m = 50) => { const h = coll.raycast(new THREE.Vector3(...o), new THREE.Vector3(...d), m); return h ? { dist: r2(h.distance), pt: h.point.toArray().map(r2), n: h.normal.toArray().map(r2) } : null; };
  R.downFrom10 = rc([7.04, 10, -29.48], [0, -1, 0]);
  R.downFrom10b = rc([6.5, 10, -27.4], [0, -1, 0]);
  R.upFrom4_6 = rc([7.04, 4.6, -29.48], [0, 1, 0]);
  R.sideX = rc([4, 5.8, -27.4], [1, 0, 0]);
  R.sideZ = rc([6.5, 5.8, -34], [0, 0, 1]);
  R.sideZ2 = rc([7.04, 5.8, -34], [0, 0, 1]);
  report.done = true;
}
export function drive() {}
