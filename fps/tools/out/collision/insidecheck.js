// Exact accuracy test of CollisionWorld.isInside / capsuleInside on the synthetic map, whose solids are all boxes, so
// ground truth is known analytically (oriented boxes from the map definition). Samples thousands of points around every
// solid - including 2..60 cm either side of every layer seam and 1..40 cm inside/outside every face - and reports
// false positives / negatives, plus a capsule-level test at hidden-seam landing spots.
//   python tools/run.py "index.html?autotest=1&mapfile=tools/out/collision/testmap.js&bots=0&god=1&duration=99999&scenario=tools/out/collision/insidecheck.js" --report
import * as THREE from 'three';
import { Capsule } from 'three/addons/math/Capsule.js';
import { obbOf, insideAny } from './obb.js';

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
  const solids = game.world.def.solids;
  const obbs = [];
  solids.forEach((s, i) => { const o = obbOf(s, i); if (o) obbs.push(o); });
  const r = rnd(99);
  const out = (report.custom = {});
  const stats = { points: 0, agree: 0, fp: 0, fn: 0, insidePoints: 0, seamPoints: 0, seamFn: 0, seamFp: 0 };
  const bad = [];
  const test = (x, y, z, tag) => {
    // skip the 2 cm band around any surface (ambiguous by definition)
    const sure_in = insideAny(obbs, x, y, z, 0.02);
    const sure_out = !insideAny(obbs, x, y, z, -0.02);
    if (!sure_in && !sure_out) return;
    const truth = !!sure_in;
    const api = coll.isInsideXYZ(x, y, z);
    stats.points++;
    if (truth) stats.insidePoints++;
    if (tag === 'seam') stats.seamPoints++;
    if (api === truth) stats.agree++;
    else {
      if (api) { stats.fp++; if (tag === 'seam') stats.seamFp++; } else { stats.fn++; if (tag === 'seam') stats.seamFn++; }
      if (bad.length < 12) bad.push({ p: [x, y, z].map(v => +v.toFixed(3)), api, truth, tag });
    }
  };
  for (const o of obbs) {
    for (let i = 0; i < 300; i++) {
      // uniformly around the solid, up to 1 m outside
      const lx = (r() * 2 - 1) * (o.hx + 1), ly = (r() * 2 - 1) * (o.hy + 1), lz = (r() * 2 - 1) * (o.hz + 1);
      test(o.cx + lx * o.c + lz * o.s, o.cy + ly, o.cz - lx * o.s + lz * o.c, 'box');
    }
    // just above / below the top and bottom planes (2..60 cm), where stacks meet
    for (let i = 0; i < 120; i++) {
      const lx = (r() * 2 - 1) * o.hx * 0.9, lz = (r() * 2 - 1) * o.hz * 0.9;
      const dy = 0.02 + r() * 0.58;
      const wx = o.cx + lx * o.c + lz * o.s, wz = o.cz - lx * o.s + lz * o.c;
      test(wx, o.maxY + dy, wz, 'seam');
      test(wx, o.maxY - dy, wz, 'seam');
      test(wx, o.minY + dy, wz, 'seam');
      test(wx, o.minY - dy, wz, 'seam');
    }
  }
  out.pointAccuracy = { ...stats, bad };

  // capsule level: standing capsules (feet at y) placed 0.02..0.9 m deep inside the front face of every stacked
  // container spot, on the seam level - the state the old mantle produced
  const cap = new Capsule(new THREE.Vector3(), new THREE.Vector3(), 0.4);
  let capIn = 0, capInHit = 0, capOut = 0, capOutHit = 0;
  for (const sp of game.world.def.spots) {
    if (!sp.seams.length || sp.kind === 'border') continue;
    for (const sy of sp.seams) {
      for (let k = 0; k < 40; k++) {
        const depth = 0.05 + r() * 0.9;       // metres inside the front face
        const x = sp.x + (r() * 2 - 1) * 0.5;
        const z = sp.front - depth;
        cap.start.set(x, sy + 0.4 + 0.02, z);
        cap.end.set(x, sy + 1.4 + 0.02, z);
        const truth = !!insideAny(obbs, x, sy + 0.9, z, 0.02);
        if (truth) { capIn++; if (coll.capsuleInside(cap)) capInHit++; }
      }
      for (let k = 0; k < 40; k++) {
        const out2 = 0.45 + r() * 0.8;         // clear of the face: standing in front of it
        const x = sp.x + (r() * 2 - 1) * 0.5;
        const z = sp.front + out2;
        cap.start.set(x, sy + 0.42, z);
        cap.end.set(x, sy + 1.42, z);
        if (!insideAny(obbs, x, sy + 0.9, z, -0.02)) { capOut++; if (coll.capsuleInside(cap)) capOutHit++; }
      }
    }
  }
  out.capsuleAccuracy = { insideCapsules: capIn, detected: capInHit, clearCapsules: capOut, falselyDetected: capOutHit };
  out.tris = { added: coll.triangleCount };
  done = true;
}

export function drive(t, dt, game, report) {
  if (done && !report.done) game.autotest.finish();
}
