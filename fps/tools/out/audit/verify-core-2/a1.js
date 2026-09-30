const sleep = ms => new Promise(r => setTimeout(r, ms));
export function drive(t, dt, g, r) {}
export async function setup(g, r) {
  r.custom = {};
  (async () => {
    const c = r.custom;
    try {
      const a = g.audio;
      c.ctxState = a.ctx && a.ctx.state;
      c.ready = a.ready;
      await sleep(500);
      g.player._onSlideStart(false);
      c.loopsAfterStart = a.loops.size;
      await sleep(300);
      c.loopBusPlaying = a.loopBus && a.loopBus.gain.value;
      g.pause();
      c.state1 = g.state;
      await sleep(1500);
      c.pause = { loops: a.loops.size, loopBusGain: a.loopBus && a.loopBus.gain.value, pauseMuffle: a._pauseMuffle, muffleFreq: a.muffle && a.muffle.frequency.value, state: g.state };
      // now resume, then end the match and check after the outro
      g.resume();
      await sleep(300);
      g.endMatch('time');
      c.endedState0 = g.state;
      await sleep(4500);
      c.ended = { state: g.state, loops: a.loops.size, loopBusGain: a.loopBus && a.loopBus.gain.value, endTimer: g._endTimer };
      // now what if audio.update ran in ended: would loops be muted?
      for (let i = 0; i < 30; i++) a.update(1/60);
      c.endedIfUpdated = { loopBusGain: a.loopBus.gain.value, loopGain: a._loopGain };
      g.state = 'paused';
      for (let i = 0; i < 60; i++) a.update(1/60);
      c.pausedIfUpdated = { loopBusGain: a.loopBus.gain.value, muffle: a._pauseMuffle, freq: a.muffle.frequency.value };
      g.state = 'ended';
    } catch (e) { c.err = String(e && e.stack || e); }
    c.done = true;
  })();
}
export function finish(g, r) {}
