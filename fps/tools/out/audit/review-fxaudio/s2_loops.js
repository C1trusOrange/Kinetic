// loops during pause / match end, driven by real player slide
const mode = new URLSearchParams(location.search).get('mode') || 'pause';
const st = { slideSeen: 0, done: false };
export function setup(game, report) { report.custom = { mode, samples: [] }; }
function sample(game, tag) {
  const a = game.audio, p = game.player;
  return {
    tag, state: game.state, endTimer: +game._endTimer.toFixed(2), sliding: p.isSliding, loops: a.loops.size,
    loopGain: +a.loopBus.gain.value.toFixed(3), loopGainCur: +a._loopGain.toFixed(3), muffleHz: Math.round(a.muffle.frequency.value),
    pauseMuffle: +a._pauseMuffle.toFixed(3), ctx: a.ctx.state, timeScale: game.timeScale,
  };
}
export function drive(t, dt, game, report) {
  const inp = game.input, c = report.custom, p = game.player;
  inp.setVirtual('forward', t > 0.8 && !st.done);
  inp.setVirtual('sprint', t > 0.8 && !st.done);
  inp.setVirtual('crouch', t > 2.2 && !st.done);
  if (p.isSliding && !st.trig) {
    st.trig = true;
    c.samples.push(sample(game, 'slide-start'));
    if (mode === 'pause') {
      setTimeout(() => game.pause(), 30);
    } else if (mode === 'end') {
      game.endMatch('score');
    } else if (mode === 'quit') {
      setTimeout(() => game.quitToMenu(), 30);
    }
    for (const ms of [500, 1500, 3000, 5000]) setTimeout(() => c.samples.push(sample(game, 'after-' + ms)), ms);
    setTimeout(() => { report.custom.playerSlidingFinal = p.isSliding; window.__S2DONE__ = true; }, 5200);
  }
  if (t > 7 && !st.trig) c.noSlide = true;
  if (st.trig && mode !== 'pause') st.done = true;
}
export function finish(game, report) {
  // keep the run alive until the real-time samples are in
}
