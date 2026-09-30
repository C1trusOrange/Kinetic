// F1 (real path): Esc keydown dispatched between frames while sliding
const snap = (g, tag, r) => {
  const a = g.audio;
  (r.custom.snaps ||= []).push({ tag, state: g.state, ctx: a.ctx && a.ctx.state, loops: a.loops.size,
    loopBus: a.loopBus && a.loopBus.gain.value, muffle: a._pauseMuffle, sliding: g.player.isSliding, speed: +g.player.speed.toFixed(1), frame: g.frame });
};
export function setup(g, r) {
  r.custom = {};
  g.audio.unlock();
  const iv = setInterval(() => {
    if (g.state === 'playing' && g.player.isSliding && g.audio.loops.size > 0) {
      clearInterval(iv);
      snap(g, 'before-esc', r);
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape', key: 'Escape' }));
      snap(g, 'after-esc', r);
      setTimeout(() => snap(g, 'esc+1.5s', r), 1500);
      setTimeout(() => snap(g, 'esc+3s', r), 3000);
    }
  }, 5);
}
export function drive(t, dt, g, r) {
  const inp = g.input;
  inp.setVirtual('forward', true); inp.setVirtual('sprint', t > 0.3);
  inp.setVirtual('crouch', t > 1.2 && t < 3.0);
}
export function finish(g, r) {}
