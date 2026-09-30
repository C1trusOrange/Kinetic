import sys, json
from common import *
SIM = r"""
(async () => {
  const A = __GAME__.audio;
  const SRt = 32000;
  const defs = {
    rifle_fire: { vol: 0.75, ref: 8, roll: 1 },
    explosion: { vol: 1.0, ref: 22, roll: 1 },
    hitmarker: { vol: 0.65, ref: 1, roll: 1 },
    footstep: { vol: 0.5, ref: 2.5, roll: 1 },
    hurt: { vol: 0.9, ref: 1, roll: 1 },
    shotgun_fire: { vol: 0.95, ref: 12, roll: 1 },
    kill_confirm: { vol: 0.75, ref: 1, roll: 1 },
    headshot: { vol: 0.75, ref: 1, roll: 1 },
    pistol_fire: { vol: 0.85, ref: 8, roll: 1 },
  };
  function att(n, d) { const D = defs[n]; return d == null ? 1 : D.ref / (D.ref + D.roll * Math.max(0, d - D.ref)); }
  async function render(events, dur, opts = {}) {
    const ctx = new OfflineAudioContext(2, Math.ceil(dur * SRt), SRt);
    const master = ctx.createGain(); master.gain.value = Math.pow(0.8, 1.5);
    let out = master;
    if (!opts.nocomp) {
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -16; comp.knee.value = 12; comp.ratio.value = 5; comp.attack.value = 0.002; comp.release.value = 0.14;
      master.connect(comp); comp.connect(ctx.destination);
    } else master.connect(ctx.destination);
    for (const e of events) {
      const list = A.buffers.get(e.n); const buf = list[(e.v || 0) % list.length];
      const src = ctx.createBufferSource(); src.buffer = buf;
      const g = ctx.createGain(); g.gain.value = defs[e.n].vol * (e.vol ?? 1) * att(e.n, e.d);
      src.connect(g); g.connect(master); src.start(e.t);
    }
    const r = await ctx.startRendering();
    return r;
  }
  function peakWin(r, t0, t1) { let p = 0; for (let c = 0; c < r.numberOfChannels; c++) { const d = r.getChannelData(c); for (let i = Math.floor(t0 * SRt); i < Math.min(d.length, Math.floor(t1 * SRt)); i++) { const v = Math.abs(d[i]); if (v > p) p = v; } } return p; }
  function rmsWin(r, t0, t1) { let s = 0, n = 0; for (let c = 0; c < r.numberOfChannels; c++) { const d = r.getChannelData(c); for (let i = Math.floor(t0 * SRt); i < Math.min(d.length, Math.floor(t1 * SRt)); i++) { s += d[i] * d[i]; n++; } } return Math.sqrt(s / Math.max(1, n)); }
  function clipPct(r) { let c = 0, n = 0; for (let ch = 0; ch < r.numberOfChannels; ch++) { const d = r.getChannelData(ch); for (let i = 0; i < d.length; i++) { n++; if (Math.abs(d[i]) > 1) c++; } } return 100 * c / n; }
  const db = x => +(20 * Math.log10(Math.max(1e-6, x))).toFixed(1);
  const out = {};
  // S1: player rifle full auto 11/s for 5 s, each shot with a hitmarker
  const ev1 = []; for (let i = 0; i < 55; i++) { ev1.push({ n: 'rifle_fire', t: 0.1 + i / 11, v: i }); if (i % 2 === 0) ev1.push({ n: 'hitmarker', t: 0.12 + i / 11, vol: 0.7 }); }
  const r1 = await render(ev1, 5.6);
  out.S1 = { rifleOnly_peak_dB: db(peakWin(r1, 0.1, 0.16)), rms_dB: db(rmsWin(r1, 0.5, 4.5)), peak_dB_all: db(peakWin(r1, 0, 5.6)), clip: clipPct(r1) };
  // S2: same + explosion at 10 m at t=2.0
  const ev2 = ev1.concat([{ n: 'explosion', t: 2.0, d: 10 }]);
  const r2 = await render(ev2, 5.6);
  // rifle shot peak (first 15 ms after onset), compared shot by shot
  const shotsAt = t => peakWin(r1, t, t + 0.02), shotsAt2 = t => peakWin(r2, t, t + 0.02);
  const duck = [];
  for (const t of [1.5, 2.3, 2.6, 3.0, 3.5, 4.0, 4.5, 5.0]) { const k = Math.round((t - 0.1) * 11); const tt = 0.1 + k / 11; duck.push({ t: +tt.toFixed(2), noExplosion_dB: db(shotsAt(tt)), withExplosion_dB: db(shotsAt2(tt)) }); }
  out.S2 = { duck, peak_dB_all: db(peakWin(r2, 0, 5.6)), clip: clipPct(r2), explosion_window_peak_dB: db(peakWin(r2, 2.0, 2.2)) };
  // S3: busy firefight: player rifle + 5 bots (rifle 12-35 m, random) + hurt hits + footsteps + explosion at 7 m
  let seed = 7; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
  const ev3 = ev1.slice();
  for (let b = 0; b < 5; b++) { const d = 12 + rnd() * 23; for (let i = 0; i < 40; i++) ev3.push({ n: 'rifle_fire', t: rnd() * 5, d, v: i }); }
  for (let i = 0; i < 6; i++) ev3.push({ n: 'hurt', t: 0.5 + i * 0.8, vol: 0.7 });
  ev3.push({ n: 'explosion', t: 2.0, d: 7 }); ev3.push({ n: 'explosion', t: 3.4, d: 15 });
  const r3 = await render(ev3, 5.6); const r3n = await render(ev3, 5.6, { nocomp: true });
  out.S3 = { compressed_peak_dB: db(peakWin(r3, 0, 5.6)), compressed_rms_dB: db(rmsWin(r3, 0, 5.6)), clip_with_comp: clipPct(r3), uncompressed_peak_dB: db(peakWin(r3n, 0, 5.6)), uncompressed_rms_dB: db(rmsWin(r3n, 0, 5.6)), clip_no_comp: clipPct(r3n) };
  // levels of individual feedback sounds through master (dBFS peak / rms100)
  const lv = {};
  for (const [n, vv] of [['hitmarker', 0.7], ['headshot', 0.85], ['kill_confirm', 0.9], ['hurt', 0.9], ['footstep', 1], ['rifle_fire', 1], ['pistol_fire', 1], ['shotgun_fire', 1], ['explosion', 1]]) {
    const rr = await render([{ n, t: 0.05, vol: vv }], 4, { nocomp: true });
    let best = 0; const w = Math.floor(0.1 * SRt); const d = rr.getChannelData(0);
    for (let i = 0; i + w < d.length; i += 320) { let s = 0; for (let j = 0; j < w; j += 2) s += d[i + j] * d[i + j]; best = Math.max(best, Math.sqrt(s / (w / 2))); }
    lv[n] = { peak_dB: db(peakWin(rr, 0, 4)), rms100_dB: db(best) };
  }
  out.levels = lv;
  return out;
})()
"""
s = Session(1280, 720)
s.goto('index.html', "window.__GAME__ && window.__GAME__.state === 'menu' && window.__GAME__.audio.ready", timeout=240)
res = s.run("return await " + SIM, timeout=180)
print(json.dumps(res, indent=1))
json.dump(res, open('x2_mix.json', 'w'), indent=1)
s.close()
