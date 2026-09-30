// Dissect the resolver against a thin pole: for capsules approaching (px, pz) along a line, list which triangles the octree
// hands back and what triangleCapsuleIntersect says about each. Params: px, pz, dx, dz (approach direction, unit).
import * as THREE from 'three';
import { Capsule } from 'three/addons/math/Capsule.js';

let done = false;

export async function setup(game, report) {
  const coll = game.world.collision;
  const oct = coll.octree;
  const q = k => parseFloat(game.params.get(k));
  const px = q('px'), pz = q('pz'), dx = q('dx'), dz = q('dz');
  const rows = [];
  const cap = new Capsule(new THREE.Vector3(), new THREE.Vector3(), 0.4);
  for (const dist of [1.0, 0.8, 0.7, 0.6, 0.55, 0.5, 0.45, 0.4, 0.3, 0.2, 0.1, 0.0]) {
    const x = px - dx * dist, z = pz - dz * dist;
    cap.start.set(x, 0.4, z);
    cap.end.set(x, 1.4, z);
    const tris = [];
    oct.getCapsuleTriangles(cap, tris);
    const hits = [];
    let pushed = 0;
    for (const t of tris) {
      const r = oct.triangleCapsuleIntersect(cap, t);
      if (r) {
        hits.push({ n: [r.normal.x, r.normal.y, r.normal.z].map(v => +v.toFixed(2)), depth: +r.depth.toFixed(3) });
        pushed++;
      }
    }
    // full resolve
    const c2 = new Capsule(cap.start.clone(), cap.end.clone(), 0.4);
    coll.resolveCapsule(c2);
    rows.push({ dist, at: [x, z].map(v => +v.toFixed(3)), tris: tris.length, hits: hits.slice(0, 6), nHits: pushed, afterResolve: [c2.start.x, c2.start.z].map(v => +v.toFixed(3)), moved: +Math.hypot(c2.start.x - x, c2.start.z - z).toFixed(3) });
  }
  // walk the capsule into the pole with moveCapsule at sprint speed and log the path
  const v = new THREE.Vector3(dx * 9, 0, dz * 9);
  cap.start.set(px - dx * 1.5, 0.4, pz - dz * 1.5);
  cap.end.set(px - dx * 1.5, 1.4, pz - dz * 1.5);
  const path = [];
  for (let i = 0; i < 40; i++) {
    v.set(dx * 9, 0, dz * 9);
    coll.moveCapsule(cap, v, 1 / 120);
    path.push([+cap.start.x.toFixed(3), +cap.start.z.toFixed(3), +(Math.hypot(cap.start.x - px, cap.start.z - pz)).toFixed(3)]);
  }
  report.custom = { pole: [px, pz], rows, path, inside: coll.capsuleInside(cap) };
  done = true;
}

export function drive(t, dt, game, report) {
  if (done && !report.done) game.autotest.finish();
}
