// Checks on a real map: (1) nav nodes / spawns / pickups / pads inside solids (new isInside vs the independent
// brute-force detector), (2) accuracy of isInside against the detector on random points, (3) cost of the new queries
// and of the player safety net per physics step.
//   python tools/run.py "index.html?autotest=1&map=foundry&bots=0&god=1&duration=9999&scenario=tools/out/collision/navcheck.js" --report --timeout 300
import * as THREE from 'three';
import { Detector, teleport, STEP, R } from './lib.js';
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
  const det = new Detector(game);
  const out = (report.custom = report.custom || {});
  out.map = game.world.mapId;
  out.tris = { added: coll.triangleCount, inTree: det.count };

  // ---- (1) nav nodes inside solids
  const nodes = game.world.nav.nodes;
  let navInside = 0, navInsideBrute = 0;
  const navSamples = [];
  for (const n of nodes) {
    const p = n.position;
    const a = coll.isInsideXYZ(p.x, p.y + 0.9, p.z) || coll.isInsideXYZ(p.x, p.y + 0.4, p.z);
    if (a) { navInside++; if (navSamples.length < 6) navSamples.push([p.x, p.y, p.z].map(v => +v.toFixed(2))); }
  }
  // brute force on a stride sample (expensive)
  const stride = Math.max(1, Math.floor(nodes.length / 400));
  let bruteN = 0;
  for (let i = 0; i < nodes.length; i += stride) {
    const p = nodes[i].position;
    bruteN++;
    if (det.inside(p.x, p.y + 0.9, p.z)) navInsideBrute++;
  }
  out.nav = { nodes: nodes.length, insideSolid: navInside, samples: navSamples, bruteSampled: bruteN, bruteInside: navInsideBrute };
  // every node the API flags: ask the independent brute-force detector too (and name the map solids around it)
  {
    const obbs0 = [];
    game.world.def.solids.forEach((s, i) => { const o = obbOf(s, i); if (o) obbs0.push(o); });
    let flaggedN = 0, confirmed = 0;
    const detail = [];
    for (const n of nodes) {
      const p = n.position;
      const a9 = coll.isInsideXYZ(p.x, p.y + 0.9, p.z), a4 = coll.isInsideXYZ(p.x, p.y + 0.4, p.z);
      if (!(a9 || a4)) continue;
      flaggedN++;
      const b9 = det.inside(p.x, p.y + 0.9, p.z), b4 = det.inside(p.x, p.y + 0.4, p.z);
      if (b9 || b4) confirmed++;
      if (detail.length < 8) {
        const o9 = insideAny(obbs0, p.x, p.y + 0.9, p.z), o4 = insideAny(obbs0, p.x, p.y + 0.4, p.z);
        detail.push({ p: [p.x, p.y, p.z].map(v => +v.toFixed(2)), api9: a9, api4: a4, brute9: b9, brute4: b4, obb9: o9 ? `${o9.type}#${o9.i}` : null, obb4: o4 ? `${o4.type}#${o4.i}` : null });
      }
    }
    out.nav.flaggedByApi = flaggedN;
    out.nav.flaggedConfirmedByBrute = confirmed;
    out.nav.flaggedDetail = detail;
  }

  // spawns / pickups / pads
  const sp = game.world.spawnPoints.map((s, i) => ({ i, inside: coll.isInsideXYZ(s.position.x, s.position.y + 0.9, s.position.z), brute: det.inside(s.position.x, s.position.y + 0.9, s.position.z) }));
  out.spawns = { count: sp.length, inside: sp.filter(s => s.inside).map(s => s.i), bruteInside: sp.filter(s => s.brute).map(s => s.i) };
  const pk = game.world.pickups.list;
  out.pickups = { count: pk.length, inside: pk.filter(p => coll.isInsideXYZ(p.position.x, p.position.y + 0.5, p.position.z)).map(p => `${p.type}@${p.position.toArray().map(v => +v.toFixed(1))}`),
    bruteInside: pk.filter(p => det.inside(p.position.x, p.position.y + 0.5, p.position.z)).map(p => `${p.type}@${p.position.toArray().map(v => +v.toFixed(1))}`) };
  {
    const obbs1 = [];
    game.world.def.solids.forEach((s, i) => { const o = obbOf(s, i); if (o) obbs1.push(o); });
    out.spawns.detail = game.world.spawnPoints.map((s, i) => ({ i, p: [s.position.x, s.position.y, s.position.z].map(v => +v.toFixed(2)), api: coll.isInsideXYZ(s.position.x, s.position.y + 0.9, s.position.z), brute: det.inside(s.position.x, s.position.y + 0.9, s.position.z), obb: (insideAny(obbs1, s.position.x, s.position.y + 0.9, s.position.z) || {}).i ?? null })).filter(d => d.api || d.brute);
  }

  // ---- (2) accuracy on random points inside the bounds
  const b = game.world.bounds;
  const r = rnd(1234);
  let agree = 0, total = 0, fp = 0, fn = 0, insideCount = 0;
  const bad = [];
  for (let i = 0; i < 1500; i++) {
    const x = b.min.x + r() * (b.max.x - b.min.x), y = b.min.y + 1 + r() * Math.min(20, b.max.y - b.min.y - 1), z = b.min.z + r() * (b.max.z - b.min.z);
    const A = coll.isInsideXYZ(x, y, z);
    const B = det.inside(x, y, z);
    total++;
    if (B) insideCount++;
    if (A === B) agree++; else { if (A) fp++; else fn++; if (bad.length < 8) bad.push({ p: [x, y, z].map(v => +v.toFixed(2)), api: A, brute: B }); }
  }
  out.accuracy = { total, agree, falsePositive: fp, falseNegative: fn, bruteInsideCount: insideCount, bad };

  // ---- (2b) against the map definition itself: points inside box-like solids (independent of triangle winding)
  const obbs = [];
  game.world.def.solids.forEach((s, i) => { const o = obbOf(s, i); if (o) obbs.push(o); });
  let oAgree = 0, oTotal = 0, oApiOnly = 0, oObbOnly = 0;
  const oBad = [];
  for (let i = 0; i < 3000; i++) {
    // sample near box faces: pick a random box, a random point within 1.5 m of its surface
    const o = obbs[Math.floor(r() * obbs.length)];
    const lx = (r() * 2 - 1) * (o.hx + 1.2), ly = (r() * 2 - 1) * (o.hy + 1.2), lz = (r() * 2 - 1) * (o.hz + 1.2);
    const x = o.cx + lx * o.c + lz * o.s, y = o.cy + ly, z = o.cz - lx * o.s + lz * o.c;
    const A = coll.isInsideXYZ(x, y, z);
    const B = !!insideAny(obbs, x, y, z, 0.02);   // 2 cm margin: points on surfaces are ambiguous
    const Bout = !insideAny(obbs, x, y, z, -0.02);
    if (!B && !Bout) { /* within the 2 cm surface band or in between: skip */ }
    if (!(B || Bout)) continue;
    oTotal++;
    if (A === B) oAgree++;
    else if (A && !B) { oApiOnly++; if (oBad.length < 10) oBad.push({ p: [x, y, z].map(v => +v.toFixed(2)), api: A, obb: B, solid: o.i }); }
    else { oObbOnly++; if (oBad.length < 10) oBad.push({ p: [x, y, z].map(v => +v.toFixed(2)), api: A, obb: B, solid: o.i }); }
  }
  out.accuracyVsDef = { total: oTotal, agree: oAgree, apiInsideButNoBox: oApiOnly, boxInsideButApiOutside: oObbOnly, bad: oBad };

  // ---- (3) timing
  const pts = [];
  for (let i = 0; i < 4000; i++) {
    const n = nodes[Math.floor(r() * nodes.length)];
    pts.push(n.position.x, n.position.y + 0.9 + (r() - 0.5) * 0.4, n.position.z);
  }
  const ptsIn = [];
  let guard = 0;
  while (ptsIn.length < 4000 * 3 && guard++ < 200000) {
    const x = b.min.x + r() * (b.max.x - b.min.x), y = b.min.y + 1 + r() * Math.min(20, b.max.y - b.min.y - 1), z = b.min.z + r() * (b.max.z - b.min.z);
    if (coll.isInsideXYZ(x, y, z)) ptsIn.push(x, y, z);
  }
  let t0 = performance.now();
  let hits = 0;
  for (let rep = 0; rep < 5; rep++) for (let i = 0; i < pts.length; i += 3) if (coll.isInsideXYZ(pts[i], pts[i + 1], pts[i + 2])) hits++;
  const tOpen = (performance.now() - t0) / (5 * pts.length / 3);
  t0 = performance.now();
  let hitsIn = 0;
  const nIn = ptsIn.length / 3;
  for (let rep = 0; rep < 5; rep++) for (let i = 0; i < ptsIn.length; i += 3) if (coll.isInsideXYZ(ptsIn[i], ptsIn[i + 1], ptsIn[i + 2])) hitsIn++;
  const tIn = nIn ? (performance.now() - t0) / (5 * nIn) : 0;
  out.timing = { isInside_open_us: +(tOpen * 1000).toFixed(2), isInside_insideSolid_us: +(tIn * 1000).toFixed(2), openHits: hits, insideSample: nIn, insideHits: hitsIn };

  // capsuleInside timing
  const cap = game.player.move.capsule;
  t0 = performance.now();
  let ch = 0;
  for (let rep = 0; rep < 5; rep++) for (let i = 0; i < pts.length; i += 3) {
    cap.start.set(pts[i], pts[i + 1] - 0.5, pts[i + 2]);
    cap.end.set(pts[i], pts[i + 1] + 0.5, pts[i + 2]);
    if (coll.capsuleInside(cap)) ch++;
  }
  out.timing.capsuleInside_open_us = +(((performance.now() - t0) / (5 * pts.length / 3)) * 1000).toFixed(2);

  // player physics step cost with / without the safety net: sprint + jump around a few nav nodes
  const mv = game.player.move;
  const P = game.player;
  const runSteps = (net, n) => {
    mv.netEnabled = net;
    let total = 0, steps = 0;
    for (let k = 0; k < n; k++) {
      const node = nodes[Math.floor(r() * nodes.length)];
      teleport(game, node.position.x, node.position.y, node.position.z, r() * 6.28);
      const inp = mv.in;
      const yaw = P.yaw;
      for (let i = 0; i < 90; i++) {
        inp.forwardHeld = true; inp.fwd = 1; inp.wishX = -Math.sin(yaw); inp.wishZ = -Math.cos(yaw); inp.wishLen = 1; inp.sprintHeld = true;
        inp.jumpFresh = (i % 40) === 5;
        const s0 = performance.now();
        P.prevPosition.copy(P.position);
        mv.step(STEP);
        total += performance.now() - s0;
        inp.jumpFresh = false;
        steps++;
      }
    }
    return { msPerStep: total / steps, steps };
  };
  // warm up, then alternate to cancel drift
  runSteps(true, 10);
  const a1 = runSteps(false, 60), b1 = runSteps(true, 60), a2 = runSteps(false, 60), b2 = runSteps(true, 60);
  const off = (a1.msPerStep + a2.msPerStep) / 2, on = (b1.msPerStep + b2.msPerStep) / 2;
  out.timing.playerStep = { net_off_us: +(off * 1000).toFixed(2), net_on_us: +(on * 1000).toFixed(2), delta_us: +((on - off) * 1000).toFixed(2), rescues: mv.rescueCount };
  mv.netEnabled = true;
  out.timing.netPerFrame60fps_ms = +(((on - off) * 2) ).toFixed(4);   // 2 steps per 60 fps frame
  out.rescues = mv.rescueCount;
  done = true;
}

export function drive(t, dt, game, report) {
  if (done && !report.done) game.autotest.finish();
}
