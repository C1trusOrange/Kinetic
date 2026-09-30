// Crouch under the low slab of the synthetic map, release crouch, log what happens.
import * as THREE from 'three';
import { Detector, teleport, STEP } from './lib.js';
let done = false;
export async function setup(game, report) {
  const det = new Detector(game);
  const P = game.player, mv = P.move, inp = mv.in, coll = game.world.collision;
  const sp = game.world.def.spots.find(s => s.name === 'crouch_under_1.5');
  const r3 = v => +v.toFixed(3);
  const trace = [];
  teleport(game, sp.x, 0, sp.front + 1.5, 0, {});
  for (let i = 0; i < Math.round(2.6 / STEP); i++) {
    const t = i * STEP;
    const holdF = t < 1.0;
    inp.forwardHeld = holdF; inp.fwd = holdF ? 1 : 0; inp.wishX = 0; inp.wishZ = holdF ? -1 : 0; inp.wishLen = holdF ? 1 : 0;
    const was = inp.crouchHeld;
    inp.crouchHeld = t < 1.2;
    inp.crouchFresh = inp.crouchHeld && !was;
    inp.jumpFresh = false; inp.sprintHeld = false;
    P.prevPosition.copy(P.position);
    mv.step(STEP);
    inp.crouchFresh = false;
    if (i % 25 === 0) trace.push({ t: r3(t), z: r3(P.position.z), y: r3(P.position.y), crouched: mv.crouched, h: r3(P.height), st: mv.state, inside: det.insideCapsule(mv.capsule), api: coll.capsuleInside ? coll.capsuleInside(mv.capsule) : null });
  }
  report.custom = { spot: { x: sp.x, front: sp.front }, trace, rescues: mv.rescueCount };
  done = true;
}
export function drive(t, dt, game, report) { if (done && !report.done) game.autotest.finish(); }
