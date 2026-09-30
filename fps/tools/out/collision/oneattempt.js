// Trace one air attempt step by step. Params: x,y,z (feet), yaw, vx,vz, steps
import * as THREE from 'three';
import { Detector, teleport, STEP } from './lib.js';

let done = false;

export async function setup(game, report) {
  const q = k => parseFloat(game.params.get(k));
  const det = new Detector(game);
  const P = game.player, mv = P.move, inp = mv.in, coll = game.world.collision;
  const x = q('x'), y = q('y'), z = q('z'), yaw = q('yaw'), vx = q('vx') || 0, vz = q('vz') || 0;
  const N = parseInt(game.params.get('steps') || '10', 10);
  const trace = [];
  teleport(game, x, y, z, yaw, { air: true, vel: [vx, 0, vz] });
  const r3 = v => +v.toFixed(3);
  trace.push({ i: 'after teleport', feet: [P.position.x, P.position.y, P.position.z].map(r3), cap: [mv.capsule.start.y, mv.capsule.end.y].map(r3), grounded: mv.grounded, api: coll.capsuleInside(mv.capsule), brute: det.insideCapsule(mv.capsule) });
  const origStep = mv._tryStepUp;
  let stepUp = false;
  mv._tryStepUp = function (...a) { const ok = origStep.apply(this, a); if (ok) stepUp = true; return ok; };
  const orig2 = mv._rescue;
  mv._rescue = function (reason) { trace.push({ i: 'RESCUE', reason, cap: [mv.capsule.start.x, mv.capsule.start.y, mv.capsule.start.z].map(r3), api: coll.capsuleInside(mv.capsule), brute: det.insideCapsule(mv.capsule) }); return orig2.call(this, reason); };
  const calls = [];
  const origRes = coll.resolveCapsule.bind(coll);
  coll.resolveCapsule = function (cap) {
    const b = [cap.start.x, cap.start.y, cap.start.z].map(r3);
    const res = origRes(cap);
    if (calls.length < 40 && (Math.abs(cap.start.y - b[1]) > 0.05 || res.count > 0)) {
      const st = new Error().stack.split('\n').slice(2, 4).map(l => l.trim().replace(/http:\/\/[^/]+\//, '')).join(' < ');
      calls.push({ from: b, to: [cap.start.x, cap.start.y, cap.start.z].map(r3), n: res.count, normals: Array.from({ length: Math.min(res.count, 4) }, (_, k) => [res.normals[k].x, res.normals[k].y, res.normals[k].z].map(v => +v.toFixed(2))), depths: Array.from({ length: Math.min(res.count, 4) }, (_, k) => +res.depths[k].toFixed(3)), st });
    }
    return res;
  };
  for (let i = 0; i < N; i++) {
    inp.forwardHeld = false; inp.wishX = inp.wishZ = inp.wishLen = 0; inp.jumpFresh = false;
    stepUp = false;
    P.prevPosition.copy(P.position);
    const before = [mv.capsule.start.x, mv.capsule.start.y, mv.capsule.start.z].map(r3);
    mv.step(STEP);
    trace.push({ i, st: mv.state, before, after: [mv.capsule.start.x, mv.capsule.start.y, mv.capsule.start.z].map(r3), vel: [P.velocity.x, P.velocity.y, P.velocity.z].map(r3), stepUp, api: coll.capsuleInside(mv.capsule), brute: det.insideCapsule(mv.capsule), rescues: mv.rescueCount });
  }
  report.custom = { trace, calls };
  done = true;
}

export function drive(t, dt, game, report) {
  if (done && !report.done) game.autotest.finish();
}
