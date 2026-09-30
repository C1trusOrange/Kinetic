import * as THREE from 'three';
import { r2 } from './common.js';
export async function setup(game, report) {
  const R = report.custom = {};
  const p = game.player; game.autotest.duration = 1e9; game.state = 'loading';
  const mv = p.move, coll = game.world.collision;
  const x = 10, y = 0, z = 17.5;
  const hit = coll.raycast(new THREE.Vector3(x, y + 0.02, z), new THREE.Vector3(0, 1, 0), 3);
  const t = hit.triangle;
  R.hit = { d: r2(hit.distance), n: hit.normal.toArray().map(r2), a: t.a.toArray().map(r2), b: t.b.toArray().map(r2), c: t.c.toArray().map(r2), surface: hit.surface };
  const cap = mv._capA;
  cap.start.set(x, y + 0.4, z); cap.end.set(x, y + 1.4, z);
  const tris = [];
  coll.octree.getCapsuleTriangles(cap, tris);
  R.candidates = tris.length; R.includesHit = tris.includes(t);
  R.tri = coll.octree.triangleCapsuleIntersect(cap, t);
  R.triRes = R.tri ? { n: R.tri.normal.toArray().map(r2), depth: r2(R.tri.depth) } : null;
  // is the sampled point inside the triangle (in-plane)?
  const P = new THREE.Vector3(x, 0.82, z);
  R.contains = t.containsPoint(P);
  // more samples along z
  R.upRays = [];
  for (const dz of [-0.6, -0.4, -0.2, 0, 0.2, 0.4, 0.6]) {
    const h = coll.raycast(new THREE.Vector3(x, 0.02, z + dz), new THREE.Vector3(0, 1, 0), 3);
    R.upRays.push([dz, h ? r2(h.distance) : null, h ? h.normal.toArray().map(r2) : null]);
  }
  report.done = true;
}
export function drive() {}
