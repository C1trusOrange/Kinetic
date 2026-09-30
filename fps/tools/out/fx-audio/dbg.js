import * as THREE from 'three';
const V = (x, y, z) => new THREE.Vector3(x, y, z);
let done = 0, waitAck = null, frames = 0;
export function setup(game, report) { report.custom = {}; }
export function drive(t, dt, game, report) {
  const fx = game.effects;
  if (waitAck !== null) { if ((window.__SHOT_ACK || 0) > waitAck) { waitAck = null; game.timeScale = 1; } return; }
  if (t > 0.3 && done === 0) {
    done = 1;
    fx.muzzleFlash(V(-2.2, 1.5, 17), V(1, 0, -0.3).normalize(), { scale: 1 });
    fx.muzzleFlash(V(2.2, 1.5, 17), V(-1, 0.05, -0.4).normalize(), { scale: 1.3, color: 0x9cd8ff });
    if (new URLSearchParams(location.search).has('long')) for (let i = 0; i < fx.glow.count; i++) fx.glow.data[i * 28 + 7] = 5;
    report.custom.n = fx.glow.count;
  }
  if (done === 1) {
    frames++;
    if (frames === 2) {
      const g = fx.glow; const arr = [];
      for (let i = 0; i < g.count; i++) arr.push(Array.from(g.gpu.slice(i * 14, i * 14 + 14)).map(v => +v.toFixed(2)).join(','));
      report.custom.dump = arr;
      window.__SHOT_REQ = 'dbg'; waitAck = window.__SHOT_ACK || 0; game.timeScale = 0; done = 2;
    }
  }
  if (done === 2 && waitAck === null) { report.custom.done = true; const g = fx.glow; const arr = []; for (let i = 0; i < g.count; i++) arr.push(Array.from(g.data.slice(i * 28, i * 28 + 8)).map(v => +v.toFixed(3)).join(',')); report.custom.after = { count: g.count, arr, ts: game.timeScale }; }
}
