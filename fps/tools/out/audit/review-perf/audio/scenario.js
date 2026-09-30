export function setup(game, report) {
  const c = report.custom = { slow: [], ctxState: [], firstPlay: null, plays: 0, playsWithVoice: 0 };
  const ctx = game.audio.ctx;
  c.state0 = ctx && ctx.state;
  const TH = 4;
  const wrapM = (obj, name, label) => {
    const o = obj[name];
    if (typeof o !== 'function') return;
    obj[name] = function (...a) {
      const t = performance.now();
      const r = o.apply(this, a);
      const d = performance.now() - t;
      if (d > TH) c.slow.push({ label, ms: +d.toFixed(1), t: +game.time.toFixed(2), state: ctx && ctx.state, extra: label === 'createPanner' ? '' : '' });
      return r;
    };
  };
  if (ctx) {
    const proto = Object.getPrototypeOf(ctx);
    for (const n of ['createBufferSource', 'createGain', 'createPanner', 'createBiquadFilter']) wrapM(proto, n, n);
    wrapM(AudioNode.prototype, 'connect', 'connect');
    wrapM(AudioBufferSourceNode.prototype, 'start', 'src.start');
    wrapM(AudioNode.prototype, 'disconnect', 'disconnect');
    wrapM(AudioParam.prototype, 'setTargetAtTime', 'setTargetAtTime');
    wrapM(AudioParam.prototype, 'cancelScheduledValues', 'cancelScheduledValues');
  }
  const AP = Object.getPrototypeOf(game.audio);
  const origPlay = AP.play;
  AP.play = function (name, o) {
    const t = performance.now();
    const st = ctx && ctx.state;
    const r = origPlay.call(this, name, o);
    const d = performance.now() - t;
    c.plays++;
    if (r) c.playsWithVoice++;
    if (r && !c.firstPlay) c.firstPlay = { name, ms: +d.toFixed(1), t: +game.time.toFixed(2), state: st, positional: !!(o && o.position) };
    if (d > 8) c.slow.push({ label: 'play:' + name, ms: +d.toFixed(1), t: +game.time.toFixed(2), state: st, voice: !!r, positional: !!(o && o.position), voices: game.audio.voices.length });
    return r;
  };
  const sample = () => c.ctxState.push([+game.time.toFixed(1), ctx && ctx.state]);
  sample();
  c._iv = setInterval(sample, 3000);
}
export function drive(t, dt, game, report) {
  const S = (a, b) => t >= a && t < b;
  const inp = game.input;
  inp.setVirtual('forward', S(1, 9.5) || S(12, 17));
  inp.setVirtual('sprint', S(1.3, 4.2) || S(14, 16));
  inp.setVirtual('fire', S(4.8, 6.4) || S(7.0, 7.05) || S(7.35, 7.4) || S(7.7, 7.75) || S(8.3, 8.35));
  inp.setVirtual('jump', S(2.4, 2.5) || S(2.9, 3.0) || S(10.45, 10.55));
  inp.addLook(S(4.8, 6.4) ? 250 * dt : 0, 0);
}
export function finish(game, report) { clearInterval(report.custom._iv); delete report.custom._iv; }
