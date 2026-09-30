// Per-frame cost of the new collision checks. Runs the real PlayerController (120 Hz sub-steps, no rendering) through
// seeded episodes that sprint / jump / double-jump at the nearest wall from random nav nodes (lots of mantle attempts,
// wall contacts, step-ups), timing whole episodes (batch timing: no timer quantisation error).
// Same file runs on the pristine base tree (old code) and on the fixed tree (new code, safety net on / off):
//   python tools/run.py "index.html?autotest=1&map=foundry&bots=0&god=1&duration=99999&scenario=tools/out/collision/cost.js" --report
import * as THREE from 'three';
import { teleport, STEP } from './lib.js';

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

const vv = new THREE.Vector3();
const oo = new THREE.Vector3();

export async function setup(game, report) {
  const P = game.player, mv = P.move, inp = mv.in, coll = game.world.collision;
  const nodes = game.world.nav.nodes;
  const EPIS = parseInt(game.params.get('episodes') || '240', 10);
  const hasNet = 'netEnabled' in mv;

  // pre-compute the episode list once (positions + yaw toward the nearest wall)
  const r0 = rng(4242);
  const eps = [];
  for (let e = 0; e < EPIS; e++) {
    const node = nodes[Math.floor(r0() * nodes.length)];
    let yaw = r0() * Math.PI * 2, best = 1e9;
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2;
      vv.set(-Math.sin(a), 0, -Math.cos(a));
      oo.set(node.position.x, node.position.y + 1.0, node.position.z);
      const h = coll.raycast(oo, vv, 12);
      if (h && h.distance < best && Math.abs(h.normal.y) < 0.4) { best = h.distance; yaw = a; }
    }
    eps.push({ x: node.position.x, y: node.position.y, z: node.position.z, yaw, j1: 0.1 + r0() * 0.5, j2: 0.6 + r0() * 0.5, sprint: r0() < 0.7 });
  }

  const run = (net) => {
    if (hasNet) mv.netEnabled = net;
    let total = 0, steps = 0, mantles = 0;
    const rc0 = mv.rescueCount || 0;
    for (const ep of eps) {
      teleport(game, ep.x, ep.y, ep.z, ep.yaw);
      let wasM = false;
      const N = 150;
      const t0 = performance.now();
      for (let i = 0; i < N; i++) {
        const t = i * STEP;
        inp.forwardHeld = true; inp.fwd = 1; inp.wishX = -Math.sin(ep.yaw); inp.wishZ = -Math.cos(ep.yaw); inp.wishLen = 1;
        inp.sprintHeld = ep.sprint;
        inp.jumpFresh = (t >= ep.j1 && t < ep.j1 + STEP) || (t >= ep.j2 && t < ep.j2 + STEP);
        inp.jumpHeld = inp.jumpFresh;
        P.prevPosition.copy(P.position);
        mv.step(STEP);
        if (mv.mantling && !wasM) mantles++;
        wasM = mv.mantling;
      }
      total += performance.now() - t0;
      steps += N;
    }
    inp.jumpFresh = false;
    return { usPerStep: total / steps * 1000, steps, mantles, rescues: (mv.rescueCount || 0) - rc0 };
  };

  run(hasNet);                 // warm up (JIT)
  const rows = [];
  for (let rep = 0; rep < 3; rep++) {
    if (hasNet) rows.push({ net: false, ...run(false) });
    rows.push({ net: hasNet, ...run(hasNet) });
  }
  const med = a => { const s = a.slice().sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
  const on = rows.filter(r => r.net === hasNet).map(r => r.usPerStep);
  const off = rows.filter(r => !r.net).map(r => r.usPerStep);
  report.custom = {
    map: game.world.mapId,
    hasSafetyNet: hasNet,
    episodes: EPIS,
    rows: rows.map(r => ({ net: r.net, usPerStep: +r.usPerStep.toFixed(2), mantles: r.mantles, rescues: r.rescues })),
    medianUsPerStep_default: +med(on).toFixed(2),
    medianUsPerStep_netOff: off.length ? +med(off).toFixed(2) : null,
    msPerFrame60_default: +(med(on) * 2 / 1000).toFixed(4),
    msPerFrame60_netOff: off.length ? +(med(off) * 2 / 1000).toFixed(4) : null,
  };
  done = true;
}

export function drive(t, dt, game, report) {
  if (done && !report.done) game.autotest.finish();
}
