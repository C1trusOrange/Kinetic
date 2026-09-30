import * as THREE from 'three';
import { r2 } from './common.js';
export async function setup(game, report) {
  const R = report.custom = { };
  game.autotest.duration = 1e9; game.state = 'loading';
  const q = new URLSearchParams(location.search);
  const x = parseFloat(q.get('px')), z = parseFloat(q.get('pz'));
  const coll = game.world.collision;
  R.hits = [];
  let y = 60;
  for (let k = 0; k < 12; k++) {
    const h = coll.raycast(new THREE.Vector3(x, y, z), new THREE.Vector3(0, -1, 0), 200);
    if (!h) break;
    R.hits.push([r2(h.point.y), h.normal.toArray().map(r2), h.surface]);
    y = h.point.y - 0.01;
  }
  R.solids = game.world.def.solids.filter(s => { const mn = s.min, mx = s.max; if (mn && mx) return x >= mn[0]-0.05 && x <= mx[0]+0.05 && z >= mn[2]-0.05 && z <= mx[2]+0.05; return false; }).map(s => [s.type, s.min, s.max, s.visible !== false]);
  R.nonbox = game.world.def.solids.filter(s => !s.min).filter(s => s.pos && Math.abs(s.pos[0]-x) < 6 && Math.abs(s.pos[2]-z) < 6).map(s => [s.type, s.pos, s.size, s.dir]);
  report.done = true;
}
export function drive() {}
