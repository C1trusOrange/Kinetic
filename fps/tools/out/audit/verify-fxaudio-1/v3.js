import * as THREE from 'three';
const mode = new URLSearchParams(location.search).get('mode') || 'end';
const st = {};
export function setup(game, report) {
  report.custom = { mode, samples: [] };
  game.player.spawn(new THREE.Vector3(-8, 0.05, 0), Math.PI / 2);
  game.player.pitch = 0.3;
}
function sample(game, tag) {
  const a = game.audio, p = game.player;
  return {
    tag, state: game.state, endTimer: +game._endTimer.toFixed(2), grapple: p.grapple.state, loops: a.loops.size,
    loopGain: +a.loopBus.gain.value.toFixed(3), muffleHz: Math.round(a.muffle.frequency.value), ctx: a.ctx.state,
    slide: !!p.isSliding,
  };
}
export function drive(t, dt, game, report) {
  const c = report.custom, p = game.player, inp = game.input;
  if (t < 0.5) { p.yaw = Math.PI / 2; p.pitch = 0.3; return; }
  inp.setVirtual('grapple', t > 0.6 && t < 0.65 && !st.fired);
  if (t >= 0.65) st.fired = true;
  if (!st.fired) { p.yaw = Math.PI / 2; p.pitch = 0.3; }
  if (p.grapple.state === 'attached' && !st.trig) {
    st.trig = true;
    c.samples.push(sample(game, 'attached'));
    if (mode === 'pause') game.pause();
    else if (mode === 'pause2') setTimeout(() => game.pause(), 30);
    else if (mode === 'end') game.endMatch('score');
    const t0 = performance.now();
    for (const ms of [600, 1500, 3000, 5000]) setTimeout(() => c.samples.push(sample(game, 'after-' + ms)), ms);
    setTimeout(() => { window.__S2DONE__ = true; }, 5200);
  }
  if (t > 5 && !st.trig) { c.noAttach = sample(game, 'noattach'); window.__S2DONE__ = true; }
}
export function finish() {}
