import * as THREE from 'three';
import { teleport, releaseAll, r2 } from './common.js';
export async function setup(game, report) {
  const R = report.custom = { map: game.world.mapId };
  const p = game.player; p.god = true; game.autotest.duration = 1e9; game.state = 'loading';
  const mv = p.move, coll = game.world.collision;
  const q = new URLSearchParams(location.search);
  const sx = parseFloat(q.get('x')), sy = parseFloat(q.get('y')), sz = parseFloat(q.get('z'));
  R.spot = [sx, sy, sz];
  const o = new THREE.Vector3();
  // horizontal extents of the surface: 4 directions from just above the surface, down ray to find edges by scanning
  const down = new THREE.Vector3(0, -1, 0);
  R.edges = {};
  for (const [name, dx, dz] of [['+x', 1, 0], ['-x', -1, 0], ['+z', 0, 1], ['-z', 0, -1]]) {
    let e = null;
    for (let d = 0; d < 20; d += 0.05) {
      o.set(sx + dx * d, sy + 0.3, sz + dz * d);
      const h = coll.raycast(o, down, 1.0);
      if (!h || Math.abs(h.point.y - sy) > 0.15) { e = r2(d); break; }
    }
    R.edges[name] = e;
  }
  const up = new THREE.Vector3(0, 1, 0);
  o.set(sx, sy + 0.02, sz);
  const u = coll.raycast(o, up, 5);
  R.ceil = u ? { d: r2(u.distance), y: r2(u.point.y) } : null;
  o.set(sx, sy - 0.05, sz);
  const dd = coll.raycast(new THREE.Vector3(sx, sy - 0.05, sz), down, 20);
  R.belowFloor = dd ? r2(dd.point.y) : null;
  report.done = true;
}
export function drive() {}
