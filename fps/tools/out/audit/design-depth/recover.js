// Can a shoved player recover with the grapple? Push north over the C-plateau/N-shelf pit, then grapple the shelf face / underside.
import * as THREE from 'three';
const out = { runs: [] };
let stage = 0, t0 = 0, cur = null;
const tests = [
  { name: 'grapple_after_0.55s', delay: 0.55, imp: [0, 2, -14] },
  { name: 'grapple_after_0.9s', delay: 0.9, imp: [0, 2, -14] },
  { name: 'no_recovery_control', delay: 99, imp: [0, 2, -14] },
  { name: 'grapple_after_1.3s_short_push', delay: 1.3, imp: [0, 2, -10] },
];
export function setup(game, report) { game.player.god = true; report.custom = out; }
function begin(game, tst, t) {
  const p = game.player;
  p.spawn(new THREE.Vector3(10, 0, -17), 0);
  p.god = true;
  p.spawnProtectedUntil = 0;
  p.applyImpulse(new THREE.Vector3(...tst.imp));
  cur = { tst, t0: game.time, minY: 0, fired: false, releasedAt: null, died: false, alive: true, grappled: false, endY: null, maxSpeed: 0 };
}
export function drive(t, dt, game, report) {
  const p = game.player, inp = game.input;
  if (!cur && stage < tests.length && t > 0.6 + stage * 6) begin(game, tests[stage], t);
  if (!cur) return;
  const el = game.time - cur.t0;
  cur.minY = Math.min(cur.minY, p.position.y);
  if (!p.alive) cur.died = true;
  if (!cur.aimed && el >= cur.tst.delay - 0.05 && p.alive) {
    // aim at the N shelf's TOP edge (10,0,-30) so the reel lifts us over the lip
    const tgt = new THREE.Vector3(10, 0.3, -30.2);
    const d = tgt.clone().sub(p.getEyePosition(new THREE.Vector3()));
    p.yaw = Math.atan2(-d.x, -d.z);
    p.pitch = Math.atan2(d.y, Math.hypot(d.x, d.z));
    cur.aimed = true;
  }
  if (!cur.fired && cur.aimed && el >= cur.tst.delay && p.alive) {
    inp.setVirtual('grapple', true);
    cur.fired = true; cur.firedAt = +el.toFixed(2); cur.firedY = +p.position.y.toFixed(1);
  } else if (cur.fired && el > cur.firedAt + 0.15) inp.setVirtual('grapple', false);
  if (p.isGrappling) cur.grappled = true;
  if (p.grappleAnchor && !cur.anchor) cur.anchor = p.grappleAnchor.toArray().map(v => +v.toFixed(1));
  cur.maxSpeed = Math.max(cur.maxSpeed, p.velocity.length());
  if (el > 4.5 || (p.alive === false && el > 0.5)) {
    out.runs.push({ name: cur.tst.name, firedAt: cur.firedAt ?? null, firedY: cur.firedY ?? null, grappled: cur.grappled, anchor: cur.anchor || null, minY: +cur.minY.toFixed(1), diedByKillPlane: cur.died, endPos: p.position.toArray().map(v => +v.toFixed(1)), endAlive: p.alive, onGround: p.onGround });
    inp.setVirtual('grapple', false);
    cur = null; stage++;
  }
}
