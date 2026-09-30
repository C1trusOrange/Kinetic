// Random-input fuzz on a real map: many short episodes from random walkable spots, driving the PlayerController
// headlessly with random movement programs (sprint / jump / double jump / crouch-slide / strafe / grapple / rocket
// knockback), biased toward nearby walls. The independent brute-force detector looks for a capsule inside a solid.
//   python tools/run.py "index.html?autotest=1&map=foundry&bots=0&god=1&duration=99999&scenario=tools/out/collision/fuzz.js&episodes=300" --report --timeout 900
import * as THREE from 'three';
import { Detector, teleport, STEP, R } from './lib.js';

let det = null, nodes = null, epi = 0, EP = 200, DUR = 8, seedBase = 1, doneAt = 0, t0 = 0;
const found = [];
const totals = { episodes: 0, steps: 0, inside: 0, mantles: 0, stepUps: 0, wallruns: 0, grapples: 0, rescues: 0, impulses: 0 };
const vv = new THREE.Vector3();

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

export async function setup(game, report) {
  det = new Detector(game);
  nodes = game.world.nav.nodes;
  EP = parseInt(game.params.get('episodes') || '200', 10);
  DUR = parseFloat(game.params.get('dur') || '8');
  seedBase = parseInt(game.params.get('seed') || '1', 10);
  report.custom = { detector: { tris: det.count }, nodes: nodes.length };
  t0 = performance.now();
}

function episode(game, seed, report) {
  const r = rng(seed * 7919 + seedBase);
  const P = game.player, mv = P.move, inp = mv.in, coll = game.world.collision;
  const node = nodes[Math.floor(r() * nodes.length)];
  let yaw = r() * Math.PI * 2;
  if (r() < 0.6) {
    // face the nearest wall so the episode interacts with geometry
    let best = 1e9;
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2;
      vv.set(-Math.sin(a), 0, -Math.cos(a));
      const o = new THREE.Vector3(node.position.x, node.position.y + 1.0, node.position.z);
      const h = coll.raycast(o, vv, 15);
      if (h && h.distance < best && Math.abs(h.normal.y) < 0.4) { best = h.distance; yaw = a; }
    }
  }
  teleport(game, node.position.x, node.position.y, node.position.z, yaw);
  const rescue0 = mv.rescueCount || 0;
  // instrument step-ups
  let stepUps = 0, lastStepUpT = -9;
  const origStep = mv._tryStepUp;
  mv._tryStepUp = function (...a) { const ok = origStep.apply(this, a); if (ok) { stepUps++; lastStepUpT = this.t; } return ok; };
  let seg = 0, segEnd = 0;
  let fwd = true, sprint = false, crouch = false, strafe = 0, turn = 0, jumpAt = [];
  let mantleStart = -9, wasMantling = false, lastGrapple = -9, sawWall = false;
  const total = Math.round(DUR / STEP);
  let result = null;
  for (let i = 0; i < total && !result; i++) {
    const t = i * STEP;
    if (t >= segEnd) {
      seg++;
      segEnd = t + 0.15 + r() * 0.7;
      fwd = r() < 0.85;
      sprint = r() < 0.6;
      crouch = r() < 0.15;
      strafe = r() < 0.7 ? 0 : (r() < 0.5 ? -1 : 1);
      turn = (r() - 0.5) * (r() < 0.3 ? 4 : 0.8);
      jumpAt = [];
      if (r() < 0.55) jumpAt.push(t + r() * 0.1);
      if (r() < 0.35) jumpAt.push(t + 0.25 + r() * 0.35);
      if (r() < 0.10) { // rocket knockback
        vv.set((r() - 0.5) * 40, r() * 16, (r() - 0.5) * 40);
        P.applyImpulse(vv);
        totals.impulses++;
      }
      if (r() < 0.10 && t - lastGrapple > 1) {
        lastGrapple = t;
        P.pitch = (r() - 0.3) * 1.2;
        game.camera.position.set(P.position.x, P.position.y + P.eyeHeight, P.position.z);
        game.camera.rotation.set(P.pitch, yaw, 0, 'YXZ');
        game.camera.updateMatrixWorld(true);
        P.grapple.cooldown = 0;
        P.grapple.fire();
      } else if (P.pitch !== 0 && r() < 0.5) P.pitch = 0;
    }
    yaw += turn * STEP;
    P.yaw = yaw;
    inp.forwardHeld = fwd; inp.fwd = fwd ? 1 : 0; inp.strafe = strafe;
    let wx = 0, wz = 0;
    if (fwd) { wx += -Math.sin(yaw); wz += -Math.cos(yaw); }
    if (strafe) { wx += Math.cos(yaw) * strafe; wz += -Math.sin(yaw) * strafe; }
    const l = Math.hypot(wx, wz);
    if (l > 0) { inp.wishX = wx / l; inp.wishZ = wz / l; inp.wishLen = 1; } else { inp.wishX = inp.wishZ = inp.wishLen = 0; }
    inp.sprintHeld = sprint;
    const wasCrouch = inp.crouchHeld;
    inp.crouchHeld = crouch;
    inp.crouchFresh = crouch && !wasCrouch;
    inp.jumpFresh = false;
    while (jumpAt.length && jumpAt[0] <= t) { inp.jumpFresh = true; jumpAt.shift(); }
    inp.jumpHeld = inp.jumpFresh;
    P.grapple.update(STEP);
    P.prevPosition.copy(P.position);
    mv.step(STEP);
    inp.crouchFresh = false;
    if (mv.mantling && !wasMantling) { mantleStart = t; totals.mantles++; }
    wasMantling = mv.mantling;
    if (mv.wallRunning && !sawWall) { sawWall = true; totals.wallruns++; }
    totals.steps++;
    if (i % 30 === 29 && det.insideCapsule(mv.capsule)) {
      result = {
        seed, t: +t.toFixed(2), pos: [P.position.x, P.position.y, P.position.z].map(v => +v.toFixed(2)), state: mv.state,
        sinceMantle: +(t - mantleStart).toFixed(2), sinceStepUp: +(t - lastStepUpT).toFixed(2), start: [node.position.x, node.position.y, node.position.z].map(v => +v.toFixed(1)),
        grappling: P.grapple.attached, rescues: (mv.rescueCount || 0) - rescue0,
      };
    }
  }
  mv._tryStepUp = origStep;
  P.grapple.reset();
  totals.stepUps += stepUps;
  totals.rescues += (mv.rescueCount || 0) - rescue0;
  if ((mv.rescueCount || 0) - rescue0 > 0) found.push({ seed, rescued: mv.rescueLog.slice(-((mv.rescueCount || 0) - rescue0)) });
  if (result) { totals.inside++; found.push(result); }
  totals.episodes++;
}

export function drive(t, dt, game, report) {
  if (doneAt) return;
  const start = performance.now();
  while (performance.now() - start < 40 && epi < EP) { episode(game, ++epi, report); }
  if (epi >= EP) {
    doneAt = performance.now();
    report.custom.totals = totals;
    report.custom.found = found.slice(0, 40);
    report.custom.seconds = +((doneAt - t0) / 1000).toFixed(1);
    report.custom.rescues = game.player.move.rescueCount || 0;
    game.autotest.finish();
  }
}
