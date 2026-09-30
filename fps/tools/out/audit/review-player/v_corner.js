// Vendored Octree.lineToLineClosestPoints has a sign error -> capsule/edge contacts are wrong. Measure corner penetration with the vendored code vs a corrected copy.
import * as THREE from 'three';
import { teleport, releaseAll, r2 } from './common.js';

function makeFixed(oct) {
  const _plane = new THREE.Plane(), _line1 = new THREE.Line3(), _line2 = new THREE.Line3();
  const _p1 = new THREE.Vector3(), _p2 = new THREE.Vector3(), _v1 = new THREE.Vector3();
  const t1v = new THREE.Vector3(), t2v = new THREE.Vector3(), t3v = new THREE.Vector3();
  function closest(l1, l2, o1, o2) {
    const r = t1v.copy(l1.end).sub(l1.start), s = t2v.copy(l2.end).sub(l2.start), w = t3v.copy(l2.start).sub(l1.start);
    const a = r.dot(s), b = r.dot(r), c = s.dot(s), d = s.dot(w), e = r.dot(w);
    let t1, t2; const div = b * c - a * a;
    if (Math.abs(div) < 1e-10) { const d1 = -d / c, d2 = (a - d) / c; if (Math.abs(d1 - 0.5) < Math.abs(d2 - 0.5)) { t1 = 0; t2 = d1; } else { t1 = 1; t2 = d2; } }
    else { t1 = (e * c - a * d) / div; t2 = (t1 * a - d) / c; }   // corrected
    t2 = Math.max(0, Math.min(1, t2)); t1 = Math.max(0, Math.min(1, t1));
    o1.copy(r).multiplyScalar(t1).add(l1.start); o2.copy(s).multiplyScalar(t2).add(l2.start);
  }
  return function (capsule, triangle) {
    triangle.getPlane(_plane);
    const d1 = _plane.distanceToPoint(capsule.start) - capsule.radius, d2 = _plane.distanceToPoint(capsule.end) - capsule.radius;
    if ((d1 > 0 && d2 > 0) || (d1 < -capsule.radius && d2 < -capsule.radius)) return false;
    const delta = Math.abs(d1 / (Math.abs(d1) + Math.abs(d2)));
    const ip = _v1.copy(capsule.start).lerp(capsule.end, delta);
    if (triangle.containsPoint(ip)) return { normal: _plane.normal.clone(), point: ip.clone(), depth: Math.abs(Math.min(d1, d2)) };
    const r2_ = capsule.radius * capsule.radius;
    const line1 = _line1.set(capsule.start, capsule.end);
    const lines = [[triangle.a, triangle.b], [triangle.b, triangle.c], [triangle.c, triangle.a]];
    for (let i = 0; i < 3; i++) {
      const line2 = _line2.set(lines[i][0], lines[i][1]);
      closest(line1, line2, _p1, _p2);
      if (_p1.distanceToSquared(_p2) < r2_) return { normal: _p1.clone().sub(_p2).normalize(), point: _p2.clone(), depth: capsule.radius - _p1.distanceTo(_p2) };
    }
    return false;
  };
}

export async function setup(game, report) {
  const R = report.custom = { vendor: null, fixed: null };
  const p = game.player; p.god = true;
  game.autotest.duration = 1e9; game.state = 'loading';
  const coll = game.world.collision;
  const orig = coll.octree.triangleCapsuleIntersect;
  const fixed = makeFixed(coll.octree);
  const DT = 1 / 60;
  const runAll = () => {
    let maxDepth = 0, framesOver = 0, frames = 0, runs = 0, runsOver = 0; const samples = [];
    // jump at ledge tops (height 0.5..2.25) from many distances: the bottom sphere of the capsule grazes the ledge's top edge
    for (let li = 0; li < 6; li++) {
      const cx = -28 + li * 8;
      for (let dist = 0.5; dist <= 3.5; dist += 0.25) {
        for (const spd of [true, false]) {
          for (const off of [-1.2, 0, 1.3]) {
            teleport(game, cx + off * 0.5, 0, 10 - dist - 0.4, 0, 0);
            let over = false, jumped = false;
            for (let i = 0; i < 110; i++) {
              game.input.setVirtual('forward', true); game.input.setVirtual('sprint', spd);
              game.input.setVirtual('jump', i === 3 || i === 30);
              game.input.update(); game.update(DT); game.input.endFrame();
              const h = coll.capsuleIntersect(p.move.capsule);
              const dep = h ? h.depth : 0;
              frames++;
              if (dep > maxDepth) maxDepth = dep;
              if (dep > 0.04) { framesOver++; over = true; if (samples.length < 4) samples.push({ li, dist, spd, off, i, dep: r2(dep), pos: p.position.toArray().map(r2), st: p.move.state }); }
            }
            runs++; if (over) runsOver++;
          }
        }
      }
    }
    releaseAll(game);
    return { runs, runsOver, frames, framesOver, maxDepth: r2(maxDepth * 1000) / 1000, samples };
  };
  coll.octree.triangleCapsuleIntersect = orig;
  R.vendor = runAll();
  coll.octree.triangleCapsuleIntersect = fixed;
  R.fixed = runAll();
  coll.octree.triangleCapsuleIntersect = orig;
  report.done = true;
}
export function drive() {}
