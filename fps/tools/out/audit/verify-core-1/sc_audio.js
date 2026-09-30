// F1: real slide -> Esc keydown -> loops during pause; and match end while sliding
let phase = 0;
let tPause = 0;
const snap = (g, tag, r) => {
  const a = g.audio;
  (r.custom.snaps ||= []).push({ tag, state: g.state, ctx: a.ctx && a.ctx.state, loops: a.loops.size,
    loopBus: a.loopBus && a.loopBus.gain.value, muffle: a._pauseMuffle, sliding: g.player.isSliding, wall: g.player.isWallRunning, speed: +g.player.speed.toFixed(1) });
};
export function setup(g, r) { r.custom = {}; g.audio.unlock(); }
export function drive(t, dt, g, r) {
  const inp = g.input;
  if (g.state === 'playing') {
    if (phase === 0) {
      inp.setVirtual('forward', true); inp.setVirtual('sprint', t > 0.3);
      if (t > 1.2 && t < 1.3) inp.setVirtual('crouch', true);
      if (t > 1.35 && phase === 0) {
        snap(g, 'slide-started', r);
        phase = 1; tPause = t;
        window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape', key: 'Escape' }));
        snap(g, 'just-after-esc', r);
      }
    }
  }
}
export function finish(g, r) { snap(g, 'finish', r); }
