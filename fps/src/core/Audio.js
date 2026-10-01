import * as THREE from 'three';
import { mulberry32 } from './utils.js';

/**
 * KINETIC audio: every sound is synthesised with WebAudio nodes and pre-rendered into AudioBuffers
 * at init() using OfflineAudioContext (2-4 variations per sound). Playback is plain BufferSource
 * voices (optionally spatialised with a PannerNode) through a master compressor.
 *
 * The system degrades to a silent no-op when WebAudio is unavailable or the context has not been
 * unlocked by a user gesture yet (headless tests never log errors because of it).
 *
 * Music is the exception to synthesis: the tracks in music/ (MUSIC_TRACKS) are fetched, decoded and played through
 * their own gain (music volume x master volume), bypassing the effects compressor (playMusic / stopMusic).
 */

const SR = 32000;
const MAX_VOICES = 32;
const NOISE_LEN = SR * 2;

/**
 * Music tracks (the one exception to "every sound is synthesised"): files in music/, fetched and decoded on first use.
 * menu loops on the main menu; victory / defeat play once at the end of a match.
 */
const MUSIC_TRACKS = {
  menu: 'music/kinetic_menu.ogg',
  victory: 'music/kinetic_victory.ogg',
  defeat: 'music/kinetic_defeat.ogg',
};

// ================================================================== shared DSP data

let _noiseData = null;
/** Lazily generated noise tables (RMS-normalised to ~0.3 so gains are comparable across colours). */
function getNoiseData() {
  if (_noiseData) return _noiseData;
  const rnd = mulberry32(0x5eed1234);
  const white = new Float32Array(NOISE_LEN);
  const pink = new Float32Array(NOISE_LEN);
  const brown = new Float32Array(NOISE_LEN);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, last = 0;
  for (let i = 0; i < NOISE_LEN; i++) {
    const w = rnd() * 2 - 1;
    white[i] = w;
    b0 = 0.99886 * b0 + w * 0.0555179;
    b1 = 0.99332 * b1 + w * 0.0750759;
    b2 = 0.96900 * b2 + w * 0.1538520;
    b3 = 0.86650 * b3 + w * 0.3104856;
    b4 = 0.55000 * b4 + w * 0.5329522;
    b5 = -0.7616 * b5 - w * 0.0168980;
    pink[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362;
    b6 = w * 0.115926;
    last = (last + 0.02 * w) / 1.02;
    brown[i] = last;
  }
  for (const arr of [white, pink, brown]) {
    let mean = 0;
    for (let i = 0; i < NOISE_LEN; i++) mean += arr[i];
    mean /= NOISE_LEN;
    let e = 0;
    for (let i = 0; i < NOISE_LEN; i++) { arr[i] -= mean; e += arr[i] * arr[i]; }
    const k = 0.3 / Math.sqrt(e / NOISE_LEN);
    for (let i = 0; i < NOISE_LEN; i++) arr[i] *= k;
  }
  _noiseData = { white, pink, brown };
  return _noiseData;
}

const _irCache = new Map();
/** Synthetic room/outdoor impulse responses: [left, right] Float32Arrays. */
function getIR(kind) {
  let ir = _irCache.get(kind);
  if (ir) return ir;
  const cfg = {
    small: { len: 0.45, pre: 0.004, hf: 0.7 },
    med: { len: 0.95, pre: 0.008, hf: 0.55 },
    large: { len: 1.9, pre: 0.014, hf: 0.4 },
  }[kind] || { len: 0.8, pre: 0.006, hf: 0.6 };
  const n = Math.floor(cfg.len * SR);
  const rnd = mulberry32(0x1234abcd + n);
  ir = [new Float32Array(n), new Float32Array(n)];
  for (let c = 0; c < 2; c++) {
    const d = ir[c];
    let y = 0;
    const p0 = Math.floor(cfg.pre * SR);
    for (let i = p0; i < n; i++) {
      const t = (i - p0) / (n - p0);
      // one-pole low-pass whose cutoff falls over time (high frequencies die first)
      const a = 0.85 * Math.pow(1 - t, 1.5) * cfg.hf + 0.04;
      y += a * ((rnd() * 2 - 1) - y);
      d[i] = y * Math.exp(-6.9 * t) * (i - p0 < 300 ? (i - p0) / 300 : 1);
    }
    // sparse early reflections
    for (let k = 0; k < 9; k++) {
      const at = p0 + Math.floor((0.004 + rnd() * 0.055) * SR * (cfg.len > 1 ? 1.6 : 1));
      if (at < n) d[at] += (rnd() < 0.5 ? -1 : 1) * (0.9 - k * 0.06);
    }
  }
  _irCache.set(kind, ir);
  return ir;
}

const _curveCache = new Map();
/** tanh soft-clip curve normalised to +/-1 (k = drive amount). */
function tanhCurve(k) {
  const key = Math.round(k * 100);
  let c = _curveCache.get(key);
  if (c) return c;
  const n = 1024;
  c = new Float32Array(n);
  const norm = Math.tanh(k);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    c[i] = Math.tanh(k * x) / norm;
  }
  _curveCache.set(key, c);
  return c;
}

const NOISE_TYPES = { white: 1, pink: 1, brown: 1 };
const OSC_TYPES = { sine: 'sine', triangle: 'triangle', saw: 'sawtooth', square: 'square' };

// ================================================================== offline synth helper

/**
 * Small voice-builder over an OfflineAudioContext. One instance renders one buffer.
 * Voice options (all times in seconds from the start of the buffer):
 *   src 'white'|'pink'|'brown'|'sine'|'triangle'|'saw'|'square', t (start), a (attack), hold, d (decay time constant),
 *   g (peak gain), sus (sustain instead of decaying), dur (explicit length),
 *   f0/f1/sw (oscillator sweep), filt [{type,f0,f1,sw,q}], drive (tanh drive), fm {f, depth}, am {rate, depth, type},
 *   pan, send (reverb send level).
 */
class Synth {
  constructor(ctx, rnd, def) {
    this.ctx = ctx;
    this.r = rnd;
    this.def = def;
    /** Time offset (s) of the variation currently being built (variations share one context). */
    this.base = 0;
    /** Hard stop time for voices of the current variation. */
    this.limit = Infinity;
    this.noise = {};
    this._rev = null;
    this.dry = ctx.createGain();
    if (def.clip) {
      this.dry.gain.value = 0.5;
      const sat = ctx.createWaveShaper();
      sat.curve = tanhCurve(def.clip);
      sat.oversample = '2x';
      this.dry.connect(sat);
      sat.connect(ctx.destination);
    } else {
      this.dry.connect(ctx.destination);
    }
  }

  noiseBuffer(color) {
    let b = this.noise[color];
    if (!b) {
      b = this.ctx.createBuffer(1, NOISE_LEN, SR);
      b.copyToChannel(getNoiseData()[color], 0);
      this.noise[color] = b;
    }
    return b;
  }

  reverbIn() {
    if (this._rev) return this._rev;
    const ctx = this.ctx;
    const ir = getIR(this.def.rev || 'med');
    const buf = ctx.createBuffer(2, ir[0].length, SR);
    buf.copyToChannel(ir[0], 0);
    buf.copyToChannel(ir[1], 1);
    const cv = ctx.createConvolver();
    cv.normalize = true;
    cv.buffer = buf;
    const inG = ctx.createGain();
    const wet = ctx.createGain();
    wet.gain.value = this.def.wet ?? 0.7;
    inG.connect(cv);
    cv.connect(wet);
    wet.connect(ctx.destination);
    this._rev = inG;
    return inG;
  }

  /** Build one synthesised voice; returns { src, out }. */
  voice(o) {
    const ctx = this.ctx;
    const t = (o.t || 0) + this.base;
    const a = o.a ?? 0.001;
    const hold = o.hold || 0;
    const d = o.d ?? 0.1;
    const g = o.g ?? 1;
    const dur = Math.min(o.dur ?? (o.sus ? this.def.dur + this.def.xf + 0.02 : a + hold + d * 6), this.limit - t - 0.03);
    const sw = o.sw ?? dur;
    let src;
    if (NOISE_TYPES[o.src]) {
      src = ctx.createBufferSource();
      const nb = this.noiseBuffer(o.src);
      src.buffer = nb;
      src.loop = true;
      src.start(t, this.r() * (nb.duration - 0.2));
      src.stop(t + dur + 0.02);
    } else {
      src = ctx.createOscillator();
      src.type = OSC_TYPES[o.src] || 'sine';
      const f0 = o.f0 || 440;
      src.frequency.setValueAtTime(f0, t);
      if (o.f1 && o.f1 !== f0) src.frequency.exponentialRampToValueAtTime(o.f1, t + sw);
      if (o.fm) {
        const mod = ctx.createOscillator();
        mod.frequency.value = o.fm.f;
        const mg = ctx.createGain();
        mg.gain.value = o.fm.depth;
        mod.connect(mg);
        mg.connect(src.frequency);
        mod.start(t);
        mod.stop(t + dur + 0.02);
      }
      src.start(t);
      src.stop(t + dur + 0.02);
    }
    let node = src;
    if (o.filt) {
      for (const f of o.filt) {
        const bq = ctx.createBiquadFilter();
        bq.type = f.type;
        bq.Q.value = f.q ?? 0.7;
        bq.frequency.setValueAtTime(f.f0, t);
        if (f.f1 && f.f1 !== f.f0) bq.frequency.exponentialRampToValueAtTime(f.f1, t + (f.sw ?? sw));
        node.connect(bq);
        node = bq;
      }
    }
    // amplitude envelope
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(g, t + a);
    if (!o.sus) {
      if (hold) env.gain.setValueAtTime(g, t + a + hold);
      env.gain.setTargetAtTime(0, t + a + hold, d);
    }
    node.connect(env);
    node = env;
    if (o.am) {
      const am = ctx.createGain();
      const depth = o.am.depth ?? 0.5;
      am.gain.value = 1 - depth * 0.5;
      const lfo = ctx.createOscillator();
      lfo.type = o.am.type || 'sine';
      lfo.frequency.value = o.am.rate;
      const lg = ctx.createGain();
      lg.gain.value = depth * 0.5;
      lfo.connect(lg);
      lg.connect(am.gain);
      lfo.start(t);
      lfo.stop(t + dur + 0.02);
      node.connect(am);
      node = am;
    }
    if (o.drive) {
      const ws = ctx.createWaveShaper();
      ws.curve = tanhCurve(o.drive);
      node.connect(ws);
      node = ws;
    }
    if (o.pan) {
      const p = ctx.createStereoPanner();
      p.pan.value = o.pan;
      node.connect(p);
      node = p;
    }
    node.connect(this.dry);
    if (o.send) {
      const sg = ctx.createGain();
      sg.gain.value = o.send;
      node.connect(sg);
      sg.connect(this.reverbIn());
    }
    return { src, out: node };
  }

  /** Inharmonic metallic ring: sum of decaying sine partials. */
  ring(o) {
    const ratios = o.ratios || [1, 2.76, 5.4, 8.93];
    for (let i = 0; i < ratios.length; i++) {
      this.voice({
        src: 'sine', f0: o.f * ratios[i], t: o.t || 0, a: 0.0006,
        d: (o.d ?? 0.1) / (1 + i * 0.75), g: (o.g ?? 1) / (1 + i * 0.55), send: o.send, pan: o.pan,
      });
    }
  }

  /** Short noise click through a band-pass. */
  click(t, f, g, d = 0.006, q = 1.2, extra = null) {
    this.voice({ src: 'white', t, a: 0.0004, d, g, filt: [{ type: 'bandpass', f0: f, q }], ...extra });
  }

  /** Sine thump with a falling pitch. */
  thump(t, f0, f1, sw, d, g, extra = null) {
    this.voice({ src: 'sine', t, f0, f1, sw, a: 0.001, d, g: g * 0.6, ...extra });
  }

  /** Musical note: sine + soft octave. */
  note(t, f, g, d, extra = null) {
    this.voice({ src: 'sine', t, f0: f, a: 0.004, d, g, ...extra });
    this.voice({ src: 'sine', t, f0: f * 2.005, a: 0.004, d: d * 0.6, g: g * 0.22, ...extra });
  }

  /** Scatter n short filtered clicks over [t0, t1] (debris, sparks, shards). */
  crackles(t0, t1, n, fLo, fHi, gLo, gHi, opts = {}) {
    const r = this.r;
    for (let i = 0; i < n; i++) {
      const u = Math.pow(r(), opts.bias ?? 1.6);
      const t = t0 + (t1 - t0) * u;
      const f = fLo * Math.pow(fHi / fLo, r());
      const g = (gLo + (gHi - gLo) * r()) * (opts.decay ? 1 - u * opts.decay : 1);
      this.voice({
        src: 'white', t, a: 0.0004, d: 0.003 + r() * 0.008, g,
        filt: [{ type: 'bandpass', f0: f, q: opts.q ?? 2 }], pan: opts.wide ? (r() * 2 - 1) * opts.wide : 0,
        send: opts.send,
      });
    }
  }
}

// ================================================================== sound definitions

const SOUNDS = {};

/**
 * Register a sound. Options: variants, stereo, level (peak after normalisation), vol (playback gain),
 * ref/max (metres: 3D reference distance / audibility cut-off), roll (rolloff), prio, cd (min seconds
 * between plays), maxInst, clip (master soft-clip drive), rev ('small'|'med'|'large'), wet, loop, xf, pitchVar.
 */
function def(name, dur, o, build) {
  SOUNDS[name] = {
    name, dur, build, variants: 3, stereo: false, level: 0.9, vol: 1, ref: 4, max: 90, roll: 1, prio: 5,
    cd: 0, maxInst: 8, clip: 0, rev: 'med', wet: 0.7, loop: false, xf: 0.14, pitchVar: 0.06, ...o,
  };
}

const jit = (r, amt) => 1 + (r() * 2 - 1) * amt;

// ---------------------------------------------------------------- weapons

def('pistol_fire', 0.8, { stereo: true, vol: 0.85, ref: 8, max: 180, prio: 8, clip: 1.8, rev: 'small', pitchVar: 0.04, maxInst: 6 }, (s, r) => {
  const j = jit(r, 0.06);
  s.voice({ src: 'white', a: 0.0004, d: 0.003, g: 1, filt: [{ type: 'highpass', f0: 1800 * j }], drive: 2 });
  s.voice({ src: 'white', a: 0.0008, d: 0.018, g: 0.9, filt: [{ type: 'bandpass', f0: 3200 * j, f1: 900, sw: 0.05, q: 0.9 }], drive: 2.5, send: 0.3 });
  s.voice({ src: 'pink', t: 0.001, a: 0.001, d: 0.05, g: 1, filt: [{ type: 'lowpass', f0: 7000 * j, f1: 500, sw: 0.14 }], drive: 3, send: 0.25 });
  s.thump(0, 190 * j, 58, 0.11, 0.07, 1.3, { drive: 1.5 });
  s.voice({ src: 'triangle', f0: 380 * j, f1: 110, sw: 0.08, a: 0.001, d: 0.03, g: 0.5 });
  s.voice({ src: 'pink', t: 0.02, a: 0.004, d: 0.16, g: 0.3, filt: [{ type: 'lowpass', f0: 3500, f1: 350, sw: 0.5 }], send: 0.9 });
  s.click(0.045, 2600, 0.15, 0.004, 2);
});

def('rifle_fire', 0.55, { stereo: true, vol: 0.75, ref: 8, max: 190, prio: 7, clip: 1.9, rev: 'small', variants: 4, pitchVar: 0.05, maxInst: 8 }, (s, r) => {
  const j = jit(r, 0.07);
  s.voice({ src: 'white', a: 0.0004, d: 0.0035, g: 1, filt: [{ type: 'highpass', f0: 2000 * j }], drive: 2 });
  s.voice({ src: 'pink', t: 0.0005, a: 0.001, d: 0.035, g: 1, filt: [{ type: 'lowpass', f0: 6500 * j, f1: 600, sw: 0.09 }], drive: 3, send: 0.2 });
  // synthetic "pulse" zap gives the AR-7 its sci-fi edge
  s.voice({ src: 'saw', f0: 3000 * j, f1: 340, sw: 0.055, a: 0.001, d: 0.025, g: 0.3, filt: [{ type: 'lowpass', f0: 5200, q: 1 }] });
  s.thump(0, 150 * j, 50, 0.07, 0.05, 1.25, { drive: 1.4 });
  s.click(0, 1200 * j, 0.6, 0.03, 1);
  s.voice({ src: 'pink', t: 0.01, a: 0.003, d: 0.09, g: 0.25, filt: [{ type: 'lowpass', f0: 3000, f1: 400, sw: 0.25 }], send: 0.6 });
  s.click(0.036, 2500, 0.22, 0.005, 2);
});

def('shotgun_fire', 1.6, { variants: 2, stereo: true, vol: 0.95, ref: 12, max: 240, prio: 8, clip: 2.2, rev: 'med', pitchVar: 0.04, maxInst: 4 }, (s, r) => {
  const j = jit(r, 0.05);
  s.voice({ src: 'white', a: 0.0004, d: 0.006, g: 1, filt: [{ type: 'highpass', f0: 1200 * j }], drive: 2.5 });
  s.voice({ src: 'white', a: 0.001, d: 0.06, g: 1.2, filt: [{ type: 'lowpass', f0: 8000, f1: 350, sw: 0.25 }], drive: 4, send: 0.35 });
  s.thump(0, 120 * j, 38, 0.2, 0.14, 1.5, { drive: 2 });
  s.voice({ src: 'triangle', f0: 240 * j, f1: 80, sw: 0.1, a: 0.001, d: 0.06, g: 0.5 });
  s.voice({ src: 'white', a: 0.002, d: 0.05, g: 0.9, filt: [{ type: 'bandpass', f0: 700, q: 0.7 }], drive: 2 });
  s.crackles(0.02, 0.16, 7, 2500, 6000, 0.12, 0.3);
  s.voice({ src: 'pink', t: 0.02, a: 0.006, d: 0.3, g: 0.5, filt: [{ type: 'lowpass', f0: 2000, f1: 200, sw: 0.9 }], send: 0.9 });
  s.voice({ src: 'brown', t: 0.03, a: 0.01, d: 0.35, g: 0.5, filt: [{ type: 'lowpass', f0: 380, f1: 90, sw: 0.9 }], send: 0.5 });
});

def('sniper_fire', 2.6, { variants: 2, stereo: true, vol: 1, ref: 20, max: 420, prio: 8, clip: 2, rev: 'large', pitchVar: 0.03, maxInst: 3, wet: 0.8 }, (s, r) => {
  const j = jit(r, 0.04);
  s.voice({ src: 'white', a: 0.0003, d: 0.004, g: 1.2, filt: [{ type: 'highpass', f0: 2500 }], drive: 3 });
  s.voice({ src: 'white', a: 0.0004, d: 0.01, g: 0.8, filt: [{ type: 'bandpass', f0: 5200, q: 0.8 }] });
  s.thump(0, 95 * j, 32, 0.3, 0.2, 1.5, { drive: 2 });
  s.voice({ src: 'pink', a: 0.001, d: 0.09, g: 1.1, filt: [{ type: 'lowpass', f0: 6000, f1: 300, sw: 0.35 }], drive: 3, send: 0.4 });
  s.voice({ src: 'sine', f0: 1180 * j, a: 0.002, d: 0.4, g: 0.06, send: 0.6 });
  s.voice({ src: 'sine', f0: 1207 * j, a: 0.002, d: 0.35, g: 0.05, send: 0.6 });
  s.voice({ src: 'pink', t: 0.03, a: 0.01, d: 0.55, g: 0.5, filt: [{ type: 'lowpass', f0: 1800, f1: 200, sw: 1.5 }], send: 1 });
  // distant echoes
  s.voice({ src: 'pink', t: 0.27, a: 0.003, d: 0.06, g: 0.28, filt: [{ type: 'lowpass', f0: 2600, f1: 500, sw: 0.2 }], send: 0.7, pan: -0.3 });
  s.voice({ src: 'pink', t: 0.58, a: 0.004, d: 0.08, g: 0.15, filt: [{ type: 'lowpass', f0: 1800, f1: 400, sw: 0.25 }], send: 0.7, pan: 0.3 });
});

// ---- Tempest (arc) and Gale (gale)

def('arc_start', 0.3, { variants: 2, stereo: true, vol: 0.75, ref: 8, max: 130, prio: 7, clip: 1.6, rev: 'small', pitchVar: 0.04, maxInst: 3 }, (s, r) => {
  const j = jit(r, 0.05);
  s.voice({ src: 'white', a: 0.0004, d: 0.004, g: 1, filt: [{ type: 'highpass', f0: 2500 }], drive: 2.5 });
  s.thump(0, 150 * j, 60, 0.1, 0.06, 1.1, { drive: 1.4 });
  s.voice({ src: 'saw', f0: 380 * j, f1: 2600 * j, sw: 0.16, a: 0.006, d: 0.07, g: 0.4, filt: [{ type: 'lowpass', f0: 5200, q: 1 }], drive: 1.5, send: 0.2 });
  s.voice({ src: 'square', f0: 90 * j, a: 0.003, d: 0.08, g: 0.22, am: { rate: 55, depth: 0.8 } });
  s.crackles(0, 0.17, 9, 2500, 7000, 0.15, 0.4, { wide: 0.5 });
});

// seamless beam loop: 100 Hz buzz with a fast tremolo, a crackle bed and a faint whine
def('arc_loop', 0.6, { loop: true, vol: 0.5, ref: 6, max: 70, prio: 4, rev: 'small', variants: 1 }, (s) => {
  s.voice({ src: 'saw', f0: 100, sus: true, a: 0.01, g: 0.5, filt: [{ type: 'lowpass', f0: 1800, q: 0.7 }], am: { rate: 50, depth: 0.7 }, drive: 1.5 });
  s.voice({ src: 'saw', f0: 200, sus: true, a: 0.01, g: 0.16, filt: [{ type: 'lowpass', f0: 2600 }], am: { rate: 50, depth: 0.5 } });
  s.voice({ src: 'white', sus: true, a: 0.01, g: 0.42, filt: [{ type: 'bandpass', f0: 4200, q: 0.8 }], am: { rate: 60, depth: 0.9 } });
  s.voice({ src: 'sine', f0: 2400, sus: true, a: 0.01, g: 0.05 });
  s.crackles(0, 0.7, 26, 3000, 6500, 0.1, 0.3, { wide: 0.6 });
});

def('arc_end', 0.25, { variants: 2, vol: 0.5, ref: 6, max: 70, prio: 5, rev: 'small', cd: 0.05 }, (s, r) => {
  const j = jit(r, 0.06);
  s.voice({ src: 'white', a: 0.002, d: 0.06, g: 0.5, filt: [{ type: 'bandpass', f0: 5000 * j, f1: 1200, sw: 0.15, q: 0.8 }] });
  s.voice({ src: 'saw', f0: 500 * j, f1: 90, sw: 0.12, a: 0.002, d: 0.05, g: 0.3, filt: [{ type: 'lowpass', f0: 1500 }] });
  s.click(0.012, 1800, 0.35, 0.01, 1.2);
});

// chain-arc / impact crackle (short, throttled, at most 4 voices)
def('arc_zap', 0.22, { variants: 3, vol: 0.55, ref: 5, max: 60, prio: 3, cd: 0.05, maxInst: 4, rev: 'small', wet: 0.3 }, (s, r) => {
  const j = jit(r, 0.1);
  s.crackles(0, 0.1, 6, 2000, 7000, 0.2, 0.6);
  s.voice({ src: 'saw', f0: 1800 * j, f1: 300, sw: 0.08, a: 0.001, d: 0.03, g: 0.28, filt: [{ type: 'highpass', f0: 600 }] });
});

// bots start a burst with this one-shot (cd 0.3 s so seven bots cannot exhaust the voice pool with loops)
def('arc_burst', 0.4, { variants: 2, stereo: true, vol: 0.65, ref: 8, max: 110, prio: 6, cd: 0.3, maxInst: 3, rev: 'small' }, (s, r) => {
  const j = jit(r, 0.06);
  s.voice({ src: 'white', a: 0.0005, d: 0.006, g: 0.8, filt: [{ type: 'highpass', f0: 2200 }], drive: 2 });
  s.voice({ src: 'saw', f0: 160 * j, a: 0.004, d: 0.1, g: 0.3, filt: [{ type: 'lowpass', f0: 1800 }], am: { rate: 50, depth: 0.8 } });
  s.crackles(0, 0.26, 14, 2500, 6500, 0.15, 0.42, { wide: 0.6, decay: 0.5 });
  s.voice({ src: 'saw', f0: 500 * j, f1: 2200, sw: 0.1, a: 0.002, d: 0.04, g: 0.2, filt: [{ type: 'lowpass', f0: 5000 }] });
});

def('gale_fire', 0.9, { variants: 2, stereo: true, vol: 0.95, ref: 12, max: 200, prio: 8, clip: 1.8, rev: 'med', pitchVar: 0.04, maxInst: 3 }, (s, r) => {
  const j = jit(r, 0.05);
  s.thump(0, 45 * j, 28, 0.25, 0.12, 1.7, { drive: 1.5 });
  s.voice({ src: 'white', a: 0.003, d: 0.06, g: 1.1, filt: [{ type: 'bandpass', f0: 3500, f1: 400, sw: 0.18, q: 0.9 }], drive: 2, send: 0.3 });
  s.voice({ src: 'pink', t: 0.02, a: 0.06, d: 0.2, g: 0.6, filt: [{ type: 'bandpass', f0: 700, f1: 2400, sw: 0.3, q: 0.6 }], send: 0.5 });
  s.voice({ src: 'white', t: 0.05, a: 0.1, d: 0.22, g: 0.22, filt: [{ type: 'highpass', f0: 2500 }] });
  s.voice({ src: 'brown', t: 0.02, a: 0.01, d: 0.3, g: 0.6, filt: [{ type: 'lowpass', f0: 300, f1: 100, sw: 0.5 }], send: 0.6 });
  s.click(0, 1500, 0.5, 0.01);
});

def('gale_reflect', 0.5, { variants: 2, stereo: true, vol: 0.85, ref: 8, max: 120, prio: 8, cd: 0.1, maxInst: 3, rev: 'small', wet: 0.5 }, (s, r) => {
  const j = jit(r, 0.05);
  s.ring({ f: 1800 * j, ratios: [1, 2.76, 5.4], d: 0.16, g: 0.7, send: 0.4 });
  s.voice({ src: 'saw', f0: 600, f1: 2400, sw: 0.18, a: 0.004, d: 0.1, g: 0.32, filt: [{ type: 'lowpass', f0: 4500 }], send: 0.3 });
  s.click(0, 3000, 0.6, 0.008);
});

def('splat', 0.35, { variants: 2, vol: 0.9, ref: 6, max: 90, prio: 8, cd: 0.08, rev: 'small', wet: 0.35 }, (s, r) => {
  const j = jit(r, 0.06);
  s.thump(0, 130 * j, 60, 0.1, 0.09, 1.5, { drive: 1.5 });
  s.voice({ src: 'brown', a: 0.002, d: 0.06, g: 0.9, filt: [{ type: 'lowpass', f0: 700, f1: 200, sw: 0.1 }], drive: 2 });
  s.click(0.002, 1400, 0.6, 0.012, 1);
});

// local-player stinger for a ring-out: rising whoosh, then a low ding
def('ringout', 0.8, { stereo: true, vol: 0.8, prio: 9, ref: 1, max: 9999, rev: 'med', wet: 0.5, variants: 1 }, (s) => {
  s.voice({ src: 'white', a: 0.2, d: 0.08, g: 0.3, filt: [{ type: 'bandpass', f0: 300, f1: 2800, sw: 0.28, q: 0.9 }], send: 0.3 });
  s.note(0.28, 196, 0.5, 0.35, { send: 0.6 });
  s.note(0.28, 392, 0.14, 0.25, { send: 0.6 });
});

def('rocket_fire', 1.8, { variants: 2, stereo: true, vol: 0.95, ref: 14, max: 260, prio: 8, clip: 1.8, rev: 'med', pitchVar: 0.04, maxInst: 3 }, (s, r) => {
  const j = jit(r, 0.05);
  s.thump(0, 110 * j, 38, 0.22, 0.16, 1.4, { drive: 2 });
  s.voice({ src: 'white', a: 0.001, d: 0.006, g: 0.8, filt: [{ type: 'highpass', f0: 1500 }] });
  s.voice({ src: 'pink', a: 0.002, d: 0.16, g: 1, filt: [{ type: 'lowpass', f0: 3000, f1: 300, sw: 0.5 }], drive: 3, send: 0.4 });
  // ignition whoosh
  s.voice({ src: 'white', t: 0.02, a: 0.09, d: 0.28, g: 0.6, filt: [{ type: 'bandpass', f0: 400, f1: 2600, sw: 0.5, q: 0.8 }], send: 0.3 });
  s.voice({ src: 'white', t: 0.04, a: 0.06, d: 0.4, g: 0.22, filt: [{ type: 'highpass', f0: 3000 }] });
  s.voice({ src: 'brown', t: 0.03, a: 0.02, d: 0.4, g: 0.6, filt: [{ type: 'lowpass', f0: 600, f1: 150, sw: 1 }], send: 0.6 });
  s.click(0.16, 900, 0.4, 0.02, 1.5);
});

// ---- Slipstream (smg) + Javelin (rail): played with a rate that follows the speed bonus / the charge
def('smg_fire', 0.35, { variants: 4, stereo: true, vol: 0.7, ref: 8, max: 170, prio: 7, clip: 1.8, rev: 'small', pitchVar: 0.05, maxInst: 8 }, (s, r) => {
  const j = jit(r, 0.07);
  s.voice({ src: 'white', a: 0.0003, d: 0.003, g: 1, filt: [{ type: 'highpass', f0: 2200 * j }], drive: 2 });
  s.voice({ src: 'pink', t: 0.0005, a: 0.001, d: 0.025, g: 1, filt: [{ type: 'lowpass', f0: 7000 * j, f1: 700, sw: 0.05 }], drive: 3, send: 0.2 });
  s.thump(0, 170 * j, 60, 0.05, 0.04, 1.1, { drive: 1.4 });
  s.voice({ src: 'pink', t: 0.008, a: 0.003, d: 0.07, g: 0.2, filt: [{ type: 'lowpass', f0: 2600, f1: 350, sw: 0.2 }], send: 0.5 });
  s.click(0.03, 3400, 0.2, 0.004, 2);
});

def('rail_fire', 1.7, { variants: 2, stereo: true, vol: 1, ref: 20, max: 420, prio: 9, clip: 2, rev: 'large', pitchVar: 0.03, maxInst: 3, wet: 0.8 }, (s, r) => {
  const j = jit(r, 0.04);
  s.voice({ src: 'white', a: 0.0003, d: 0.004, g: 1.1, filt: [{ type: 'highpass', f0: 2600 }], drive: 3 });
  s.voice({ src: 'saw', f0: 6000 * j, f1: 300, sw: 0.25, a: 0.001, d: 0.1, g: 0.4, filt: [{ type: 'lowpass', f0: 7000, f1: 900, sw: 0.25, q: 1.4 }], send: 0.4 });
  s.voice({ src: 'sine', f0: 4000 * j, f1: 450, sw: 0.22, a: 0.001, d: 0.09, g: 0.3, send: 0.5 });
  s.thump(0, 68 * j, 28, 0.4, 0.3, 1.5, { drive: 2 });
  s.voice({ src: 'white', t: 0.003, a: 0.001, d: 0.05, g: 0.9, filt: [{ type: 'bandpass', f0: 3800, q: 0.7 }], drive: 3 });
  s.voice({ src: 'pink', t: 0.02, a: 0.006, d: 0.45, g: 0.55, filt: [{ type: 'lowpass', f0: 2500, f1: 200, sw: 1.2 }], send: 1 });
  s.crackles(0.02, 0.5, 14, 2500, 7000, 0.05, 0.14, { send: 0.6, wide: 0.6 });
  s.voice({ src: 'pink', t: 0.3, a: 0.004, d: 0.07, g: 0.2, filt: [{ type: 'lowpass', f0: 2200, f1: 450, sw: 0.2 }], send: 0.7, pan: -0.3 });
});

def('rail_charge', 0.6, { loop: true, vol: 0.5, ref: 8, max: 120, prio: 6, variants: 1, rev: 'small' }, (s) => {
  s.voice({ src: 'sine', sus: true, f0: 380, a: 0.02, g: 0.5, am: { rate: 16.667, depth: 0.5 } });
  s.voice({ src: 'sine', sus: true, f0: 760, a: 0.02, g: 0.2, am: { rate: 16.667, depth: 0.5 } });
  s.voice({ src: 'white', sus: true, a: 0.02, g: 0.1, filt: [{ type: 'bandpass', f0: 3200, q: 1.4 }] });
});

def('rail_ready', 0.3, { vol: 0.55, ref: 6, max: 60, prio: 6, variants: 1, rev: 'small' }, (s) => {
  s.note(0, 1760, 0.5, 0.12);
  s.note(0.02, 2637, 0.35, 0.16);
});

def('rocket_loop', 0.6, { loop: true, vol: 0.55, ref: 6, max: 90, prio: 4, rev: 'small' }, (s) => {
  s.voice({ src: 'brown', sus: true, a: 0.01, g: 1, filt: [{ type: 'lowpass', f0: 520, q: 0.7 }] });
  s.voice({ src: 'white', sus: true, a: 0.01, g: 0.5, filt: [{ type: 'bandpass', f0: 1500, q: 0.5 }], am: { rate: 33.3, depth: 0.6 } });
  s.voice({ src: 'white', sus: true, a: 0.01, g: 0.18, filt: [{ type: 'highpass', f0: 4000 }] });
});

def('dry_fire', 0.16, { variants: 2, vol: 0.6, ref: 3, max: 40, prio: 4 }, (s, r) => {
  const j = jit(r, 0.08);
  s.click(0, 2400 * j, 1, 0.006, 3);
  s.thump(0, 1300 * j, 900, 0.01, 0.01, 0.5);
  s.thump(0.002, 190, 120, 0.02, 0.02, 0.7);
  s.click(0.03, 3400, 0.25, 0.004, 3);
});

def('reload_start', 0.35, { vol: 0.65, ref: 3, max: 45, prio: 4, variants: 2 }, (s, r) => {
  const j = jit(r, 0.06);
  s.ring({ f: 900 * j, ratios: [1, 2.4], d: 0.02, g: 0.5 });
  s.click(0.01, 1300 * j, 0.8, 0.02, 2);
  s.thump(0.005, 200, 110, 0.05, 0.03, 0.8);
  s.click(0.06, 4500, 0.3, 0.01, 1);
  s.click(0.13, 2200 * j, 0.35, 0.008, 2);
});

def('reload_insert', 0.4, { vol: 0.7, ref: 3, max: 45, prio: 4, variants: 3 }, (s, r) => {
  const j = jit(r, 0.06);
  s.thump(0, 150 * j, 80, 0.06, 0.04, 1);
  s.click(0.02, 2000 * j, 0.9, 0.01, 2);
  s.ring({ f: 1300 * j, ratios: [1, 2.5, 4.1], d: 0.03, g: 0.35, t: 0.02 });
  s.click(0.085, 3500, 0.5, 0.005, 2);
  s.voice({ src: 'pink', t: 0.03, a: 0.005, d: 0.03, g: 0.3, filt: [{ type: 'lowpass', f0: 900 }] });
});

def('reload_end', 0.5, { vol: 0.7, ref: 3, max: 45, prio: 4, variants: 3 }, (s, r) => {
  const j = jit(r, 0.05);
  s.voice({ src: 'white', a: 0.004, d: 0.02, g: 0.7, filt: [{ type: 'bandpass', f0: 3500, f1: 1500, sw: 0.04, q: 1 }] });
  s.click(0.09, 1500 * j, 1, 0.02, 1.5);
  s.thump(0.09, 180, 100, 0.05, 0.04, 1);
  s.ring({ f: 1100 * j, ratios: [1, 2.6], d: 0.05, g: 0.3, t: 0.09 });
  s.click(0.17, 3000, 0.4, 0.005, 2);
});

def('pump', 0.7, { vol: 0.8, ref: 4, max: 55, prio: 5, variants: 3 }, (s, r) => {
  const j = jit(r, 0.05);
  s.voice({ src: 'white', a: 0.005, d: 0.03, g: 0.7, filt: [{ type: 'bandpass', f0: 2500, f1: 900, sw: 0.06, q: 1 }] });
  s.thump(0, 130, 80, 0.05, 0.03, 0.8);
  s.click(0.2, 1800 * j, 1, 0.03, 1.5);
  s.thump(0.2, 110, 55, 0.08, 0.06, 1.1);
  s.ring({ f: 700 * j, ratios: [1, 2.76], d: 0.06, g: 0.4, t: 0.2 });
  s.click(0.29, 3000, 0.3, 0.005, 2);
});

def('bolt', 0.8, { vol: 0.8, ref: 4, max: 55, prio: 5, variants: 2 }, (s, r) => {
  const j = jit(r, 0.05);
  s.click(0, 2400, 0.9, 0.008, 3);
  s.thump(0, 400, 250, 0.03, 0.02, 0.6);
  s.voice({ src: 'pink', t: 0.04, a: 0.01, d: 0.08, g: 0.4, filt: [{ type: 'bandpass', f0: 2000, f1: 1200, sw: 0.15, q: 1.2 }] });
  s.click(0.22, 1600 * j, 0.9, 0.02, 1.5);
  s.thump(0.22, 170, 90, 0.06, 0.04, 0.9);
  s.voice({ src: 'pink', t: 0.36, a: 0.01, d: 0.07, g: 0.4, filt: [{ type: 'bandpass', f0: 1300, f1: 2200, sw: 0.12, q: 1.2 }] });
  s.click(0.5, 1400 * j, 1, 0.025, 1.5);
  s.thump(0.5, 150, 70, 0.08, 0.06, 1);
  s.ring({ f: 900 * j, ratios: [1, 2.6], d: 0.06, g: 0.3, t: 0.5 });
});

def('weapon_switch', 0.32, { vol: 0.6, ref: 3, max: 40, prio: 3, variants: 3 }, (s, r) => {
  const j = jit(r, 0.08);
  s.voice({ src: 'pink', a: 0.02, d: 0.04, g: 0.5, filt: [{ type: 'bandpass', f0: 500, f1: 1500 * j, sw: 0.06, q: 0.8 }] });
  s.click(0.08, 2200 * j, 0.8, 0.01, 2);
  s.thump(0.08, 200, 120, 0.03, 0.025, 0.6);
});

def('melee_swing', 0.45, { vol: 0.7, ref: 4, max: 45, prio: 4, variants: 3 }, (s, r) => {
  const j = jit(r, 0.08);
  s.voice({ src: 'pink', a: 0.06, d: 0.06, g: 0.9, filt: [{ type: 'bandpass', f0: 300, f1: 1800 * j, sw: 0.13, q: 0.9 }] });
  s.voice({ src: 'white', a: 0.06, d: 0.04, g: 0.15, filt: [{ type: 'highpass', f0: 2000 }] });
  s.thump(0, 90, 60, 0.1, 0.06, 0.3);
});

def('melee_hit', 0.55, { vol: 0.9, ref: 5, max: 60, prio: 6, variants: 3, clip: 1.5, rev: 'small' }, (s, r) => {
  const j = jit(r, 0.07);
  s.thump(0, 180, 55, 0.1, 0.06, 1.3, { drive: 2 });
  s.voice({ src: 'pink', a: 0.001, d: 0.05, g: 0.9, filt: [{ type: 'lowpass', f0: 1500, f1: 300, sw: 0.1 }], drive: 2 });
  s.ring({ f: 1500 * j, ratios: [1, 2.5, 4.2], d: 0.05, g: 0.4 });
  s.click(0, 2500, 0.6, 0.01, 1);
});

def('grenade_pin', 0.45, { vol: 0.7, ref: 3, max: 40, prio: 4, variants: 2 }, (s, r) => {
  const j = jit(r, 0.05);
  s.ring({ f: 2500 * j, ratios: [1, 2.7], d: 0.05, g: 0.5 });
  s.voice({ src: 'white', a: 0.005, d: 0.03, g: 0.4, filt: [{ type: 'bandpass', f0: 3000, f1: 5000, sw: 0.05, q: 1 }] });
  s.click(0.06, 1800, 0.7, 0.008, 2);
  s.voice({ src: 'sine', t: 0.1, f0: 1800, f1: 1700, a: 0.002, d: 0.1, g: 0.3 });
});

def('grenade_throw', 0.5, { vol: 0.75, ref: 4, max: 50, prio: 4, variants: 3 }, (s, r) => {
  const j = jit(r, 0.05);
  s.ring({ f: 1600 * j, ratios: [1, 2.9, 5], d: 0.06, g: 0.4 });
  s.voice({ src: 'pink', t: 0.02, a: 0.04, d: 0.08, g: 0.6, filt: [{ type: 'bandpass', f0: 400, f1: 1600, sw: 0.15, q: 0.9 }] });
  s.thump(0, 100, 70, 0.05, 0.04, 0.4);
});

def('grenade_bounce', 0.45, { vol: 0.8, ref: 5, max: 65, prio: 4, variants: 3, cd: 0.05, rev: 'small' }, (s, r) => {
  const j = jit(r, 0.08);
  const parts = [380, 610, 1080, 1620], taus = [0.06, 0.05, 0.03, 0.02];
  parts.forEach((f, i) => s.voice({ src: 'sine', f0: f * j, a: 0.0006, d: taus[i], g: 0.7 / (1 + i * 0.4) }));
  s.thump(0, 160, 90, 0.05, 0.03, 0.9);
  s.click(0, 3000, 0.4, 0.005, 1);
});

// ---- special grenades (Kinetic Charge, Vortex, Static, Smoke): one contiguous block after grenade_bounce

def('charge_arm', 0.28, { vol: 0.6, ref: 3, max: 40, prio: 4, variants: 2 }, (s, r) => {
  const j = jit(r, 0.04);
  [900, 1350, 2100].forEach((f, i) => s.voice({ src: 'sine', t: i * 0.06, f0: f * j, f1: f * j * 1.06, sw: 0.05, a: 0.004, d: 0.035, g: 0.42 }));
  s.click(0.02, 3200, 0.3, 0.006, 2);
});

def('charge_blast', 1.4, { stereo: true, vol: 0.95, ref: 12, max: 220, prio: 9, clip: 1.6, rev: 'large', wet: 0.7, pitchVar: 0.04, maxInst: 3 }, (s, r) => {
  const j = jit(r, 0.06);
  s.thump(0, 45 * j, 30, 0.5, 0.3, 1.5, { a: 0.003, drive: 2 });
  s.thump(0, 120 * j, 50, 0.12, 0.08, 1.1, { a: 0.002 });
  s.voice({ src: 'white', a: 0.001, d: 0.02, g: 0.9, filt: [{ type: 'bandpass', f0: 1800, q: 0.7 }], drive: 2, send: 0.3 });
  s.voice({ src: 'pink', a: 0.002, d: 0.12, g: 0.8, filt: [{ type: 'lowpass', f0: 3200, f1: 260, sw: 0.4 }], drive: 2, send: 0.5 });
  s.voice({ src: 'sine', t: 0.01, f0: 1200, f1: 200, sw: 0.35, a: 0.002, d: 0.14, g: 0.5, send: 0.4 });
  s.crackles(0.02, 0.5, 18, 2000, 6000, 0.12, 0.4, { wide: 0.8, decay: 0.6, send: 0.3 });
  s.voice({ src: 'brown', t: 0.06, a: 0.02, d: 0.5, g: 0.55, filt: [{ type: 'lowpass', f0: 300, f1: 60, sw: 1.2 }], send: 0.6 });
});

def('vortex_deploy', 0.55, { stereo: true, vol: 0.85, ref: 8, max: 130, prio: 7, rev: 'med', wet: 0.5, variants: 2, maxInst: 3 }, (s, r) => {
  const j = jit(r, 0.05);
  s.voice({ src: 'sine', f0: 80 * j, f1: 620 * j, sw: 0.4, a: 0.02, hold: 0.25, d: 0.08, g: 0.55, send: 0.3 });
  s.voice({ src: 'sine', f0: 40, f1: 300, sw: 0.4, a: 0.02, hold: 0.25, d: 0.08, g: 0.6 });
  s.voice({ src: 'white', a: 0.3, hold: 0.05, d: 0.1, g: 0.5, filt: [{ type: 'bandpass', f0: 300, f1: 3200, sw: 0.4, q: 0.9 }], send: 0.4 });
  s.click(0.4, 2400, 0.4, 0.01, 2);
});

def('vortex_loop', 0.8, { loop: true, vol: 0.75, ref: 6, max: 90, prio: 6, rev: 'small', wet: 0.4 }, (s) => {
  s.voice({ src: 'brown', sus: true, a: 0.02, g: 1.1, filt: [{ type: 'lowpass', f0: 240, q: 0.7 }] });
  s.voice({ src: 'sine', sus: true, a: 0.02, f0: 45, g: 0.55 });
  s.voice({ src: 'white', sus: true, a: 0.02, g: 0.32, filt: [{ type: 'bandpass', f0: 1100, q: 0.9 }], am: { rate: 6, depth: 0.8 } });
  s.voice({ src: 'pink', sus: true, a: 0.02, g: 0.3, filt: [{ type: 'bandpass', f0: 500, q: 1.2 }], am: { rate: 3.75, depth: 0.7 } });
});

def('vortex_collapse', 1.7, { stereo: true, vol: 1, ref: 20, max: 420, prio: 10, clip: 1.7, rev: 'large', wet: 0.8, pitchVar: 0.04, maxInst: 2 }, (s, r) => {
  const j = jit(r, 0.05);
  // reverse-swell inhale, then the release
  s.voice({ src: 'white', a: 0.28, hold: 0.0, d: 0.02, g: 0.6, dur: 0.34, filt: [{ type: 'bandpass', f0: 400, f1: 3500, sw: 0.3, q: 0.8 }] });
  s.voice({ src: 'sine', f0: 90, f1: 500, sw: 0.3, a: 0.28, d: 0.02, g: 0.45, dur: 0.34 });
  s.thump(0.3, 55 * j, 26, 0.7, 0.45, 1.6, { a: 0.004, drive: 2 });
  s.thump(0.3, 130 * j, 45, 0.16, 0.1, 1.1, { a: 0.003 });
  s.voice({ src: 'white', t: 0.3, a: 0.001, d: 0.02, g: 0.95, filt: [{ type: 'highpass', f0: 800 }], drive: 3, send: 0.35 });
  s.voice({ src: 'pink', t: 0.3, a: 0.002, d: 0.2, g: 1, filt: [{ type: 'lowpass', f0: 4200, f1: 200, sw: 0.7 }], drive: 3, send: 0.5 });
  s.voice({ src: 'brown', t: 0.34, a: 0.03, d: 0.7, g: 0.7, filt: [{ type: 'lowpass', f0: 260, f1: 55, sw: 2 }], send: 0.7 });
  s.crackles(0.32, 1.1, 18, 1200, 5000, 0.1, 0.4, { wide: 0.8, decay: 0.7, send: 0.4 });
});

def('static_burst', 0.95, { stereo: true, vol: 0.95, ref: 12, max: 240, prio: 9, clip: 1.7, rev: 'med', wet: 0.5, pitchVar: 0.05, maxInst: 3 }, (s, r) => {
  const j = jit(r, 0.05);
  s.voice({ src: 'white', a: 0.0005, d: 0.012, g: 1, filt: [{ type: 'highpass', f0: 1500 }], drive: 3, send: 0.3 });
  s.thump(0, 100 * j, 45, 0.12, 0.08, 1.2, { a: 0.002 });
  s.voice({ src: 'saw', t: 0.005, f0: 1800 * j, f1: 260, sw: 0.4, a: 0.002, d: 0.16, g: 0.5, filt: [{ type: 'lowpass', f0: 5000 }], send: 0.3 });
  s.crackles(0.01, 0.55, 26, 2200, 7000, 0.18, 0.6, { wide: 0.9, decay: 0.5, send: 0.3 });
  s.voice({ src: 'pink', t: 0.02, a: 0.005, d: 0.18, g: 0.5, filt: [{ type: 'bandpass', f0: 3000, q: 0.8 }] });
});

def('shock_hit', 0.3, { vol: 0.7, ref: 4, max: 60, prio: 6, variants: 3, rev: 'small', wet: 0.3, cd: 0.03, pitchVar: 0.06 }, (s, r) => {
  const j = jit(r, 0.1);
  s.crackles(0, 0.16, 8, 2500, 6500, 0.3, 0.8, { wide: 0.5, decay: 0.4 });
  s.voice({ src: 'saw', f0: 1500 * j, f1: 400, sw: 0.12, a: 0.001, d: 0.05, g: 0.35, filt: [{ type: 'lowpass', f0: 4500 }] });
});

def('smoke_pop', 1.3, { stereo: true, vol: 0.85, ref: 10, max: 120, prio: 6, rev: 'med', wet: 0.5, variants: 2, maxInst: 3 }, (s, r) => {
  const j = jit(r, 0.05);
  s.thump(0, 150 * j, 70, 0.12, 0.09, 1.1, { a: 0.003 });
  s.voice({ src: 'pink', a: 0.004, d: 0.05, g: 0.6, filt: [{ type: 'lowpass', f0: 1500, f1: 300, sw: 0.2 }] });
  s.voice({ src: 'white', t: 0.02, a: 0.03, d: 0.4, g: 0.35, filt: [{ type: 'bandpass', f0: 2600, f1: 1800, sw: 1.2, q: 0.9 }], send: 0.4 });
  s.voice({ src: 'white', t: 0.1, a: 0.1, d: 0.3, g: 0.18, filt: [{ type: 'highpass', f0: 4000 }] });
});

def('explosion', 3.8, { variants: 2, stereo: true, vol: 1, ref: 22, max: 520, prio: 10, clip: 1.7, rev: 'large', wet: 0.85, pitchVar: 0.05, maxInst: 3 }, (s, r) => {
  const j = jit(r, 0.08);
  s.voice({ src: 'white', a: 0.0005, d: 0.006, g: 1, filt: [{ type: 'highpass', f0: 700 }], drive: 3 });
  s.thump(0, 72 * j, 26, 0.9, 0.5, 1.5, { a: 0.004, drive: 2 });
  s.thump(0, 140 * j, 45, 0.3, 0.15, 1, { a: 0.003 });
  s.voice({ src: 'pink', a: 0.002, d: 0.22, g: 1.1, filt: [{ type: 'lowpass', f0: 5200, f1: 200, sw: 0.8 }], drive: 3, send: 0.45 });
  s.voice({ src: 'brown', a: 0.005, d: 0.45, g: 1.1, filt: [{ type: 'lowpass', f0: 900, f1: 90, sw: 1.2 }], drive: 2, send: 0.3 });
  s.voice({ src: 'brown', t: 0.05, a: 0.03, d: 0.9, g: 0.7, filt: [{ type: 'lowpass', f0: 260, f1: 55, sw: 2.6 }], send: 0.6 });
  s.voice({ src: 'pink', t: 0.1, a: 0.02, d: 0.5, g: 0.45, filt: [{ type: 'lowpass', f0: 1800, f1: 250, sw: 1.8 }], send: 1, pan: -0.4 });
  s.voice({ src: 'pink', t: 0.12, a: 0.02, d: 0.5, g: 0.45, filt: [{ type: 'lowpass', f0: 1700, f1: 240, sw: 1.8 }], send: 1, pan: 0.4 });
  s.crackles(0.12, 2.0, 24, 1200, 6500, 0.15, 0.5, { wide: 0.8, decay: 0.7, send: 0.4 });
});

// ---------------------------------------------------------------- impacts

def('impact_metal', 0.55, { vol: 0.6, ref: 3, max: 55, prio: 2, cd: 0.02, variants: 4, rev: 'small', wet: 0.4, maxInst: 5 }, (s, r) => {
  const j = jit(r, 0.12);
  s.voice({ src: 'white', a: 0.0004, d: 0.004, g: 1, filt: [{ type: 'highpass', f0: 2500 }] });
  s.ring({ f: 1900 * j, ratios: [1, 2.32, 4.25, 6.63], d: 0.1, g: 0.6, send: 0.2 });
  if (r() < 0.6) s.voice({ src: 'sine', f0: 4200 * j, f1: 1500, sw: 0.16, a: 0.002, d: 0.045, g: 0.3 });
  s.thump(0, 220, 150, 0.03, 0.02, 0.5);
});

def('impact_concrete', 0.38, { vol: 0.6, ref: 3, max: 50, prio: 2, cd: 0.02, variants: 4, rev: 'small', wet: 0.3, maxInst: 5 }, (s, r) => {
  const j = jit(r, 0.12);
  s.click(0, 2200 * j, 1, 0.008, 0.7);
  s.thump(0, 150 * j, 80, 0.04, 0.03, 0.8);
  s.voice({ src: 'white', a: 0.001, d: 0.03, g: 0.4, filt: [{ type: 'highpass', f0: 3000 }] });
  s.voice({ src: 'pink', a: 0.002, d: 0.06, g: 0.5, filt: [{ type: 'lowpass', f0: 1200, f1: 400, sw: 0.1 }] });
});

def('impact_stone', 0.42, { vol: 0.6, ref: 3, max: 50, prio: 2, cd: 0.02, variants: 4, rev: 'small', wet: 0.3, maxInst: 5 }, (s, r) => {
  const j = jit(r, 0.12);
  s.voice({ src: 'white', a: 0.0004, d: 0.006, g: 1, filt: [{ type: 'highpass', f0: 3000 }] });
  s.ring({ f: 1400 * j, ratios: [1, 1.9, 3.1], d: 0.03, g: 0.4 });
  s.crackles(0.03, 0.14, 3, 3500, 6500, 0.2, 0.4, { q: 3 });
  s.thump(0, 190, 110, 0.04, 0.03, 0.6);
});

def('impact_wood', 0.4, { vol: 0.65, ref: 3, max: 50, prio: 2, cd: 0.02, variants: 4, rev: 'small', wet: 0.3, maxInst: 5 }, (s, r) => {
  const j = jit(r, 0.1);
  s.thump(0, 320 * j, 150, 0.04, 0.035, 1);
  s.click(0, 900 * j, 0.8, 0.03, 1.5);
  s.voice({ src: 'sine', f0: 520 * j, a: 0.001, d: 0.04, g: 0.2 });
  s.voice({ src: 'sine', f0: 1100 * j, a: 0.001, d: 0.03, g: 0.15 });
  s.voice({ src: 'white', t: 0.004, a: 0.001, d: 0.01, g: 0.35, filt: [{ type: 'highpass', f0: 4000 }] });
});

def('impact_dirt', 0.32, { vol: 0.6, ref: 3, max: 45, prio: 2, cd: 0.02, variants: 3, rev: 'small', wet: 0.25, maxInst: 4 }, (s, r) => {
  const j = jit(r, 0.12);
  s.voice({ src: 'pink', a: 0.002, d: 0.05, g: 1, filt: [{ type: 'lowpass', f0: 500 * j, q: 0.8 }], drive: 1.5 });
  s.thump(0, 110, 70, 0.05, 0.04, 0.7);
  s.voice({ src: 'white', a: 0.002, d: 0.02, g: 0.2, filt: [{ type: 'highpass', f0: 2500 }] });
});

def('impact_sand', 0.32, { vol: 0.55, ref: 3, max: 45, prio: 2, cd: 0.02, variants: 3, rev: 'small', wet: 0.25, maxInst: 4 }, (s, r) => {
  const j = jit(r, 0.12);
  s.voice({ src: 'white', a: 0.005, d: 0.05, g: 0.6, filt: [{ type: 'bandpass', f0: 3000 * j, q: 0.4 }] });
  s.voice({ src: 'pink', a: 0.003, d: 0.04, g: 0.5, filt: [{ type: 'lowpass', f0: 800 }] });
});

def('impact_glass', 0.85, { vol: 0.65, ref: 3, max: 55, prio: 2, cd: 0.03, variants: 3, rev: 'small', wet: 0.45, maxInst: 4 }, (s, r) => {
  const j = jit(r, 0.1);
  s.voice({ src: 'white', a: 0.0004, d: 0.006, g: 0.9, filt: [{ type: 'highpass', f0: 4000 }] });
  s.thump(0, 300, 200, 0.02, 0.02, 0.5);
  const n = 9 + Math.floor(r() * 6);
  for (let i = 0; i < n; i++) {
    const t = Math.pow(r(), 1.5) * 0.4;
    s.voice({ src: 'sine', t, f0: (2500 + r() * 6500) * j, a: 0.0006, d: 0.015 + r() * 0.04, g: 0.1 + r() * 0.2, pan: (r() * 2 - 1) * 0.5, send: 0.3 });
  }
});

def('impact_grass', 0.28, { vol: 0.5, ref: 3, max: 40, prio: 2, cd: 0.02, variants: 3, rev: 'small', wet: 0.2, maxInst: 4 }, (s, r) => {
  s.voice({ src: 'pink', a: 0.003, d: 0.04, g: 0.9, filt: [{ type: 'lowpass', f0: 700 * jit(r, 0.1) }] });
  s.voice({ src: 'white', a: 0.01, d: 0.03, g: 0.2, filt: [{ type: 'bandpass', f0: 4000, q: 0.6 }] });
});

def('impact_energy', 0.45, { vol: 0.65, ref: 3, max: 55, prio: 2, cd: 0.02, variants: 3, rev: 'small', wet: 0.35, maxInst: 4 }, (s, r) => {
  const j = jit(r, 0.12);
  s.voice({ src: 'saw', f0: 1800 * j, f1: 300, sw: 0.1, a: 0.001, d: 0.05, g: 0.5, fm: { f: 220, depth: 900 }, filt: [{ type: 'lowpass', f0: 6000 }] });
  s.voice({ src: 'white', a: 0.001, d: 0.08, g: 0.6, filt: [{ type: 'highpass', f0: 3000 }], am: { rate: 60, depth: 1, type: 'square' } });
  s.voice({ src: 'sine', f0: 4000, f1: 2000, sw: 0.05, a: 0.001, d: 0.03, g: 0.3 });
  s.thump(0, 140, 90, 0.04, 0.03, 0.5);
});

def('impact_robot', 0.4, { vol: 0.75, ref: 4, max: 60, prio: 3, cd: 0.02, variants: 4, rev: 'small', wet: 0.3, maxInst: 5 }, (s, r) => {
  const j = jit(r, 0.12);
  s.ring({ f: 680 * j, ratios: [1, 2.76, 5.4, 8.93], d: 0.06, g: 0.7 });
  s.thump(0, 200, 90, 0.04, 0.03, 0.9);
  s.voice({ src: 'saw', t: 0.005, f0: 2400, f1: 600, sw: 0.05, a: 0.001, d: 0.025, g: 0.22, filt: [{ type: 'lowpass', f0: 5000 }] });
  s.voice({ src: 'white', t: 0.004, a: 0.001, d: 0.02, g: 0.4, filt: [{ type: 'highpass', f0: 4000 }], am: { rate: 90, depth: 1, type: 'square' } });
});

// ---------------------------------------------------------------- feedback / UI

def('hitmarker', 0.16, { vol: 0.65, prio: 9, cd: 0.03, variants: 2, pitchVar: 0.02, ref: 1, max: 9999 }, (s, r) => {
  const j = jit(r, 0.03);
  s.voice({ src: 'white', a: 0.0003, d: 0.002, g: 0.6, filt: [{ type: 'highpass', f0: 3000 }] });
  s.voice({ src: 'sine', f0: 1900 * j, a: 0.0006, d: 0.012, g: 0.7 });
  s.voice({ src: 'sine', f0: 1300 * j, a: 0.0006, d: 0.02, g: 0.5 });
  s.thump(0, 260, 180, 0.03, 0.02, 0.45);
});

def('headshot', 0.5, { vol: 0.75, prio: 9, cd: 0.05, variants: 2, pitchVar: 0.02, ref: 1, max: 9999, rev: 'small', wet: 0.4 }, (s, r) => {
  const j = jit(r, 0.02);
  s.voice({ src: 'white', a: 0.0003, d: 0.003, g: 0.7, filt: [{ type: 'highpass', f0: 3000 }] });
  s.voice({ src: 'sine', f0: 2300 * j, a: 0.0006, d: 0.012, g: 0.6 });
  s.ring({ f: 2093 * j, ratios: [1, 1.5, 2.02], d: 0.09, g: 0.5, send: 0.3 });
  s.thump(0, 240, 120, 0.05, 0.04, 0.9);
  s.voice({ src: 'sine', t: 0.05, f0: 3136 * j, a: 0.001, d: 0.07, g: 0.25 });
});

def('kill_confirm', 0.7, { stereo: true, vol: 0.75, prio: 9, variants: 2, pitchVar: 0.02, ref: 1, max: 9999, rev: 'small', wet: 0.5 }, (s, r) => {
  const j = jit(r, 0.02);
  s.note(0, 1046.5 * j, 0.6, 0.07, { send: 0.3 });
  s.note(0.07, 1568 * j, 0.6, 0.12, { send: 0.3 });
  s.note(0.07, 2093 * j, 0.22, 0.14);
  s.click(0, 3000, 0.4, 0.004, 1);
  s.thump(0, 200, 90, 0.06, 0.05, 0.7);
});

def('hurt', 0.45, { stereo: true, vol: 0.9, prio: 9, variants: 3, clip: 1.6, ref: 1, max: 9999, rev: 'small', wet: 0.3, cd: 0.06 }, (s, r) => {
  const j = jit(r, 0.08);
  s.thump(0, 130 * j, 70, 0.1, 0.08, 1);
  s.voice({ src: 'pink', a: 0.002, d: 0.07, g: 0.9, filt: [{ type: 'lowpass', f0: 900, f1: 250, sw: 0.12 }], drive: 2 });
  s.voice({ src: 'saw', f0: 900 * j, f1: 200, sw: 0.08, a: 0.001, d: 0.04, g: 0.25, filt: [{ type: 'lowpass', f0: 3000 }] });
  s.voice({ src: 'white', a: 0.0005, d: 0.008, g: 0.5, filt: [{ type: 'highpass', f0: 2500 }] });
  s.voice({ src: 'sine', t: 0.02, f0: 200, f1: 130, sw: 0.25, a: 0.02, d: 0.1, g: 0.25 });
});

def('death', 2, { variants: 1, stereo: true, vol: 0.95, prio: 10, clip: 1.6, ref: 1, max: 9999, rev: 'med', wet: 0.6 }, (s, r) => {
  const j = jit(r, 0.05);
  s.voice({ src: 'saw', f0: 300 * j, f1: 40, sw: 1.1, a: 0.01, d: 0.5, g: 0.45, drive: 2, filt: [{ type: 'lowpass', f0: 3000, f1: 150, sw: 1.1 }], send: 0.4 });
  s.thump(0, 90, 30, 0.4, 0.3, 1.3, { drive: 2 });
  s.voice({ src: 'pink', a: 0.002, d: 0.15, g: 0.9, filt: [{ type: 'lowpass', f0: 1500, f1: 100, sw: 0.4 }], drive: 2 });
  s.crackles(0.05, 0.9, 10, 2000, 6000, 0.15, 0.35, { wide: 0.7 });
  s.thump(0.38, 60, 40, 0.15, 0.08, 0.6);
  s.thump(0.62, 55, 38, 0.15, 0.09, 0.35);
});

def('bot_death', 1.6, { variants: 2, stereo: true, vol: 0.95, ref: 9, max: 130, prio: 8, clip: 1.8, rev: 'small', wet: 0.55, maxInst: 4 }, (s, r) => {
  const j = jit(r, 0.08);
  s.voice({ src: 'white', a: 0.0005, d: 0.05, g: 0.9, filt: [{ type: 'bandpass', f0: 1800, q: 0.6 }], drive: 3 });
  s.thump(0, 110 * j, 40, 0.25, 0.14, 1.2, { drive: 1.5 });
  s.voice({ src: 'pink', a: 0.001, d: 0.15, g: 0.8, filt: [{ type: 'lowpass', f0: 4000, f1: 300, sw: 0.5 }], drive: 3, send: 0.4 });
  s.voice({ src: 'saw', t: 0.05, f0: 500 * j, f1: 60, sw: 0.9, a: 0.02, d: 0.4, g: 0.35, filt: [{ type: 'lowpass', f0: 1800, q: 1 }], fm: { f: 14, depth: 40 } });
  s.crackles(0.03, 0.7, 8, 3500, 7500, 0.15, 0.4, { wide: 0.6, q: 3 });
  for (let i = 0; i < 3; i++) {
    s.voice({ src: 'saw', t: 0.08 + r() * 0.5, f0: 2500 + r() * 2000, f1: 500, sw: 0.05, a: 0.001, d: 0.02, g: 0.2, pan: r() * 1.4 - 0.7 });
  }
  for (let i = 0; i < 4; i++) {
    s.ring({ f: 500 + r() * 2000, ratios: [1, 2.76], d: 0.05, g: 0.2, t: 0.25 + r() * 0.55, pan: r() * 1.2 - 0.6 });
  }
});

// ---------------------------------------------------------------- movement

def('footstep', 0.3, { variants: 5, vol: 0.5, ref: 2.5, max: 32, prio: 2, cd: 0.035, level: 0.8, rev: 'small', wet: 0.25, pitchVar: 0.1, maxInst: 6 }, (s, r) => {
  const j = jit(r, 0.14);
  s.click(0, 1800 * j, 0.6, 0.012, 0.8);
  s.voice({ src: 'pink', a: 0.002, d: 0.03, g: 1, filt: [{ type: 'lowpass', f0: 700 * j, f1: 260, sw: 0.08 }], drive: 1.5 });
  s.thump(0, 110 * j, 60, 0.06, 0.04, 0.9);
  s.voice({ src: 'white', t: 0.03, a: 0.01, d: 0.04, g: 0.25, filt: [{ type: 'bandpass', f0: 2400 * j, q: 0.5 }] });
});

def('jump', 0.35, { vol: 0.55, ref: 3, max: 35, prio: 3, variants: 3, rev: 'small', wet: 0.2 }, (s, r) => {
  const j = jit(r, 0.1);
  s.voice({ src: 'pink', a: 0.03, d: 0.06, g: 0.7, filt: [{ type: 'bandpass', f0: 500, f1: 1400 * j, sw: 0.12, q: 0.8 }] });
  s.thump(0, 120, 70, 0.06, 0.04, 0.6);
  s.click(0.005, 1800, 0.2, 0.01, 0.8);
});

def('double_jump', 0.5, { vol: 0.65, ref: 4, max: 45, prio: 4, variants: 3, rev: 'small', wet: 0.35 }, (s, r) => {
  const j = jit(r, 0.08);
  s.voice({ src: 'white', a: 0.01, d: 0.09, g: 0.8, filt: [{ type: 'bandpass', f0: 1200, f1: 3500 * j, sw: 0.15, q: 1.2 }], send: 0.3 });
  s.voice({ src: 'sine', f0: 380 * j, f1: 900, sw: 0.15, a: 0.01, d: 0.08, g: 0.3 });
  s.voice({ src: 'pink', a: 0.005, d: 0.06, g: 0.6, filt: [{ type: 'lowpass', f0: 900 }] });
});

def('land', 0.35, { vol: 0.6, ref: 3, max: 40, prio: 3, variants: 3, rev: 'small', wet: 0.25 }, (s, r) => {
  const j = jit(r, 0.1);
  s.thump(0, 110 * j, 55, 0.09, 0.06, 1);
  s.voice({ src: 'pink', a: 0.002, d: 0.05, g: 1, filt: [{ type: 'lowpass', f0: 1100, f1: 350, sw: 0.1 }] });
  s.click(0, 1500, 0.55, 0.012, 0.8);
  s.voice({ src: 'white', t: 0.01, a: 0.006, d: 0.03, g: 0.25, filt: [{ type: 'bandpass', f0: 2200 * j, q: 0.6 }] });
});

def('land_hard', 0.8, { vol: 0.9, ref: 5, max: 70, prio: 6, variants: 3, clip: 1.5, rev: 'small', wet: 0.4 }, (s, r) => {
  const j = jit(r, 0.08);
  s.thump(0, 75 * j, 32, 0.18, 0.12, 1.4, { drive: 2 });
  s.voice({ src: 'pink', a: 0.001, d: 0.12, g: 1, filt: [{ type: 'lowpass', f0: 900, f1: 150, sw: 0.25 }], drive: 2 });
  s.click(0, 2200, 0.5, 0.02, 0.8);
  s.voice({ src: 'brown', a: 0.005, d: 0.2, g: 0.7, filt: [{ type: 'lowpass', f0: 250 }] });
  s.crackles(0.05, 0.25, 3, 3000, 5000, 0.15, 0.3, { q: 3 });
});

def('wall_jump', 0.5, { vol: 0.7, ref: 4, max: 45, prio: 4, variants: 3, rev: 'small', wet: 0.25 }, (s, r) => {
  const j = jit(r, 0.08);
  s.voice({ src: 'white', a: 0.004, d: 0.05, g: 0.9, filt: [{ type: 'bandpass', f0: 700, f1: 1500, sw: 0.08, q: 0.8 }] });
  s.thump(0, 220 * j, 90, 0.08, 0.05, 0.9);
  s.voice({ src: 'pink', t: 0.03, a: 0.05, d: 0.09, g: 0.5, filt: [{ type: 'bandpass', f0: 600, f1: 2000, sw: 0.15, q: 0.9 }] });
});

def('mantle', 0.65, { vol: 0.7, ref: 4, max: 45, prio: 4, variants: 3, rev: 'small', wet: 0.25 }, (s, r) => {
  const j = jit(r, 0.08);
  s.voice({ src: 'pink', a: 0.03, d: 0.07, g: 0.7, filt: [{ type: 'bandpass', f0: 500, f1: 900 * j, sw: 0.15, q: 0.9 }] });
  s.voice({ src: 'pink', t: 0.16, a: 0.03, d: 0.07, g: 0.7, filt: [{ type: 'bandpass', f0: 550, f1: 1000 * j, sw: 0.15, q: 0.9 }] });
  s.thump(0.3, 90 * j, 55, 0.08, 0.06, 0.8);
  s.voice({ src: 'pink', t: 0.3, a: 0.003, d: 0.05, g: 0.6, filt: [{ type: 'lowpass', f0: 600 }] });
});

def('slide', 1, { loop: true, vol: 0.55, ref: 3, max: 40, prio: 3, variants: 1, rev: 'small' }, (s) => {
  s.voice({ src: 'white', sus: true, a: 0.02, g: 0.6, filt: [{ type: 'bandpass', f0: 1400, q: 0.6 }] });
  s.voice({ src: 'white', sus: true, a: 0.02, g: 0.28, filt: [{ type: 'highpass', f0: 3500 }], am: { rate: 23, depth: 0.85 } });
  s.voice({ src: 'brown', sus: true, a: 0.02, g: 0.8, filt: [{ type: 'lowpass', f0: 200 }] });
  s.voice({ src: 'pink', sus: true, a: 0.02, g: 0.35, filt: [{ type: 'bandpass', f0: 700, q: 1.2 }], am: { rate: 3, depth: 0.5 } });
});

def('wallrun', 1.2, { loop: true, vol: 0.5, ref: 3, max: 40, prio: 3, variants: 1, rev: 'small' }, (s) => {
  s.voice({ src: 'pink', sus: true, a: 0.03, g: 0.8, filt: [{ type: 'bandpass', f0: 900, q: 0.7 }], am: { rate: 2.5, depth: 0.35 } });
  s.voice({ src: 'white', sus: true, a: 0.03, g: 0.4, filt: [{ type: 'bandpass', f0: 1700, q: 0.6 }], am: { rate: 7.5, depth: 1, type: 'triangle' } });
  s.voice({ src: 'white', sus: true, a: 0.03, g: 0.16, filt: [{ type: 'highpass', f0: 5000 }] });
  s.voice({ src: 'brown', sus: true, a: 0.03, g: 0.7, filt: [{ type: 'lowpass', f0: 320 }] });
});

def('grapple_fire', 0.65, { vol: 0.85, ref: 6, max: 70, prio: 6, variants: 3, rev: 'small', wet: 0.4 }, (s, r) => {
  const j = jit(r, 0.06);
  s.voice({ src: 'white', a: 0.001, d: 0.03, g: 1, filt: [{ type: 'bandpass', f0: 900, q: 0.8 }], drive: 2 });
  s.thump(0, 260 * j, 70, 0.09, 0.05, 0.9);
  s.voice({ src: 'white', t: 0.02, a: 0.02, d: 0.12, g: 0.5, filt: [{ type: 'bandpass', f0: 1500, f1: 7000, sw: 0.25, q: 1.5 }], send: 0.3 });
  s.ring({ f: 1800 * j, ratios: [1, 1.6], d: 0.08, g: 0.25, t: 0.01 });
  s.click(0.03, 3200, 0.5, 0.005, 2);
});

def('grapple_attach', 0.55, { vol: 0.9, ref: 6, max: 75, prio: 6, variants: 3, clip: 1.4, rev: 'small', wet: 0.4 }, (s, r) => {
  const j = jit(r, 0.07);
  s.thump(0, 140 * j, 60, 0.08, 0.08, 1.1, { drive: 1.5 });
  s.ring({ f: 520 * j, ratios: [1, 2.32, 3.86, 5.4], d: 0.12, g: 0.6, send: 0.2 });
  s.click(0.02, 3000, 0.7, 0.006, 2);
  s.click(0.05, 3500, 0.55, 0.006, 2);
  s.voice({ src: 'pink', a: 0.002, d: 0.04, g: 0.4, filt: [{ type: 'lowpass', f0: 1200 }] });
});

def('grapple_reel', 0.8, { loop: true, vol: 0.45, ref: 4, max: 50, prio: 3, variants: 1, rev: 'small' }, (s) => {
  // motor whine from a very resonant band-pass on noise (loops without a tonal seam)
  s.voice({ src: 'white', sus: true, a: 0.02, g: 0.9, filt: [{ type: 'bandpass', f0: 190, q: 14 }, { type: 'lowpass', f0: 1200 }], drive: 2 });
  s.voice({ src: 'white', sus: true, a: 0.02, g: 0.5, filt: [{ type: 'bandpass', f0: 760, q: 9 }] });
  s.voice({ src: 'white', sus: true, a: 0.02, g: 0.25, filt: [{ type: 'bandpass', f0: 3500, q: 0.8 }], am: { rate: 25, depth: 1, type: 'square' } });
  s.voice({ src: 'pink', sus: true, a: 0.02, g: 0.35, filt: [{ type: 'bandpass', f0: 2200, q: 0.7 }] });
  s.voice({ src: 'brown', sus: true, a: 0.02, g: 0.6, filt: [{ type: 'lowpass', f0: 240 }] });
});

def('grapple_release', 0.4, { vol: 0.7, ref: 4, max: 50, prio: 4, variants: 2, rev: 'small', wet: 0.3 }, (s, r) => {
  s.voice({ src: 'white', a: 0.005, d: 0.06, g: 0.7, filt: [{ type: 'bandpass', f0: 3500, f1: 800, sw: 0.15, q: 1 }] });
  s.click(0, 2800, 0.6, 0.008, 2);
  s.thump(0, 150, 90, 0.05, 0.04, 0.5);
});

def('jumppad', 0.8, { stereo: true, vol: 0.85, ref: 8, max: 90, prio: 6, variants: 2, rev: 'med', wet: 0.4 }, (s, r) => {
  s.voice({ src: 'sine', f0: 180, f1: 720, sw: 0.3, a: 0.005, d: 0.15, g: 0.8, fm: { f: 18, depth: 25 } });
  s.voice({ src: 'triangle', f0: 360, f1: 1440, sw: 0.3, a: 0.005, d: 0.12, g: 0.25, fm: { f: 18, depth: 50 } });
  s.voice({ src: 'white', a: 0.05, d: 0.2, g: 0.45, filt: [{ type: 'bandpass', f0: 600, f1: 3500, sw: 0.3, q: 1 }], send: 0.3 });
  s.thump(0, 120, 50, 0.1, 0.08, 1);
  s.voice({ src: 'sine', t: 0.05, f0: 2400, a: 0.1, d: 0.15, g: 0.1, am: { rate: 14, depth: 0.8 }, send: 0.4 });
  s.voice({ src: 'sine', t: 0.05, f0: 3100, a: 0.1, d: 0.15, g: 0.08, am: { rate: 17, depth: 0.8 }, send: 0.4 });
});

// ---------------------------------------------------------------- storm (Stratos)

def('thunder_near', 3.4, { variants: 2, stereo: true, vol: 1, ref: 60, max: 700, prio: 9, clip: 1.4, rev: 'large', wet: 0.9, pitchVar: 0.05, maxInst: 2 }, (s, r) => {
  const j = jit(r, 0.08);
  s.voice({ src: 'white', a: 0.002, d: 0.05, g: 0.8, filt: [{ type: 'lowpass', f0: 7000, f1: 900, sw: 0.25, q: 0.8 }], send: 0.5 });
  s.click(0, 2200, 0.45, 0.012, 1.2);
  s.voice({ src: 'brown', a: 0.03, hold: 0.25, d: 0.55, g: 1.3, filt: [{ type: 'lowpass', f0: 240 * j, f1: 90, sw: 1.6, q: 0.7 }], send: 0.6 });
  s.thump(0.02, 70 * j, 32, 0.6, 0.3, 1.1);
  s.voice({ src: 'brown', t: 0.7, a: 0.25, hold: 0.2, d: 0.5, g: 0.8, filt: [{ type: 'lowpass', f0: 200, f1: 80, sw: 1.4 }], am: { rate: 5.5, depth: 0.7 }, send: 0.6 });
  s.voice({ src: 'brown', t: 1.5, a: 0.4, d: 0.5, g: 0.5, filt: [{ type: 'lowpass', f0: 160, f1: 70, sw: 1.2 }], am: { rate: 4, depth: 0.8 }, send: 0.6 });
});

def('thunder_far', 3.6, { variants: 2, stereo: true, vol: 0.9, ref: 80, max: 900, prio: 8, clip: 1.2, rev: 'large', wet: 1, pitchVar: 0.05, maxInst: 2 }, (s, r) => {
  const j = jit(r, 0.1);
  s.voice({ src: 'brown', a: 0.45, hold: 0.3, d: 0.7, g: 1.1, filt: [{ type: 'lowpass', f0: 170 * j, f1: 70, sw: 2.2, q: 0.6 }], am: { rate: 3.2, depth: 0.6 }, send: 0.7 });
  s.thump(0.3, 55 * j, 30, 0.9, 0.4, 0.8);
  s.voice({ src: 'brown', t: 1.2, a: 0.5, d: 0.6, g: 0.6, filt: [{ type: 'lowpass', f0: 140, f1: 60, sw: 1.6 }], am: { rate: 5, depth: 0.7 }, send: 0.7 });
});

def('storm_warning', 1.3, { vol: 0.7, ref: 12, max: 110, prio: 7, variants: 1, rev: 'med', wet: 0.5 }, (s) => {
  s.voice({ src: 'sine', f0: 70, f1: 150, sw: 1.2, a: 0.1, d: 0.35, hold: 0.7, g: 0.75, fm: { f: 7, depth: 9 }, am: { rate: 9, depth: 0.5 } });
  s.voice({ src: 'triangle', f0: 140, f1: 300, sw: 1.2, a: 0.1, d: 0.3, hold: 0.7, g: 0.25, am: { rate: 9, depth: 0.7 } });
  s.voice({ src: 'sine', t: 0.1, f0: 1800, f1: 2900, sw: 1.1, a: 0.3, d: 0.3, hold: 0.6, g: 0.12, am: { rate: 14, depth: 0.9 }, send: 0.4 });
  s.voice({ src: 'white', a: 0.9, d: 0.25, g: 0.08, filt: [{ type: 'bandpass', f0: 900, f1: 3200, sw: 1.2, q: 1.5 }], send: 0.3 });
});

// ---------------------------------------------------------------- pickups & UI

def('pickup_health', 0.8, { vol: 0.75, ref: 5, max: 60, prio: 5, variants: 2, rev: 'small', wet: 0.5 }, (s, r) => {
  const j = jit(r, 0.01);
  s.note(0, 784 * j, 0.5, 0.14, { send: 0.3 });
  s.note(0.07, 987.8 * j, 0.5, 0.14, { send: 0.3 });
  s.note(0.14, 1318.5 * j, 0.55, 0.2, { send: 0.3 });
  s.voice({ src: 'triangle', f0: 392, a: 0.03, d: 0.3, g: 0.22, send: 0.3 });
});

def('pickup_armor', 0.7, { vol: 0.8, ref: 5, max: 60, prio: 5, variants: 2, rev: 'small', wet: 0.4 }, (s, r) => {
  const j = jit(r, 0.02);
  s.ring({ f: 430 * j, ratios: [1, 2.4, 3.9, 5.9], d: 0.1, g: 0.7, send: 0.2 });
  s.voice({ src: 'saw', f0: 200, f1: 800, sw: 0.2, a: 0.02, d: 0.15, g: 0.3, filt: [{ type: 'lowpass', f0: 2000 }] });
  s.note(0.12, 1568 * j, 0.25, 0.15, { send: 0.3 });
  s.click(0, 2500, 0.5, 0.008, 1.5);
});

def('pickup_ammo', 0.45, { vol: 0.75, ref: 5, max: 55, prio: 5, variants: 2, rev: 'small', wet: 0.3 }, (s, r) => {
  const j = jit(r, 0.05);
  s.click(0, 1500 * j, 0.9, 0.012, 2);
  s.click(0.07, 1700 * j, 0.8, 0.012, 2);
  s.thump(0, 220, 110, 0.05, 0.03, 0.7);
  s.note(0.1, 1760, 0.2, 0.07);
});

def('pickup_weapon', 0.9, { stereo: true, vol: 0.85, ref: 6, max: 70, prio: 6, variants: 2, rev: 'small', wet: 0.5 }, (s, r) => {
  const j = jit(r, 0.02);
  s.ring({ f: 260 * j, ratios: [1, 2.76, 5.4], d: 0.12, g: 0.7 });
  s.thump(0, 140, 60, 0.1, 0.08, 0.9);
  s.voice({ src: 'saw', f0: 300, f1: 1400, sw: 0.35, a: 0.05, d: 0.2, g: 0.35, filt: [{ type: 'lowpass', f0: 300, f1: 3500, sw: 0.35 }], send: 0.3 });
  s.note(0.25, 1046.5 * j, 0.3, 0.15, { send: 0.3 });
  s.note(0.33, 1568 * j, 0.3, 0.2, { send: 0.3 });
});

def('pickup_grenade', 0.55, { vol: 0.75, ref: 5, max: 55, prio: 5, variants: 2, rev: 'small', wet: 0.3 }, (s, r) => {
  const j = jit(r, 0.04);
  s.ring({ f: 340 * j, ratios: [1, 2.9, 5.1], d: 0.08, g: 0.8 });
  s.thump(0, 130, 70, 0.06, 0.05, 0.8);
  s.note(0.06, 2093, 0.18, 0.05);
});

def('ui_hover', 0.1, { variants: 2, vol: 0.3, pitchVar: 0.03, ref: 1, max: 9999, prio: 6, cd: 0.02 }, (s, r) => {
  s.voice({ src: 'sine', f0: 1500 * jit(r, 0.04), a: 0.001, d: 0.012, g: 0.5 });
  s.voice({ src: 'white', a: 0.0005, d: 0.004, g: 0.15, filt: [{ type: 'highpass', f0: 6000 }] });
});

def('ui_click', 0.22, { variants: 2, vol: 0.55, pitchVar: 0.02, ref: 1, max: 9999, prio: 7 }, (s, r) => {
  s.click(0, 2500, 0.8, 0.006, 1);
  s.voice({ src: 'sine', f0: 900, f1: 520, sw: 0.04, a: 0.001, d: 0.03, g: 0.6 });
  s.thump(0, 180, 110, 0.04, 0.04, 0.4);
});

def('match_start', 2, { stereo: true, vol: 0.85, variants: 1, prio: 10, ref: 1, max: 9999, rev: 'med', wet: 0.5 }, (s) => {
  s.voice({ src: 'saw', f0: 200, f1: 1600, sw: 0.75, a: 0.5, d: 0.05, g: 0.4, filt: [{ type: 'lowpass', f0: 250, f1: 4000, sw: 0.75, q: 1.5 }], dur: 0.8 });
  for (let i = 0; i < 3; i++) s.voice({ src: 'sine', t: i * 0.25, f0: 880, a: 0.003, d: 0.06, g: 0.45, send: 0.3 });
  s.thump(0.75, 80, 45, 0.3, 0.4, 1.3, { drive: 1.5 });
  s.voice({ src: 'white', t: 0.75, a: 0.001, d: 0.08, g: 0.7, filt: [{ type: 'lowpass', f0: 6000, f1: 400, sw: 0.3 }], drive: 2, send: 0.5 });
  for (const f of [220, 330, 440]) {
    s.voice({ src: 'saw', t: 0.75, f0: f, a: 0.01, d: 0.5, g: 0.28, filt: [{ type: 'lowpass', f0: 3000, f1: 800, sw: 0.8 }], send: 0.5 });
  }
});

def('match_end', 2.4, { stereo: true, vol: 0.85, variants: 1, prio: 10, ref: 1, max: 9999, rev: 'med', wet: 0.6 }, (s) => {
  s.voice({ src: 'saw', f0: 330, f1: 165, sw: 0.9, a: 0.01, d: 0.6, g: 0.35, filt: [{ type: 'lowpass', f0: 2500, f1: 500, sw: 1 }], send: 0.5 });
  s.voice({ src: 'saw', f0: 220, f1: 110, sw: 0.9, a: 0.01, d: 0.6, g: 0.35, filt: [{ type: 'lowpass', f0: 2500, f1: 500, sw: 1 }], send: 0.5 });
  s.voice({ src: 'sine', f0: 55, a: 0.01, d: 0.9, g: 1, drive: 1.5 });
  s.voice({ src: 'white', a: 0.005, d: 0.5, g: 0.4, filt: [{ type: 'lowpass', f0: 4000, f1: 300, sw: 1 }], send: 0.5 });
  s.thump(0, 100, 40, 0.3, 0.2, 1.1);
  for (let i = 0; i < 2; i++) s.voice({ src: 'sine', t: 0.9 + i * 0.3, f0: 660 - i * 110, a: 0.003, d: 0.15, g: 0.3, send: 0.4 });
});

// ---------------------------------------------------------------- game modes (Escalation / King of the Hill)

// Escalation: promoted (rising arpeggio + weapon-swap clack) / demoted (falling pair)
def('tier_up', 0.9, { stereo: true, vol: 0.8, variants: 1, prio: 10, ref: 1, max: 9999, rev: 'small', wet: 0.5 }, (s) => {
  [784, 1046.5, 1318.5, 1568].forEach((f, i) => s.note(i * 0.07, f, 0.5, 0.12 + i * 0.03, { send: 0.35 }));
  s.thump(0, 220, 90, 0.08, 0.06, 0.8);
  s.click(0.02, 3400, 0.35, 0.004, 1);
  s.voice({ src: 'saw', t: 0.26, f0: 523, a: 0.01, d: 0.16, g: 0.14, filt: [{ type: 'lowpass', f0: 2600, f1: 900, sw: 0.4 }], send: 0.4 });
});
def('tier_down', 0.7, { stereo: true, vol: 0.75, variants: 1, prio: 9, ref: 1, max: 9999, rev: 'small', wet: 0.4 }, (s) => {
  s.note(0, 622, 0.5, 0.1, { send: 0.3 });
  s.note(0.1, 415, 0.5, 0.18, { send: 0.3 });
  s.thump(0.1, 120, 55, 0.2, 0.15, 0.9);
  s.voice({ src: 'saw', t: 0.1, f0: 200, f1: 90, sw: 0.35, a: 0.01, d: 0.12, g: 0.18, filt: [{ type: 'lowpass', f0: 1500, f1: 300, sw: 0.4 }] });
});

// King of the Hill: zone relocation sweep, capture / lost stingers, contested pulse, point tick
def('hill_move', 1.3, { stereo: true, vol: 0.8, variants: 1, prio: 9, ref: 1, max: 9999, rev: 'med', wet: 0.55 }, (s) => {
  s.voice({ src: 'saw', f0: 110, f1: 660, sw: 0.7, a: 0.35, d: 0.12, g: 0.3, filt: [{ type: 'lowpass', f0: 300, f1: 3200, sw: 0.7, q: 1.4 }], dur: 0.85, send: 0.4 });
  s.voice({ src: 'white', a: 0.4, d: 0.15, g: 0.35, filt: [{ type: 'bandpass', f0: 500, f1: 4200, sw: 0.7, q: 0.9 }], dur: 0.85, send: 0.3 });
  s.thump(0.7, 90, 45, 0.25, 0.3, 1.1, { drive: 1.4 });
  s.note(0.72, 880, 0.35, 0.25, { send: 0.5 });
  s.note(0.72, 1318.5, 0.25, 0.3, { send: 0.5 });
});
def('hill_capture', 0.9, { stereo: true, vol: 0.75, variants: 1, prio: 9, ref: 1, max: 9999, rev: 'small', wet: 0.5 }, (s) => {
  s.note(0, 659, 0.5, 0.1, { send: 0.35 });
  s.note(0.09, 988, 0.55, 0.22, { send: 0.4 });
  s.thump(0, 160, 80, 0.1, 0.08, 0.7);
  s.voice({ src: 'sine', t: 0.09, f0: 1976, a: 0.004, d: 0.3, g: 0.12, send: 0.5 });
});
def('hill_lost', 0.9, { stereo: true, vol: 0.75, variants: 1, prio: 9, ref: 1, max: 9999, rev: 'small', wet: 0.45 }, (s) => {
  s.note(0, 392, 0.5, 0.12, { send: 0.3 });
  s.note(0.12, 277, 0.55, 0.25, { send: 0.3 });
  s.thump(0.12, 100, 50, 0.25, 0.2, 1);
  s.voice({ src: 'saw', t: 0.12, f0: 140, f1: 70, sw: 0.4, a: 0.01, d: 0.2, g: 0.16, filt: [{ type: 'lowpass', f0: 900, f1: 220, sw: 0.5 }] });
});
def('hill_contested', 0.55, { stereo: true, vol: 0.6, variants: 1, prio: 7, ref: 1, max: 9999, rev: 'small', wet: 0.3, cd: 0.8 }, (s) => {
  for (let i = 0; i < 2; i++) {
    s.voice({ src: 'sine', t: i * 0.16, f0: 740, a: 0.004, d: 0.06, g: 0.4, am: { rate: 22, depth: 0.5 }, send: 0.3 });
    s.thump(i * 0.16, 200, 120, 0.05, 0.05, 0.4);
  }
});
def('hill_tick', 0.2, { stereo: true, vol: 0.5, variants: 1, prio: 6, ref: 1, max: 9999, rev: 'small', wet: 0.2, cd: 0.25 }, (s) => {
  s.click(0, 2800, 0.5, 0.006, 1);
  s.voice({ src: 'sine', f0: 1320, a: 0.002, d: 0.035, g: 0.35 });
  s.thump(0, 240, 150, 0.03, 0.03, 0.35);
});

def('spawn', 1.1, { stereo: true, vol: 0.7, variants: 2, prio: 7, ref: 3, max: 90, rev: 'med', wet: 0.5 }, (s, r) => {
  s.voice({ src: 'white', a: 0.25, d: 0.2, g: 0.6, filt: [{ type: 'bandpass', f0: 300, f1: 2500, sw: 0.5, q: 0.8 }], send: 0.4 });
  s.voice({ src: 'sine', f0: 200, f1: 900, sw: 0.45, a: 0.2, d: 0.15, g: 0.4 });
  for (const [f, am] of [[1800, 9], [2700, 12], [3600, 15]]) {
    s.voice({ src: 'sine', f0: f, a: 0.3, d: 0.3, g: 0.09, am: { rate: am, depth: 0.9 }, send: 0.4 });
  }
  s.thump(0.42, 90, 50, 0.1, 0.1, 0.8);
  for (let i = 0; i < 6; i++) s.voice({ src: 'sine', t: 0.3 + r() * 0.5, f0: 3000 + r() * 3000, a: 0.001, d: 0.03, g: 0.1, pan: r() * 1.4 - 0.7, send: 0.4 });
});

const SOUND_NAMES = Object.keys(SOUNDS);

// ================================================================== rendering

/** Render every variation of a sound in ONE offline context (sequential slots) and slice them out. */
async function renderSound(def) {
  const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  const channels = def.stereo ? 2 : 1;
  const len = Math.ceil((def.dur + (def.loop ? def.xf : 0)) * SR);
  const slot = len + Math.ceil(0.06 * SR);
  const ctx = new OAC(channels, slot * def.variants, SR);
  let seed = 0x9e3779b9;
  for (let i = 0; i < def.name.length; i++) seed = Math.imul(seed ^ def.name.charCodeAt(i), 0x85ebca6b) >>> 0;
  const rnd = mulberry32(seed >>> 0);
  const synth = new Synth(ctx, rnd, def);
  for (let v = 0; v < def.variants; v++) {
    synth.base = (v * slot) / SR;
    synth.limit = ((v + 1) * slot) / SR;
    def.build(synth, rnd, v);
  }
  const all = await ctx.startRendering();
  const out = [];
  for (let v = 0; v < def.variants; v++) {
    const buf = new AudioBuffer({ length: len, numberOfChannels: channels, sampleRate: SR });
    for (let c = 0; c < channels; c++) buf.copyToChannel(all.getChannelData(c).subarray(v * slot, v * slot + len), c);
    postProcess(buf, def);
    out.push(buf);
  }
  return out;
}

function postProcess(buf, def) {
  const n = buf.length;
  const chans = [];
  for (let c = 0; c < buf.numberOfChannels; c++) chans.push(buf.getChannelData(c));
  const loopLen = Math.floor(def.dur * SR);
  if (def.loop) {
    const xf = Math.min(Math.floor(def.xf * SR), n - loopLen);
    for (const d of chans) {
      for (let i = 0; i < xf; i++) {
        const u = i / xf;
        d[i] = d[i] * Math.sin(u * Math.PI * 0.5) + d[loopLen + i] * Math.cos(u * Math.PI * 0.5);
      }
    }
  }
  const len = def.loop ? loopLen : n;
  let peak = 0;
  for (const d of chans) for (let i = 0; i < len; i++) { const v = Math.abs(d[i]); if (v > peak) peak = v; }
  const k = peak > 1e-6 ? def.level / peak : 0;
  const fade = Math.min(Math.floor(0.012 * SR), len >> 2);
  for (const d of chans) {
    for (let i = 0; i < len; i++) d[i] *= k;
    if (!def.loop) for (let i = 0; i < fade; i++) d[len - 1 - i] *= i / fade;
  }
  buf.__peak = peak;
}

// ================================================================== runtime

const NO_LOOP = { setVolume() {}, setRate() {}, setPosition() {}, stop() {} };
const _f = new THREE.Vector3();
const _u = new THREE.Vector3();

/** Procedural audio: pre-rendered synthesised sounds, 3D positional playback, loops, voice limiting. */
export class AudioSystem {
  constructor(game) {
    this.game = game;
    /** True once the pre-rendered buffers exist. */
    this.ready = false;
    /** False when WebAudio is unsupported (everything is a silent no-op). */
    this.enabled = typeof window !== 'undefined'
      && !!(window.OfflineAudioContext || window.webkitOfflineAudioContext)
      && !!(window.AudioContext || window.webkitAudioContext);
    /** @type {Map<string, AudioBuffer[]>} */
    this.buffers = new Map();
    this.stats = { sounds: 0, buffers: 0, bytes: 0, ms: 0 };
    this.masterVolume = 0.8;
    this.musicVolume = 0.6;
    /** Music state: track loads (name -> Promise<AudioBuffer|null>), the playing track, a token that cancels stale requests. */
    this._music = { loading: new Map(), current: null, token: 0 };
    this.ctx = null;
    this.voices = [];
    this.loops = new Set();
    this._warned = new Set();
    this._last = new Map();
    this._lastVar = new Map();
    this._hrtf = 0;
    this._pauseMuffle = 0;
    this._loopGain = 1;
    this._gesture = () => this._onGesture();
    if (this.enabled && typeof window !== 'undefined') {
      for (const ev of ['pointerdown', 'keydown', 'touchend']) window.addEventListener(ev, this._gesture, { capture: true, passive: true });
    }
  }

  /** Pre-render every sound with OfflineAudioContext (parallel batches). */
  async init() {
    if (!this.enabled) return;
    const t0 = performance.now();
    try {
      const results = new Array(SOUND_NAMES.length);
      let next = 0;
      const worker = async () => {
        while (next < SOUND_NAMES.length) {
          const i = next++;
          results[i] = await renderSound(SOUNDS[SOUND_NAMES[i]]);
        }
      };
      await Promise.all([worker(), worker(), worker(), worker(), worker(), worker()]);
      let bytes = 0, count = 0;
      SOUND_NAMES.forEach((name, i) => {
        this.buffers.set(name, results[i]);
        for (const b of results[i]) { bytes += b.length * b.numberOfChannels * 4; count++; }
      });
      this.stats = { sounds: this.buffers.size, buffers: count, bytes, ms: Math.round(performance.now() - t0) };
      this.ready = true;
    } catch (err) {
      this.enabled = false;
      console.error('[audio] sound synthesis failed; audio disabled', err);
    }
  }

  /** Create / resume the AudioContext. Safe to call repeatedly; call from user gestures. */
  unlock() {
    if (!this.enabled) return;
    if (!this.ctx) this._createContext();
    const ctx = this.ctx;
    if (ctx && ctx.state !== 'running' && typeof ctx.resume === 'function') {
      try {
        const p = ctx.resume();
        if (p && p.catch) p.catch(() => {});
      } catch { /* not allowed yet - a later gesture retries */ }
    }
  }

  _onGesture() {
    this.unlock();
    if (this.ctx && this.ctx.state === 'running') {
      for (const ev of ['pointerdown', 'keydown', 'touchend']) window.removeEventListener(ev, this._gesture, { capture: true });
    }
  }

  _createContext() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) { this.enabled = false; return; }
    let ctx = null;
    try {
      ctx = new AC({ latencyHint: 'interactive' });
    } catch {
      try { ctx = new AC(); } catch (err) {
        this.enabled = false;
        console.warn('[audio] AudioContext unavailable; sound disabled', err && err.message);
        return;
      }
    }
    this.ctx = ctx;
    const master = ctx.createGain();
    master.gain.value = this._gain(this.masterVolume);
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.knee.value = 12;
    comp.ratio.value = 5;
    comp.attack.value = 0.002;
    comp.release.value = 0.14;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 20000;
    lp.Q.value = 0.5;
    const sfx = ctx.createGain();
    const loopBus = ctx.createGain();
    sfx.connect(master);
    loopBus.connect(master);
    master.connect(comp);
    comp.connect(lp);
    lp.connect(ctx.destination);
    // music skips the effects compressor (gunfire would pump it) and the pause muffle; it follows master volume
    const musicOut = ctx.createGain();
    musicOut.gain.value = this._musicGain();
    musicOut.connect(ctx.destination);
    this.musicOut = musicOut;
    this.master = master;
    this.sfx = sfx;
    this.loopBus = loopBus;
    this.muffle = lp;
  }

  _gain(v) {
    return Math.pow(Math.max(0, Math.min(1, v)), 1.5);
  }

  /** Master volume 0..1. */
  setMasterVolume(v) {
    this.masterVolume = Number.isFinite(v) ? v : 0.8;
    if (this.master) this.master.gain.setTargetAtTime(this._gain(this.masterVolume), this.ctx.currentTime, 0.02);
    if (this.musicOut) this.musicOut.gain.setTargetAtTime(this._musicGain(), this.ctx.currentTime, 0.02);
  }

  /** Music volume 0..1 (on top of the master volume). */
  setMusicVolume(v) {
    this.musicVolume = Number.isFinite(v) ? v : 0.6;
    if (this.musicOut) this.musicOut.gain.setTargetAtTime(this._musicGain(), this.ctx.currentTime, 0.02);
  }

  _musicGain() {
    return this._gain(this.masterVolume) * this._gain(this.musicVolume);
  }

  // ---------------------------------------------------------------- music

  /**
   * Play a music track (MUSIC_TRACKS key), fading out whatever plays now. A looping track that is already playing
   * keeps going. Safe before the first user gesture: the context starts suspended and the track begins once it runs.
   * @param {string} name
   * @param {{loop?: boolean, fadeIn?: number}} [o]
   */
  playMusic(name, { loop = true, fadeIn = 0.8 } = {}) {
    if (!this.enabled || !MUSIC_TRACKS[name]) return;
    const m = this._music;
    if (m.current && m.current.name === name && m.current.loop && loop) return;
    this.stopMusic(0.8);
    const token = m.token;
    this.unlock();
    this._loadMusic(name).then(buf => {
      const ctx = this.ctx;
      if (!buf || !ctx || token !== m.token) return;
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = loop;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, ctx.currentTime);
      g.gain.linearRampToValueAtTime(1, ctx.currentTime + fadeIn);
      src.connect(g);
      g.connect(this.musicOut);
      const cur = { name, loop, src, gain: g };
      src.onended = () => {
        if (m.current === cur) m.current = null;
        try { g.disconnect(); } catch { /* already gone */ }
      };
      src.start();
      m.current = cur;
    });
  }

  /** Fade the current track out; a track that is still loading will not start. @param {number} [fade] seconds */
  stopMusic(fade = 0.8) {
    const m = this._music;
    m.token++;
    const cur = m.current;
    m.current = null;
    if (!cur || !this.ctx) return;
    const t = this.ctx.currentTime;
    const gp = cur.gain.gain;
    gp.cancelScheduledValues(t);
    gp.setValueAtTime(gp.value, t);
    gp.linearRampToValueAtTime(0, t + fade);
    try { cur.src.stop(t + fade + 0.05); } catch { /* already stopped */ }
  }

  /** Fetch + decode tracks ahead of time (e.g. victory / defeat while a match loads). @param {string[]} names */
  preloadMusic(names) {
    if (!this.enabled) return;
    this.unlock();
    for (const n of names) if (MUSIC_TRACKS[n]) this._loadMusic(n);
  }

  /** @returns {Promise<AudioBuffer|null>} the decoded track (null when it is missing or cannot be decoded) */
  _loadMusic(name) {
    const m = this._music;
    let p = m.loading.get(name);
    if (!p) {
      p = fetch(MUSIC_TRACKS[name])
        .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.arrayBuffer(); })
        .then(data => this.ctx.decodeAudioData(data))
        .catch(err => { console.warn(`[audio] music '${name}' unavailable:`, err && err.message); return null; });
      m.loading.set(name, p);
    }
    return p;
  }

  _warnUnknown(name) {
    if (this._warned.has(name)) return;
    this._warned.add(name);
    console.warn(`[audio] unknown sound '${name}'`);
  }

  _pickBuffer(def, list) {
    const n = list.length;
    let i = Math.floor(Math.random() * n);
    if (n > 1) {
      const last = this._lastVar.get(def.name);
      if (i === last) i = (i + 1 + Math.floor(Math.random() * (n - 1))) % n;
      this._lastVar.set(def.name, i);
    }
    return list[i];
  }

  _setPannerPos(pn, p) {
    if (pn.positionX) {
      pn.positionX.value = p.x;
      pn.positionY.value = p.y;
      pn.positionZ.value = p.z;
    } else {
      pn.setPosition(p.x, p.y, p.z);
    }
  }

  _makePanner(def, position, dist) {
    const ctx = this.ctx;
    const pn = ctx.createPanner();
    const hrtf = this._hrtf < 10;
    pn.panningModel = hrtf ? 'HRTF' : 'equalpower';
    pn.distanceModel = 'inverse';
    pn.refDistance = def.ref;
    pn.rolloffFactor = def.roll;
    pn.maxDistance = 100000;
    this._setPannerPos(pn, position);
    pn._hrtf = hrtf;
    return pn;
  }

  /**
   * Play a one-shot. With `position` (Vector3-like) it is spatialised (distance attenuation, panning,
   * air-absorption low-pass). Returns a voice handle ({stop()}) or null when nothing was played.
   */
  play(name, { position = null, volume = 1, rate = 1 } = {}) {
    const def = SOUNDS[name];
    if (!def) { this._warnUnknown(name); return null; }
    const ctx = this.ctx;
    if (!ctx || !this.ready || ctx.state !== 'running') return null;
    const list = this.buffers.get(name);
    if (!list) return null;
    const now = ctx.currentTime;
    if (def.cd > 0) {
      const last = this._last.get(name);
      if (last !== undefined && now - last < def.cd) return null;
    }
    let dist = 0;
    if (position) {
      const cp = this.game.camera.position;
      const dx = position.x - cp.x, dy = position.y - cp.y, dz = position.z - cp.z;
      dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (dist > def.max) return null;
      // inaudible after distance attenuation
      const att = def.ref / (def.ref + def.roll * Math.max(0, dist - def.ref));
      if (att * volume * def.vol < 0.006) return null;
    }
    // per-name instance cap + global voice limit (steal the lowest priority / oldest)
    let inst = 0;
    for (let i = 0; i < this.voices.length; i++) if (this.voices[i].name === name) inst++;
    if (inst >= def.maxInst) return null;
    if (this.voices.length >= MAX_VOICES) {
      let victim = null;
      for (const v of this.voices) {
        if (!victim || v.prio < victim.prio || (v.prio === victim.prio && v.start < victim.start)) victim = v;
      }
      if (victim.prio > def.prio) return null;
      this._stopVoice(victim, 0.008);
    }
    this._last.set(name, now);

    const buf = this._pickBuffer(def, list);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate * (1 + (Math.random() * 2 - 1) * def.pitchVar);
    const gain = ctx.createGain();
    gain.gain.value = volume * def.vol * (0.9 + Math.random() * 0.2);
    src.connect(gain);
    let node = gain;
    let panner = null;
    let lp = null;
    if (position) {
      if (dist > 25) {
        lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = Math.max(2200, 18000 / (1 + (dist - 25) / 45));
        lp.Q.value = 0.4;
        node.connect(lp);
        node = lp;
      }
      panner = this._makePanner(def, position, dist);
      if (panner._hrtf) this._hrtf++;
      node.connect(panner);
      node = panner;
    }
    node.connect(this.sfx);
    const voice = { name, src, gain, panner, lp, prio: def.prio, start: now, stopped: false };
    src.onended = () => this._releaseVoice(voice);
    this.voices.push(voice);
    src.start(now);
    return voice;
  }

  _stopVoice(v, fade = 0.02) {
    if (v.stopped) return;
    v.stopped = true;
    // leave the active list immediately (the source node is released when it actually ends)
    const i = this.voices.indexOf(v);
    if (i >= 0) {
      this.voices[i] = this.voices[this.voices.length - 1];
      this.voices.pop();
    }
    const t = this.ctx.currentTime;
    try {
      v.gain.gain.cancelScheduledValues(t);
      v.gain.gain.setTargetAtTime(0, t, fade * 0.4);
      v.src.stop(t + fade * 2);
    } catch { /* already ended */ }
  }

  _releaseVoice(v) {
    const i = this.voices.indexOf(v);
    if (i >= 0) {
      this.voices[i] = this.voices[this.voices.length - 1];
      this.voices.pop();
    }
    if (v.panner && v.panner._hrtf) this._hrtf = Math.max(0, this._hrtf - 1);
    v.src.onended = null;
    try {
      v.src.disconnect();
      v.gain.disconnect();
      if (v.lp) v.lp.disconnect();
      if (v.panner) v.panner.disconnect();
    } catch { /* ignore */ }
  }

  /**
   * Start a looping sound (slide, wallrun, grapple_reel, rocket_loop). Returns a handle with
   * setVolume(v), setRate(r), setPosition(v3), stop().
   */
  playLoop(name, { volume = 1, rate = 1, position = null } = {}) {
    const def = SOUNDS[name];
    if (!def) { this._warnUnknown(name); return NO_LOOP; }
    const ctx = this.ctx;
    if (!ctx || !this.ready) return NO_LOOP;
    const list = this.buffers.get(name);
    if (!list || !def.loop) {
      if (!def.loop && !this._warned.has(name + ':loop')) {
        this._warned.add(name + ':loop');
        console.warn(`[audio] '${name}' is not a loop sound`);
      }
      return NO_LOOP;
    }
    const src = ctx.createBufferSource();
    src.buffer = list[Math.floor(Math.random() * list.length)];
    src.loop = true;
    src.loopStart = 0;
    src.loopEnd = def.dur;
    src.playbackRate.value = rate;
    const gain = ctx.createGain();
    const now = ctx.currentTime;
    gain.gain.setValueAtTime(0, now);
    gain.gain.setTargetAtTime(volume * def.vol, now, 0.04);
    src.connect(gain);
    let panner = null;
    if (position) {
      panner = this._makePanner(def, position, 0);
      gain.connect(panner);
      panner.connect(this.loopBus);
    } else {
      gain.connect(this.loopBus);
    }
    src.start(now, Math.random() * def.dur * 0.9);
    let stopped = false;
    let lastVol = volume, lastRate = rate;
    const loop = {
      setVolume: (v) => {
        if (stopped || Math.abs(v - lastVol) < 0.004) return;
        lastVol = v;
        gain.gain.setTargetAtTime(v * def.vol, ctx.currentTime, 0.05);
      },
      setRate: (r) => {
        if (stopped || Math.abs(r - lastRate) < 0.004) return;
        lastRate = r;
        src.playbackRate.setTargetAtTime(r, ctx.currentTime, 0.06);
      },
      setPosition: (p) => {
        if (stopped || !panner || !p) return;
        this._setPannerPos(panner, p);
      },
      stop: () => {
        if (stopped) return;
        stopped = true;
        this.loops.delete(loop);
        const t = ctx.currentTime;
        try {
          gain.gain.cancelScheduledValues(t);
          gain.gain.setTargetAtTime(0, t, 0.03);
          src.stop(t + 0.15);
        } catch { /* ignore */ }
        src.onended = () => {
          try { src.disconnect(); gain.disconnect(); if (panner) panner.disconnect(); } catch { /* ignore */ }
        };
      },
    };
    this.loops.add(loop);
    return loop;
  }

  /** Stop every loop (match end / quit). */
  stopAllLoops() {
    for (const l of Array.from(this.loops)) l.stop();
  }

  /** Update the listener from game.camera; muffles the mix while paused and mutes loops outside play. */
  update(dt) {
    const ctx = this.ctx;
    if (!ctx) return;
    const cam = this.game.camera;
    const L = ctx.listener;
    const p = cam.position;
    _f.set(0, 0, -1).applyQuaternion(cam.quaternion);
    _u.set(0, 1, 0).applyQuaternion(cam.quaternion);
    if (L.positionX) {
      L.positionX.value = p.x; L.positionY.value = p.y; L.positionZ.value = p.z;
      L.forwardX.value = _f.x; L.forwardY.value = _f.y; L.forwardZ.value = _f.z;
      L.upX.value = _u.x; L.upY.value = _u.y; L.upZ.value = _u.z;
    } else {
      L.setPosition(p.x, p.y, p.z);
      L.setOrientation(_f.x, _f.y, _f.z, _u.x, _u.y, _u.z);
    }
    if (!this.muffle) return;
    const st = this.game.state;
    const wantMuffle = st === 'paused' ? 1 : 0;
    // 'ended' keeps loops only for the slow-mo tail (game._endTimer > 0); the results screen is silent.
    const wantLoops = st === 'playing' || (st === 'ended' && this.game._endTimer > 0) ? 1 : 0;
    const k = 1 - Math.exp(-8 * Math.min(dt, 0.1));
    this._pauseMuffle += (wantMuffle - this._pauseMuffle) * k;
    this._loopGain += (wantLoops - this._loopGain) * k;
    this.muffle.frequency.value = 20000 * Math.pow(650 / 20000, this._pauseMuffle);
    this.loopBus.gain.value = this._loopGain;
  }

  /** Test / tooling access to the pre-rendered buffers. */
  getBuffers(name) {
    return this.buffers.get(name) || [];
  }
}

/** Names of every sound (for tools/tests). */
export const SOUND_LIST = SOUND_NAMES.slice();
export const LOOP_SOUNDS = SOUND_NAMES.filter(n => SOUNDS[n].loop);
