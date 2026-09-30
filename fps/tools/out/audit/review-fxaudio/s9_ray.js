import * as THREE from 'three';
export function setup(game, report) { report.custom = {}; }
let done = false;
export function drive(t, dt, game, report) {
  if (done || t < 0.5) return; done = true;
  const w = game.world, o = new THREE.Vector3(), d = new THREE.Vector3();
  const N = 2000; let hits = 0;
  const t0 = performance.now();
  for (let i = 0; i < N; i++) {
    o.set(Math.random() * 40 - 20, Math.random() * 5, Math.random() * 40 - 20);
    d.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
    if (w.raycast(o, d, 0.5)) hits++;
  }
  const ms = performance.now() - t0;
  report.custom = { N, hits, totalMs: +ms.toFixed(2), perCallUs: +(ms / N * 1000).toFixed(1), tris: w.collision.octree ? 'octree' : '?' };
}
export function finish() {}
