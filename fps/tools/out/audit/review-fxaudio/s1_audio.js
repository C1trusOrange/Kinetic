// audio state / NaN / pause tests
export function setup(game, report) {
  report.custom = { log: [] };
}
const tests = {};
function safe(fn) {
  try { const r = fn(); return { ok: true, r: r === undefined ? null : (r && r.name) || String(r) }; }
  catch (e) { return { ok: false, err: String(e && e.message || e) }; }
}
export function drive(t, dt, game, report) {
  const c = report.custom, a = game.audio;
  if (!tests.info && t > 0.5) {
    tests.info = true;
    c.info = { enabled: a.enabled, ready: a.ready, state: a.ctx && a.ctx.state, stats: a.stats, buffers: a.buffers.size };
    // scan buffers for NaN / silence
    const bad = [], silent = [];
    for (const [name, list] of a.buffers) {
      for (const b of list) {
        for (let ch = 0; ch < b.numberOfChannels; ch++) {
          const d = b.getChannelData(ch);
          let nan = 0, pk = 0;
          for (let i = 0; i < d.length; i++) { const v = d[i]; if (!Number.isFinite(v)) nan++; else if (Math.abs(v) > pk) pk = Math.abs(v); }
          if (nan) bad.push(name + ':nan=' + nan);
          if (pk < 1e-4) silent.push(name);
        }
      }
    }
    c.badBuffers = bad; c.silent = silent;
  }
  if (!tests.nan && t > 1.0) {
    tests.nan = true;
    const P = { x: 3, y: 1, z: 3 };
    c.nan = {
      volumeNaN: safe(() => a.play('pistol_fire', { volume: NaN })),
      rateNaN: safe(() => a.play('footstep', { rate: NaN })),
      posNaN: safe(() => a.play('explosion', { position: { x: NaN, y: 0, z: 0 } })),
      posArray: safe(() => a.play('explosion', { position: [1, 2, 3] })),
      volInf: safe(() => a.play('pistol_fire', { volume: Infinity })),
      volNeg: safe(() => a.play('pickup_ammo', { volume: -1 })),
      unknown: safe(() => a.play('does_not_exist')),
    };
    const l = a.playLoop('slide', { volume: 0.5 });
    c.nan.loopSetVolNaN = safe(() => l.setVolume(NaN));
    c.nan.loopSetRateNaN = safe(() => l.setRate(NaN));
    c.nan.loopSetPosNaN = safe(() => l.setPosition({ x: NaN, y: 0, z: 0 }));
    c.nan.loopStartNaN = safe(() => a.playLoop('slide', { volume: NaN }));
    l.stop();
    c.loopsAfter = a.loops.size;
  }
  if (!tests.pause && t > 1.5) {
    tests.pause = true;
    const l = a.playLoop('grapple_reel', { volume: 0.45 });
    c.pause = { loopsBefore: a.loops.size, gainBefore: a.loopBus && a.loopBus.gain.value };
    game.pause();
    setTimeout(() => {
      c.pause.state = game.state;
      c.pause.loopsDuring = a.loops.size;
      c.pause.loopGainDuring = a.loopBus.gain.value;
      c.pause.muffleFreqDuring = a.muffle.frequency.value;
      c.pause._pauseMuffle = a._pauseMuffle;
      game.resume();
      c.pause.stateAfter = game.state;
      l.stop();
    }, 2500);
  }
}
