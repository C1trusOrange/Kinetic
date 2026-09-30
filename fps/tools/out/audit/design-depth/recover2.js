// Scripted "skilled" recovery: grapple the lip of the far shelf, then jump + forward + double-jump onto the top once the reel gets close.
import * as THREE from 'three';
const out = { runs: [] };
let stage = 0, cur = null;
const tests = [
  { name: 'push14_grapple@0.35s', delay: 0.35, imp: [0, 2, -14] },
  { name: 'push14_grapple@0.55s', delay: 0.55, imp: [0, 2, -14] },
  { name: 'push14_grapple@0.75s', delay: 0.75, imp: [0, 2, -14] },
  { name: 'push14_grapple@0.95s', delay: 0.95, imp: [0, 2, -14] },
  { name: 'push14_grapple@1.20s', delay: 1.2, imp: [0, 2, -14] },
];
export function setup(game, report) { game.player.god = true; report.custom = out; }
function begin(game, tst) {
  const p = game.player;
  p.spawn(new THREE.Vector3(10, 0, -17), 0);
  p.god = true; p.spawnProtectedUntil = 0;
  p.applyImpulse(new THREE.Vector3(...tst.imp));
  cur = { tst, t0: game.time, minY: 0, phase: 0, jumps: 0, lastJump: -9, anchor: null };
}
export function drive(t, dt, game, report) {
  const p = game.player, inp = game.input;
  if (!cur && stage < tests.length && t > 0.6 + stage * 7) begin(game, tests[stage]);
  if (!cur) return;
  const el = game.time - cur.t0;
  cur.minY = Math.min(cur.minY, p.position.y);
  const eye = p.getEyePosition(new THREE.Vector3());
  const aimAt = (x, y, z) => { const d = new THREE.Vector3(x, y, z).sub(eye); p.yaw = Math.atan2(-d.x, -d.z); p.pitch = Math.atan2(d.y, Math.hypot(d.x, d.z)); };
  if (cur.phase === 0 && el >= cur.tst.delay - 0.05) { aimAt(10, 0.4, -30.3); cur.phase = 1; }
  else if (cur.phase === 1 && el >= cur.tst.delay) { inp.setVirtual('grapple', true); cur.phase = 2; cur.firedY = +p.position.y.toFixed(1); }
  else if (cur.phase === 2 && el >= cur.tst.delay + 0.12) { inp.setVirtual('grapple', false); cur.phase = 3; }
  if (p.grappleAnchor && !cur.anchor) cur.anchor = p.grappleAnchor.toArray().map(v => +v.toFixed(1));
  if (cur.phase === 3 && p.isGrappling && cur.anchor) {
    const dist = eye.distanceTo(new THREE.Vector3(...cur.anchor));
    aimAt(10, 1.6, -33);
    inp.setVirtual('forward', dist < 5);
    if (dist < 3.4 && cur.jumps === 0) { inp.setVirtual('jump', true); cur.jumps = 1; cur.lastJump = el; }
  }
  if (cur.jumps === 1 && el - cur.lastJump > 0.05) inp.setVirtual('jump', false);
  if (cur.jumps === 1 && !p.isGrappling && el - cur.lastJump > 0.35 && !cur.dj) { inp.setVirtual('jump', true); cur.dj = true; cur.djAt = el; }
  if (cur.dj && el - cur.djAt > 0.05) inp.setVirtual('jump', false);
  if (cur.jumps === 1) { aimAt(10, 1.6, -34); inp.setVirtual('forward', true); }
  const done = el > 5.5 || (!p.alive && el > 0.5);
  if (done) {
    inp.setVirtual('forward', false); inp.setVirtual('jump', false); inp.setVirtual('grapple', false);
    out.runs.push({ name: cur.tst.name, firedY: cur.firedY ?? null, anchor: cur.anchor, minY: +cur.minY.toFixed(1), alive: p.alive, endPos: p.position.toArray().map(v => +v.toFixed(1)), onGround: p.onGround, onShelf: p.alive && p.position.z < -30 && p.position.y > -0.6 });
    cur = null; stage++;
  }
}
