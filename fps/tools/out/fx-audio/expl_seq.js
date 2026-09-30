import * as THREE from 'three';
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const P = new URLSearchParams(location.search);
const kind = P.get('kind') || 'ground';
const TIMES = (P.get('times') || '0.06,0.16,0.35,0.7,1.3,2.6').split(',').map(Number);
const T0 = 0.3;
let fired = false, idx = 0, waitAck = null;
export function setup(game, report) { report.custom = { kind }; }
export function drive(t, dt, game, report) {
  if (waitAck !== null) { if ((window.__SHOT_ACK || 0) > waitAck) { waitAck = null; game.timeScale = 1; } return; }
  if (!fired && t >= T0) {
    fired = true;
    if (kind === 'near') game.effects.explosion(V(0, 0.15, 25.2), { radius: 4.8, normal: V(0, 1, 0) });
    else if (kind === 'wall') game.effects.explosion(V(-2, 2.6, 12.85), { radius: 4.8, normal: V(0, 0, 1) });
    else if (kind === 'small') game.effects.explosion(V(0, 0.15, 17), { radius: 6.5, normal: V(0, 1, 0) });
    else game.effects.explosion(V(0, 0.15, 17), { radius: 4.8, normal: V(0, 1, 0) });
  }
  if (fired && idx < TIMES.length && t >= T0 + TIMES[idx]) {
    window.__SHOT_REQ = 'e' + idx; waitAck = window.__SHOT_ACK || 0; game.timeScale = 0; idx++;
  }
  if (idx >= TIMES.length) report.custom.done = true;
}
export function finish(game, report) { report.custom.stats = { ...game.effects.stats }; }
