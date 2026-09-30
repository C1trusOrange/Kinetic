
// ------------------------------------------------------------------ material registry

/** name -> { surface, scale (m per repeat), size (px), emissive (bool), gen(S, name) } */
const DEFS = Object.create(null);
function def(name, surface, scale, size, gen, extra = {}) {
  DEFS[name] = { surface, scale, size, gen, emissive: false, ...extra };
}

// ------------------------------------------------------------------ concrete family

const CONCRETE_DEFAULTS = {
  seed: 1, ox: 0, oy: 0, base: [0.5, 0.49, 0.46], contrast: 1, tint: 0.07,
  stain: 0.3, stainC: [0.3, 0.28, 0.25], stainLo: 0.66, streak: 0.7, form: 1,
  seam: 'panel', panels: 2, seamDepth: 0.5, crackAmt: 1, crackW: 1, crackLen: 190,
  pores: 1, aggregate: 1, oil: 0, peel: 0, rough: 0.86, ns: 2.6,
};

function concreteGen(S, opt) {
  const o = { ...CONCRETE_DEFAULTS, ...opt };
  const B = bank(S), N = S * S, q = S / 512;
  const { blot, mid, fine, grain, streakV: sV, streakH: sH } = B;
  const g = sampler(S, o.ox, o.oy);
  const rng = mulberry32(o.seed * 131 + 7);
  const H = new Field(S), hd = H.data;
  const T = new Float32Array(N), pm = new Float32Array(N);
  const ca = o.crackAmt > 0 ? crackMask(S, rng, { count: Math.round(o.crackAmt * 7), len: o.crackLen, width: 1.5 * o.crackW, branch: 0.5 }) : new Float32Array(N);

  for (let y = 0, i = 0; y < S; y++) {
    for (let x = 0; x < S; x++, i++) {
      let h = 0.5 + 0.12 * (g(mid, x, y) - 0.5) + 0.07 * (g(fine, x, y) - 0.5) + 0.09 * (grain[i] - 0.5);
      if (ca[i] > 0) h -= ca[i] * 0.34;
      if (o.peel > 0) {
        const p = sstep(0.83, 0.85, g(blot, x, y, 131, 257) + (g(mid, x, y) - 0.5) * 0.14) * o.peel;
        pm[i] = p; h -= p * 0.2;
      }
      hd[i] = h;
    }
  }
  if (o.pores > 0) {
    scatter(S, (N / 650 * o.pores) | 0, rng, (cx, cy) => stamp(H, T, cx, cy, (0.7 + rng() * 1.5) * Math.max(q, 0.6), -0.35, -0.42, 'add'));
  }
  if (o.aggregate > 0) {
    scatter(S, (N / 1400 * o.aggregate) | 0, rng, (cx, cy) => stamp(H, T, cx, cy, (1.3 + rng() * 2) * Math.max(q, 0.6), 0.06, (rng() - 0.45) * 0.4, 'add'));
  }
  const step = S / o.panels;
  if (o.seam === 'panel') {
    for (let k = 0; k < o.panels; k++) {
      H.line(k * step, 0, k * step, S, 2.2 * q, -o.seamDepth, { mode: 'add', soft: 1 });
      H.line(0, k * step, S, k * step, 2.2 * q, -o.seamDepth, { mode: 'add', soft: 1 });
      for (let j = 0; j < o.panels; j++) {
        for (const [a, b] of [[0.2, 0.2], [0.8, 0.2], [0.2, 0.8], [0.8, 0.8]]) {
          stamp(H, T, (k + a) * step, (j + b) * step, 3.4 * q, -0.9, -0.55, 'add');
          stamp(H, null, (k + a) * step, (j + b) * step, 5.2 * q, 0.06, 0, 'add');
        }
      }
    }
  } else if (o.seam === 'slab') {
    for (let k = 0; k < o.panels; k++) {
      H.line(k * step, 0, k * step, S, 4 * q, -o.seamDepth * 1.4, { mode: 'add', soft: 1.5 });
      H.line(0, k * step, S, k * step, 4 * q, -o.seamDepth * 1.4, { mode: 'add', soft: 1.5 });
    }
  }
  const cav = cavity(H, Math.max(2, Math.round(3 * q)));

  const px = runPass(S, (x, y, i, c) => {
    const b1 = g(blot, x, y), m1 = g(mid, x, y), f1 = g(fine, x, y);
    let v = 1 + o.contrast * ((b1 - 0.5) * 0.5 + (m1 - 0.5) * 0.5 + (f1 - 0.5) * 0.42) + (grain[i] - 0.5) * 0.2 + (g(fine, x * 3, y * 3, 55, 17) - 0.5) * 0.14 + T[i];
    if (o.seam === 'slab') {
      const sid = ((x / step) | 0) + o.panels * ((y / step) | 0);
      v *= 0.92 + 0.15 * hash(sid, o.seed);
    }
    v *= 1 + 0.06 * o.form * (g(sH, x, y) - 0.5);
    const w = (g(blot, x, y, 171, 53) - 0.5) * o.tint;
    c[0] = o.base[0] * v * (1 + w); c[1] = o.base[1] * v; c[2] = o.base[2] * v * (1 - w);
    let rough = o.rough + 0.1 * (m1 - 0.5) + 0.07 * (f1 - 0.5);
    const st = sstep(o.stainLo, o.stainLo + 0.14, g(blot, x, y, 331, 157)) * o.stain;
    if (st > 0) { towardC(c, o.stainC, st * 0.45); rough -= st * 0.06; }
    const sk = sstep(0.55, 0.92, g(sV, x, y)) * o.streak;
    if (sk > 0) { scaleC(c, 1 - 0.3 * sk); c[0] *= 1.02; c[2] *= 0.96; }
    if (o.oil > 0) {
      const oi = sstep(0.7, 0.735, g(blot, x, y, 71, 391)) * sstep(0.42, 0.6, m1) * o.oil;
      if (oi > 0) { scaleC(c, 1 - 0.45 * oi); c[2] *= 1 + 0.08 * oi; rough = rough + (0.32 - rough) * oi; }
    }
    if (pm[i] > 0) { toward(c, 0.5, 0.46, 0.41, pm[i]); rough += 0.06 * pm[i]; }
    const a = ca[i];
    if (a > 0) { scaleC(c, 1 - 0.5 * a); rough += 0.08 * a; }
    scaleC(c, Math.min(1.25, Math.max(0.6, 1 + cav[i] * 1.6)));
    c[3] = rough;
  });
  return finish(H, px, { ns: o.ns });
}

def('concrete', 'concrete', 3, 512, S => concreteGen(S, { seed: 1, ox: 0, oy: 0 }));
def('concrete_dark', 'concrete', 3, 512, S => concreteGen(S, {
  seed: 2, ox: 211, oy: 97, base: [0.275, 0.278, 0.283], contrast: 1.15, stain: 0.55, stainC: [0.09, 0.09, 0.1],
  stainLo: 0.6, streak: 0.6, seamDepth: 0.4, crackAmt: 0.8, rough: 0.8, tint: 0.09,
}));
def('concrete_floor', 'concrete', 4, 512, S => concreteGen(S, {
  seed: 3, ox: 97, oy: 311, base: [0.47, 0.46, 0.44], contrast: 0.9, stain: 0.4, streak: 0.12, seam: 'slab',
  panels: 2, oil: 0.55, crackAmt: 0.9, crackLen: 240, rough: 0.78, form: 0.2, aggregate: 1.6,
}));
def('plaster', 'concrete', 2.5, 512, S => concreteGen(S, {
  seed: 4, ox: 401, oy: 33, base: [0.8, 0.765, 0.69], contrast: 0.4, stain: 0.35, stainC: [0.5, 0.44, 0.36],
  stainLo: 0.68, streak: 0.22, seam: 'none', peel: 0.9, pores: 0.5, aggregate: 0.2, form: 0, crackW: 0.7, crackAmt: 0.8, rough: 0.9, tint: 0.05, ns: 2.2,
}));

// ------------------------------------------------------------------ asphalt

function asphaltGen(S) {
  const B = bank(S), N = S * S, q = S / 512;
  const { blot, mid, fine, grain } = B;
  const g = sampler(S, 71, 233);
  const rng = mulberry32(4242);
  const H = new Field(S), hd = H.data, T = new Float32Array(N).fill(-1);
  const seal = crackMask(S, rng, { count: 3, len: 300, width: 4.2, branch: 0.25, jitter: 0.16 });
  const hair = crackMask(S, rng, { count: 6, len: 160, width: 1.3, branch: 0.4 });
  for (let i = 0; i < N; i++) hd[i] = 0.12 + 0.08 * (mid[i] - 0.5) + 0.05 * (fine[i] - 0.5);
  scatter(S, (N / 15) | 0, rng, (cx, cy) => {
    const r = (1 + rng() * rng() * 3.4) * Math.max(q, 0.6);
    stamp(H, T, cx, cy, r, 0.3 + rng() * 0.45, rng(), 'max', 0.4);
  });
  for (let i = 0; i < N; i++) { const s = seal[i]; if (s > 0) { hd[i] += (0.3 - hd[i]) * s; T[i] = -1; } hd[i] -= hair[i] * 0.3; }
  const cav = cavity(H, 2);
  const stone = ramp([[0, '#2b2b2f'], [0.3, '#4a4a4f'], [0.55, '#5f5f65'], [0.78, '#6d6458'], [0.93, '#85827b'], [1, '#9c988f']]);
  const px = runPass(S, (x, y, i, c) => {
    const b1 = g(blot, x, y), m1 = g(mid, x, y);
    const vv = 0.9 + 0.3 * (b1 - 0.5) + 0.25 * (m1 - 0.5) + (grain[i] - 0.5) * 0.18;
    let rough = 0.93;
    if (T[i] >= 0) {
      stone(T[i], c, vv);
    } else {
      c[0] = 0.12 * vv; c[1] = 0.12 * vv; c[2] = 0.13 * vv;
      rough = 0.97;
    }
    const bl = sstep(0.55, 0.75, g(blot, x, y, 301, 45));
    toward(c, 0.46, 0.46, 0.47, bl * 0.3 * (T[i] >= 0 ? 1 : 0.3));
    const sl = seal[i];
    if (sl > 0) { toward(c, 0.035, 0.035, 0.04, sl * 0.92); rough += (0.28 - rough) * sl; }
    if (hair[i] > 0) scaleC(c, 1 - 0.65 * hair[i]);
    const oi = sstep(0.7, 0.74, g(blot, x, y, 5, 391)) * sstep(0.4, 0.55, m1);
    if (oi > 0) { scaleC(c, 1 - 0.45 * oi); rough += (0.36 - rough) * oi; }
    scaleC(c, Math.min(1.3, Math.max(0.6, 1 + cav[i] * 1.6)));
    c[3] = rough;
  });
  return finish(H, px, { ns: 3.2 });
}
def('asphalt', 'concrete', 4, 512, S => asphaltGen(S));
