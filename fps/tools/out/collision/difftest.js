// Differential test: the OLD capsule resolution (three's Octree.triangleCapsuleIntersect, replicated here) against the
// NEW CollisionWorld.resolveCapsule on random capsules placed near real map geometry. Ordinary contacts must agree;
// disagreements are classified (new pushes further out = a hole fixed / new pushes less = potential regression).
//   python tools/run.py "index.html?autotest=1&map=foundry&bots=0&god=1&duration=99999&scenario=tools/out/collision/difftest.js&n=20000" --report
import * as THREE from 'three';
import { Capsule } from 'three/addons/math/Capsule.js';

let done = false;

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}


// ---- exact ground truth: penetration of a capsule (axis start->end, radius r) into the FRONT side of nearby triangles
function closestPtTri(px, py, pz, t, out) {
  // Ericson 5.1.5
  const a = t.a, b = t.b, c = t.c;
  const abx = b.x - a.x, aby = b.y - a.y, abz = b.z - a.z, acx = c.x - a.x, acy = c.y - a.y, acz = c.z - a.z;
  const apx = px - a.x, apy = py - a.y, apz = pz - a.z;
  const d1 = abx * apx + aby * apy + abz * apz, d2 = acx * apx + acy * apy + acz * apz;
  if (d1 <= 0 && d2 <= 0) { out[0] = a.x; out[1] = a.y; out[2] = a.z; return; }
  const bpx = px - b.x, bpy = py - b.y, bpz = pz - b.z;
  const d3 = abx * bpx + aby * bpy + abz * bpz, d4 = acx * bpx + acy * bpy + acz * bpz;
  if (d3 >= 0 && d4 <= d3) { out[0] = b.x; out[1] = b.y; out[2] = b.z; return; }
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) { const v = d1 / (d1 - d3); out[0] = a.x + abx * v; out[1] = a.y + aby * v; out[2] = a.z + abz * v; return; }
  const cpx = px - c.x, cpy = py - c.y, cpz = pz - c.z;
  const d5 = abx * cpx + aby * cpy + abz * cpz, d6 = acx * cpx + acy * cpy + acz * cpz;
  if (d6 >= 0 && d5 <= d6) { out[0] = c.x; out[1] = c.y; out[2] = c.z; return; }
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) { const w = d2 / (d2 - d6); out[0] = a.x + acx * w; out[1] = a.y + acy * w; out[2] = a.z + acz * w; return; }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && (d4 - d3) >= 0 && (d5 - d6) >= 0) { const w = (d4 - d3) / ((d4 - d3) + (d5 - d6)); out[0] = b.x + (c.x - b.x) * w; out[1] = b.y + (c.y - b.y) * w; out[2] = b.z + (c.z - b.z) * w; return; }
  const den = 1 / (va + vb + vc), v = vb * den, w = vc * den;
  out[0] = a.x + abx * v + acx * w; out[1] = a.y + aby * v + acy * w; out[2] = a.z + abz * v + acz * w;
}
const _q = [0, 0, 0];
/** min distance from the axis segment to the triangle by dense sampling of the axis + exact point-triangle distance. */
function axisTriDist(cap, t, outN) {
  let best = 1e9, bi = 0;
  const S = 24;
  for (let i = 0; i <= S; i++) {
    const f = i / S;
    const x = cap.start.x + (cap.end.x - cap.start.x) * f, y = cap.start.y + (cap.end.y - cap.start.y) * f, z = cap.start.z + (cap.end.z - cap.start.z) * f;
    closestPtTri(x, y, z, t, _q);
    const d = Math.hypot(x - _q[0], y - _q[1], z - _q[2]);
    if (d < best) { best = d; bi = f; outN.f = f; outN.qx = _q[0]; outN.qy = _q[1]; outN.qz = _q[2]; outN.x = x; outN.y = y; outN.z = z; }
  }
  return best;
}
const _nn = {};
function trueOverlap(coll, cap) {
  const tris = [];
  coll.octree.getCapsuleTriangles(cap, tris);
  let worst = 0;
  for (const t of tris) {
    const d = axisTriDist(cap, t, _nn);
    if (d >= cap.radius) continue;
    // front side only: the axis point must lie on the outward side of the triangle plane
    const side = (_nn.x - _nn.qx) * t.nx + (_nn.y - _nn.qy) * t.ny + (_nn.z - _nn.qz) * t.nz;
    if (side <= 1e-6) continue;
    worst = Math.max(worst, cap.radius - d);
  }
  return worst;
}

/** The pre-fix resolveCapsule, verbatim semantics. */
function oldResolve(oct, cap, tris) {
  tris.length = 0;
  oct.getCapsuleTriangles(cap, tris);
  for (let pass = 0; pass < 2; pass++) {
    let any = false;
    for (let i = 0; i < tris.length; i++) {
      const r = oct.triangleCapsuleIntersect(cap, tris[i]);
      if (!r || !(r.depth > 1e-7)) continue;
      const n = r.normal;
      if (!Number.isFinite(n.x)) continue;
      cap.start.addScaledVector(n, r.depth);
      cap.end.addScaledVector(n, r.depth);
      any = true;
    }
    if (!any) break;
  }
}

export async function setup(game, report) {
  const coll = game.world.collision;
  const oct = coll.octree;
  const N = parseInt(game.params.get('n') || '20000', 10);
  const r = rng(777);
  // gather triangles
  const all = [];
  const stack = [oct];
  const seen = new Set();
  while (stack.length) {
    const n = stack.pop();
    for (const t of n.triangles) if (!seen.has(t)) { seen.add(t); all.push(t); }
    for (const s of n.subTrees) stack.push(s);
  }
  const tris = [];
  const c1 = new Capsule(new THREE.Vector3(), new THREE.Vector3(), 0.4);
  const c2 = new Capsule(new THREE.Vector3(), new THREE.Vector3(), 0.4);
  const st = { n: 0, same: 0, newFurther: 0, newLess: 0, oldMovedNewNot: 0, newMovedOldNot: 0, bothMoved: 0, neither: 0 };
  const worst = { newLess: [], newFurther: [] };
  const _c = new THREE.Vector3();
  for (let i = 0; i < N; i++) {
    const t = all[Math.floor(r() * all.length)];
    // random point near the triangle: centroid + offset up to 0.9 m (also sometimes on a vertex / edge)
    const mode = r();
    let px, py, pz;
    if (mode < 0.3) { px = t.a.x; py = t.a.y; pz = t.a.z; }
    else if (mode < 0.5) { const w = r(); px = t.a.x + (t.b.x - t.a.x) * w; py = t.a.y + (t.b.y - t.a.y) * w; pz = t.a.z + (t.b.z - t.a.z) * w; }
    else { _c.set(0, 0, 0).add(t.a).add(t.b).add(t.c).multiplyScalar(1 / 3); px = _c.x; py = _c.y; pz = _c.z; }
    const ox = (r() - 0.5) * 1.8, oy = (r() - 0.5) * 1.8, oz = (r() - 0.5) * 1.8;
    const x = px + ox, y = py + oy, z = pz + oz;
    const h = r() < 0.75 ? 1.0 : 0.35;    // standing (1.0 between sphere centres) / crouched
    c1.start.set(x, y, z); c1.end.set(x, y + h, z);
    c2.start.copy(c1.start); c2.end.copy(c1.end);
    // skip capsules that start inside a solid (both centres behind planes: both algorithms ignore it)
    if (coll.capsuleInside(c1)) continue;
    st.n++;
    oldResolve(oct, c1, tris);
    coll.resolveCapsule(c2);
    const dOld = c1.start.distanceTo(new THREE.Vector3(x, y, z));
    const dNew = c2.start.distanceTo(new THREE.Vector3(x, y, z));
    const diff = c1.start.distanceTo(c2.start);
    if (diff < 2e-3) { st.same++; if (dOld < 1e-6) st.neither++; else st.bothMoved++; continue; }
    if (dNew > dOld) { st.newFurther++; if (worst.newFurther.length < 6) worst.newFurther.push({ p: [x, y, z].map(v => +v.toFixed(3)), h, dOld: +dOld.toFixed(3), dNew: +dNew.toFixed(3) }); }
    else { st.newLess++; if (worst.newLess.length < 10) worst.newLess.push({ p: [x, y, z].map(v => +v.toFixed(3)), h, dOld: +dOld.toFixed(3), dNew: +dNew.toFixed(3), diff: +diff.toFixed(3) }); }
    if (dOld < 1e-6) st.newMovedOldNot++;
    if (dNew < 1e-6) st.oldMovedNewNot++;
  }
  // after resolution, is the new capsule still overlapping anything? (residual penetration of the new resolver)
  let resid = 0, residOld = 0, samples = 0;
  for (let i = 0; i < 4000; i++) {
    const t = all[Math.floor(r() * all.length)];
    _c.set(0, 0, 0).add(t.a).add(t.b).add(t.c).multiplyScalar(1 / 3);
    c1.start.set(_c.x + (r() - 0.5) * 1.2, _c.y + (r() - 0.5) * 1.2, _c.z + (r() - 0.5) * 1.2);
    c1.end.set(c1.start.x, c1.start.y + 1, c1.start.z);
    c2.start.copy(c1.start); c2.end.copy(c1.end);
    if (coll.capsuleInside(c1)) continue;
    samples++;
    coll.resolveCapsule(c2);
    const rr = coll.capsuleIntersect(c2);    // new-code intersect on the resolved capsule
    if (rr && rr.depth > 0.02) resid++;
    oldResolve(oct, c1, tris);
    const ro = oct.capsuleIntersect(c1);
    if (ro && ro.depth > 0.02) residOld++;
  }
  // ---- ground truth residual penetration after resolution (independent exact metric)
  const gt = { n: 0, oldSum: 0, newSum: 0, oldMax: 0, newMax: 0, old01: 0, new01: 0, old05: 0, new05: 0, newWorse: 0, oldWorse: 0, ex: [] };
  const r3 = rng(4321);
  for (let i = 0; i < 6000; i++) {
    const t = all[Math.floor(r3() * all.length)];
    _c.set(0, 0, 0).add(t.a).add(t.b).add(t.c).multiplyScalar(1 / 3);
    const w = r3();
    const x = (w < 0.4 ? t.a.x : _c.x) + (r3() - 0.5) * 1.6, y = (w < 0.4 ? t.a.y : _c.y) + (r3() - 0.5) * 1.6, z = (w < 0.4 ? t.a.z : _c.z) + (r3() - 0.5) * 1.6;
    const h = r3() < 0.75 ? 1.0 : 0.35;
    c1.start.set(x, y, z); c1.end.set(x, y + h, z);
    c2.start.copy(c1.start); c2.end.copy(c1.end);
    if (coll.capsuleInside(c1)) continue;
    oldResolve(oct, c1, tris);
    coll.resolveCapsule(c2);
    const oo = trueOverlap(coll, c1), nn = trueOverlap(coll, c2);
    gt.n++; gt.oldSum += oo; gt.newSum += nn;
    gt.oldMax = Math.max(gt.oldMax, oo); gt.newMax = Math.max(gt.newMax, nn);
    if (oo > 0.01) gt.old01++; if (nn > 0.01) gt.new01++;
    if (oo > 0.05) gt.old05++; if (nn > 0.05) gt.new05++;
    if (nn > oo + 0.02) { gt.newWorse++; if (gt.ex.length < 8) gt.ex.push({ p: [x, y, z].map(v => +v.toFixed(3)), h, old: +oo.toFixed(3), new: +nn.toFixed(3) }); }
    if (oo > nn + 0.02) gt.oldWorse++;
  }
  gt.oldMean = +(gt.oldSum / gt.n).toFixed(5); gt.newMean = +(gt.newSum / gt.n).toFixed(5);
  gt.oldMax = +gt.oldMax.toFixed(3); gt.newMax = +gt.newMax.toFixed(3);
  report.custom = { map: game.world.mapId, tris: all.length, stats: st, worst, residual: { samples, newResolverStillOverlapping: resid, oldResolverStillOverlapping: residOld }, groundTruth: gt };
  done = true;
}

export function drive(t, dt, game, report) {
  if (done && !report.done) game.autotest.finish();
}
