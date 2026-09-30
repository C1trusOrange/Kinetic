// Micro benchmark of the new collision queries on a real map (nav node positions = places players stand).
//   python tools/run.py "index.html?autotest=1&map=foundry&bots=0&god=1&duration=99999&scenario=tools/out/collision/perf.js" --report
import * as THREE from 'three';

let done = false;

function rnd(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export async function setup(game, report) {
  const coll = game.world.collision;
  const nodes = game.world.nav.nodes;
  const r = rnd(5);
  const pts = new Float64Array(3 * 3000);
  for (let i = 0; i < 3000; i++) {
    const n = nodes[Math.floor(r() * nodes.length)];
    pts[i * 3] = n.position.x; pts[i * 3 + 1] = n.position.y + 0.9; pts[i * 3 + 2] = n.position.z;
  }
  const out = (report.custom = { map: game.world.mapId, tris: coll.triangleCount });
  const bench = (name, fn, reps = 6) => {
    for (let k = 0; k < 2; k++) for (let i = 0; i < 3000; i++) fn(i);      // warm up
    const t0 = performance.now();
    for (let k = 0; k < reps; k++) for (let i = 0; i < 3000; i++) fn(i);
    out[name] = +(((performance.now() - t0) / (reps * 3000)) * 1000).toFixed(2);   // microseconds per call
  };
  const cap = new THREE.Object3D();
  bench('isInside_us_range12', i => coll.isInsideXYZ(pts[i * 3], pts[i * 3 + 1], pts[i * 3 + 2], 12));
  bench('isInside_us_range4', i => coll.isInsideXYZ(pts[i * 3], pts[i * 3 + 1], pts[i * 3 + 2], 4));
  bench('isInside_us_range2.5', i => coll.isInsideXYZ(pts[i * 3], pts[i * 3 + 1], pts[i * 3 + 2], 2.5));
  const o = new THREE.Vector3(), d = new THREE.Vector3(0.3, -0.9, 0.31).normalize();
  bench('raycast_us_baseline_down', i => { o.set(pts[i * 3], pts[i * 3 + 1], pts[i * 3 + 2]); coll.raycast(o, d, 1.5); });
  bench('rayBlocked_us_2m', i => coll.rayBlocked(pts[i * 3], pts[i * 3 + 1], pts[i * 3 + 2], d.x, d.y, d.z, 2));
  const P = game.player;
  const capsule = P.move.capsule;
  bench('probeGround_us', i => { capsule.start.set(pts[i * 3], pts[i * 3 + 1] - 0.5, pts[i * 3 + 2]); capsule.end.set(pts[i * 3], pts[i * 3 + 1] + 0.5, pts[i * 3 + 2]); coll.probeGround(capsule, 0.35); });
  bench('resolveCapsule_us', i => { capsule.start.set(pts[i * 3], pts[i * 3 + 1] - 0.5, pts[i * 3 + 2]); capsule.end.set(pts[i * 3], pts[i * 3 + 1] + 0.5, pts[i * 3 + 2]); coll.resolveCapsule(capsule); });
  done = true;
}

export function drive(t, dt, game, report) {
  if (done && !report.done) game.autotest.finish();
}
