// How does the capsule get inside a thin solid? Runs the seeded cost.js episodes with the safety net OFF and, at the
// first step where a sphere centre is inside a solid (API + independent brute-force detector), dumps the previous steps
// (movement state, position, velocity, which movement helpers fired) so the entry mechanism is visible.
//   python tools/run.py "index.html?autotest=1&map=foundry&bots=0&god=1&duration=99999&scenario=tools/out/collision/entry.js" --report
import * as THREE from 'three';
import { Detector, teleport, STEP } from './lib.js';

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
const r2 = v => +v.toFixed(3);

export async function setup(game, report) {
  const P = game.player, mv = P.move, inp = mv.in, coll = game.world.collision;
  const det = new Detector(game);
  const nodes = game.world.nav.nodes;
  const EPIS = parseInt(game.params.get('episodes') || '240', 10);
  if ('netEnabled' in mv) mv.netEnabled = false;

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

  const found = [];
  let origStep = mv._tryStepUp;
  let stepUpAt = -99, curI = 0;
  mv._tryStepUp = function (...a) { const ok = origStep.apply(this, a); if (ok) stepUpAt = curI; return ok; };
  let ei = 0;
  for (const ep of eps) {
    ei++;
    teleport(game, ep.x, ep.y, ep.z, ep.yaw);
    const ring = [];
    stepUpAt = -99;
    let gotOne = false;
    for (let i = 0; i < 150 && !gotOne; i++) {
      curI = i;
      const t = i * STEP;
      inp.forwardHeld = true; inp.fwd = 1; inp.wishX = -Math.sin(ep.yaw); inp.wishZ = -Math.cos(ep.yaw); inp.wishLen = 1;
      inp.sprintHeld = ep.sprint;
      inp.jumpFresh = (t >= ep.j1 && t < ep.j1 + STEP) || (t >= ep.j2 && t < ep.j2 + STEP);
      inp.jumpHeld = inp.jumpFresh;
      P.prevPosition.copy(P.position);
      const pre = { i, st: mv.state, pos: [P.position.x, P.position.y, P.position.z].map(r2), vel: [P.velocity.x, P.velocity.y, P.velocity.z].map(r2) };
      mv.step(STEP);
      pre.after = [P.position.x, P.position.y, P.position.z].map(r2);
      pre.grounded = mv.grounded; pre.stepUp = stepUpAt === i; pre.slide = mv.sliding; pre.crouch = mv.crouched; pre.wall = mv.wallRunning; pre.mant = mv.mantling;
      ring.push(pre); if (ring.length > 8) ring.shift();
      if (coll.capsuleInside ? coll.capsuleInside(mv.capsule) : det.insideCapsule(mv.capsule)) {
        const c = mv.capsule;
        found.push({
          episode: ei, step: i, yaw: r2(ep.yaw), start: [ep.x, ep.y, ep.z].map(r2),
          brute: det.insideCapsule(c),
          apiStart: coll.isInsideXYZ ? coll.isInsideXYZ(c.start.x, c.start.y, c.start.z, 3) : null, apiEnd: coll.isInsideXYZ ? coll.isInsideXYZ(c.end.x, c.end.y, c.end.z, 3) : null,
          ring,
        });
        gotOne = true;
      }
    }
  }
  mv._tryStepUp = origStep;
  if ('netEnabled' in mv) mv.netEnabled = true;
  report.custom = { episodes: EPIS, insideEpisodes: found.length, found: found.slice(0, 10) };
  done = true;
}

export function drive(t, dt, game, report) {
  if (done && !report.done) game.autotest.finish();
}
