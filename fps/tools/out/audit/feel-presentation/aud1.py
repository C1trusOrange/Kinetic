import sys, json, re
from common import *
AN = r"""
(() => {
  const a = __GAME__.audio; const out = {};
  for (const [name, list] of a.buffers) {
    const b = list[0]; const n = b.length; const sr = b.sampleRate; const ch = b.numberOfChannels;
    let peak = 0, sum = 0, cnt = 0, first = -1, last = -1;
    const thr = 0.003;
    const data = []; for (let c = 0; c < ch; c++) data.push(b.getChannelData(c));
    // energy in 10 ms windows
    const win = Math.floor(sr * 0.01); const wr = [];
    for (let i = 0; i < n; i += win) {
      let s = 0, m = 0; const e = Math.min(n, i + win);
      for (let c = 0; c < ch; c++) for (let j = i; j < e; j++) { const v = data[c][j]; s += v * v; if (Math.abs(v) > peak) peak = Math.abs(v); }
      wr.push(Math.sqrt(s / ((e - i) * ch)));
    }
    let tot = 0; for (const r of wr) tot += r * r;
    // active windows: rms > -50 dBFS
    let act = 0, actN = 0; wr.forEach((r, i) => { if (r > 0.0032) { act += r * r; actN++; if (first < 0) first = i; last = i; } });
    // loudest 100ms sliding rms
    let best = 0; for (let i = 0; i + 10 <= wr.length; i++) { let s = 0; for (let k = 0; k < 10; k++) s += wr[i + k] ** 2; best = Math.max(best, Math.sqrt(s / 10)); }
    out[name] = { dur: +(n / sr).toFixed(2), ch, peak: +peak.toFixed(3), rmsActive: +(Math.sqrt(act / Math.max(1, actN))).toFixed(4), rms100: +best.toFixed(4), active_s: +(actN * 0.01).toFixed(2) };
  }
  return out;
})()
"""
s = Session(1280, 720)
s.goto('index.html', "window.__GAME__ && window.__GAME__.state === 'menu' && window.__GAME__.audio.ready", timeout=240)
res = s.js(AN)
json.dump(res, open('audio_stats.json', 'w'), indent=1)
print(len(res), 'sounds; audio.enabled=', s.js('__GAME__.audio.enabled'), s.js('__GAME__.audio.stats'))
s.close()
