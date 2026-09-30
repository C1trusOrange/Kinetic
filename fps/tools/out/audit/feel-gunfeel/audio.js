// Loudness / spectrum stats for the weapon + feedback sounds (reads the pre-rendered AudioBuffers).
const VOL = { pistol_fire: 0.85, rifle_fire: 0.75, shotgun_fire: 0.95, sniper_fire: 1.0, rocket_fire: 0.95, dry_fire: 0.6,
  reload_start: 0.65, reload_insert: 0.7, reload_end: 0.7, pump: 0.8, bolt: 0.8, weapon_switch: 0.6, melee_swing: 0.7, melee_hit: 0.9,
  grenade_pin: 0.7, grenade_throw: 0.75, explosion: 1.0, impact_metal: 0.6, impact_concrete: 0.6, impact_robot: 0.75, hitmarker: 0.65, headshot: 0.75,
  kill_confirm: 0.75, hurt: 0.9, footstep: 0.5, jump: 0.55, land: 0.6, pickup_ammo: 0.75, ui_click: 0.55 };
const NAMES = Object.keys(VOL);

function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2 * Math.PI / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ur = re[i + k], ui = im[i + k];
        const vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci;
        const vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k] = ur + vr; im[i + k] = ui + vi;
        re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi;
        const nr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = nr;
      }
    }
  }
}

export async function setup(game, report) {
  const R = report.custom = {};
  const audio = game.audio;
  R.ready = audio.ready; R.enabled = audio.enabled; R.stats = audio.stats;
  const out = {};
  const db = v => (v > 1e-9 ? +(20 * Math.log10(v)).toFixed(1) : -99);
  for (const name of NAMES) {
    const bufs = audio.getBuffers(name);
    if (!bufs.length) { out[name] = null; continue; }
    let peak = 0, rms100 = 0, rmsAll = 0, cent = 0, low = 0, mid = 0, high = 0, dur = 0;
    for (const b of bufs) {
      const sr = b.sampleRate;
      const d = b.getChannelData(0);
      const n100 = Math.min(d.length, Math.floor(0.1 * sr));
      let s100 = 0, sAll = 0, pk = 0;
      for (let i = 0; i < d.length; i++) { const v = Math.abs(d[i]); if (v > pk) pk = v; sAll += d[i] * d[i]; if (i < n100) s100 += d[i] * d[i]; }
      peak = Math.max(peak, pk); rms100 += Math.sqrt(s100 / n100); rmsAll += Math.sqrt(sAll / d.length);
      // find last sample above -50 dB to estimate audible length
      let last = 0; for (let i = d.length - 1; i >= 0; i--) if (Math.abs(d[i]) > 0.003) { last = i; break; }
      dur += last / sr;
      const N = 4096, re = new Float32Array(N), im = new Float32Array(N);
      for (let i = 0; i < N && i < d.length; i++) re[i] = d[i] * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / (N - 1)));
      fft(re, im);
      let sw = 0, sm = 0, e1 = 0, e2 = 0, e3 = 0;
      for (let k = 1; k < N / 2; k++) {
        const f = k * sr / N, m = re[k] * re[k] + im[k] * im[k];
        sw += m; sm += m * f;
        if (f < 400) e1 += m; else if (f < 3000) e2 += m; else e3 += m;
      }
      cent += sm / Math.max(1e-12, sw); low += e1 / Math.max(1e-12, sw); mid += e2 / Math.max(1e-12, sw); high += e3 / Math.max(1e-12, sw);
    }
    const k = bufs.length;
    out[name] = { variants: k, peakDb: db(peak * VOL[name]), rms100msDb: db(rms100 / k * VOL[name]), rmsAllDb: db(rmsAll / k * VOL[name]),
      centroidHz: Math.round(cent / k), lowPct: Math.round(100 * low / k), midPct: Math.round(100 * mid / k), highPct: Math.round(100 * high / k), audibleS: +(dur / k).toFixed(2) };
  }
  R.sounds = out;
  game.autotest.duration = 0.5;
}
export function drive() {}
export function finish() {}
