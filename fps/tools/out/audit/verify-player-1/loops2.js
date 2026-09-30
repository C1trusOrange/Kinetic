import * as THREE from 'three';
import { teleport, keys, releaseAll, r2, loopInfo } from './common.js';
const q = new URLSearchParams(location.search);
const mode = q.get('mode2') || 'end';
let phase = 0, t0 = 0;
export async function setup(game, report) {
  report.custom = { mode, log: [] };
  game.player.god = true;
  game.autotest.duration = 9999;
}
export function drive(t, dt, game, report) {
  const R = report.custom;
  const p = game.player;
  if (phase === 0 && t > 0.6) {
    phase = 1; t0 = t;
    const s = new THREE.Vector3(parseFloat(q.get('sx')), parseFloat(q.get('sy') || '0'), parseFloat(q.get('sz')));
    const tg = new THREE.Vector3(parseFloat(q.get('tx')), parseFloat(q.get('ty')), parseFloat(q.get('tz')));
    const d = tg.clone().sub(new THREE.Vector3(s.x, s.y + 1.66, s.z));
    const yaw = Math.atan2(-d.x, -d.z), pitch = Math.atan2(d.y, Math.hypot(d.x, d.z));
    teleport(game, s.x, s.y, s.z, yaw, pitch);
  }
  if (phase === 1) {
    const lt = t - t0;
    keys(game, { grapple: lt > 0.1 && lt < 0.15 });
    if (p.grapple.attached && !R.attT) { R.attT = lt; R.anchor = p.grapple.anchor.toArray().map(r2); R.anchorDist = r2(p.grapple.anchor.distanceTo(p.position)); }
    if (R.attT && lt > R.attT + parseFloat(q.get('wait') || '0.25')) {
      R.before = { gstate: p.grapple.state, ...loopInfo(game), gvis: p.grapple.group.visible, dist: r2(p.grapple.anchor.distanceTo(p.position)) };
      phase = 2;
      if (mode === 'end') game.endMatch('score');
      if (mode === 'quit') { game.pause(); setTimeout(() => game.quitToMenu(), 300); }
      const T0 = performance.now();
      const iv = setInterval(() => { R.log.push([Math.round(performance.now() - T0), game.state, p.grapple.state, r2(p.grapple.anchor.distanceTo(p.position)), game.audio.loops.size, +game.audio.loopBus.gain.value.toFixed(2), game._endTimer !== undefined ? r2(game._endTimer) : null]); }, 700);
      setTimeout(() => {
        clearInterval(iv);
        R.after = { gstate: p.grapple.state, ...loopInfo(game), gvis: p.grapple.group.visible, alive: p.alive, isGrappling: p.isGrappling, endTimer: game._endTimer };
        report.done = true;
      }, 5500);
    }
  }
}
