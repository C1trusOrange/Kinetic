import * as THREE from 'three';
import { r2 } from './common.js';
export async function setup(game, report) {
  const R = report.custom = { };
  game.autotest.duration = 1e9; game.state = 'loading';
  const q = new URLSearchParams(location.search);
  const x = parseFloat(q.get('px')), y = parseFloat(q.get('py')), z = parseFloat(q.get('pz'));
  const mv = game.player.move, coll = game.world.collision;
  const cols = game.world.def.solids.filter(s => s.min && s.max && x >= s.min[0]-0.01 && x <= s.max[0]+0.01 && z >= s.min[2]-0.01 && z <= s.max[2]+0.01 && s.max[1] > y - 3 && s.min[1] < y + 4).map(s => ({ t: s.type, min: s.min, max: s.max, vis: s.visible !== false, top: s.top }));
  R.cols = cols;
  const other = game.world.def.solids.filter(s => !s.min && s.pos && Math.abs(s.pos[0]-x) < 8 && Math.abs(s.pos[2]-z) < 8 && Math.abs(s.pos[1]-y) < 6).map(s => ({ t: s.type, pos: s.pos, size: s.size, dir: s.dir }));
  R.other = other;
  const up = coll.raycast(new THREE.Vector3(x, y + 0.02, z), new THREE.Vector3(0, 1, 0), 4);
  R.up = up ? { d: r2(up.distance), n: up.normal.toArray().map(r2) } : null;
  const down = coll.raycast(new THREE.Vector3(x, y + 0.3, z), new THREE.Vector3(0, -1, 0), 4);
  R.down = down ? { d: r2(down.distance), n: down.normal.toArray().map(r2) } : null;
  mv.crouched = true; game.player.height = 1.15;
  mv.capsule.start.set(x, y + 0.4, z); mv.capsule.end.set(x, y + 0.75, z);
  R.canStand = mv._canStand();
  R.capsuleClear = mv._capsuleClear(x, y, z);
  // neighbours
  R.nbr = [];
  for (const [dx, dz] of [[0.3,0],[-0.3,0],[0,0.3],[0,-0.3],[0.6,0],[-0.6,0],[0,0.6],[0,-0.6],[1,0],[-1,0],[0,1],[0,-1]]) {
    mv.capsule.start.set(x+dx, y + 0.4, z+dz); mv.capsule.end.set(x+dx, y + 0.75, z+dz);
    R.nbr.push([dx, dz, mv._canStand(), mv._capsuleClear(x+dx, y, z+dz)]);
  }
  report.done = true;
}
export function drive() {}
