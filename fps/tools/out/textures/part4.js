
// ------------------------------------------------------------------ steel plates (panel, dark, painted)

const PLATE_DEFAULTS = {
  seed: 1, ox: 0, oy: 0, base: [0.36, 0.4, 0.45], metal: 0.6, rough: 0.42, tone: 0.14, brush: 1, grime: 1,
  wear: 1, chipT: 0.8, chipEdge: 0.25, gap: 1.4, bev: 5, step: 0.05, recess: 0, recessInset: 24, vents: 0,
  rivet: null, drips: 0.5, dripAmt: 0.55, scratch: 10, ns: 3.2,
};

function plateGen(S, opt) {
  const o = { ...PLATE_DEFAULTS, ...opt };
  const B = bank(S), q = S / 512, N = S * S;
  const { mid, fine, grain, blot, streakH: sH } = B;
  const g = sampler(S, o.ox, o.oy);
  const rng = mulberry32(o.seed * 613 + 5);
  const C = buildCells(S, o.layout(S, rng));
  const gap = o.gap * q, bev = o.bev * q;
  const H = new Field(S), hd = H.data;
  const chip = new Float32Array(N), slot = new Float32Array(N), dr = new Float32Array(N);
  const tTop = new Float32Array(C.blocks.length), tRec = new Uint8Array(C.blocks.length), tVent = new Uint8Array(C.blocks.length), tTone = new Float32Array(C.blocks.length);
  for (let k = 0; k < tTop.length; k++) {
    tTop[k] = 0.82 + o.step * (hash(k, 7) - 0.5);
    tRec[k] = o.recess > 0 && hash(k, 8) < o.recess ? 1 : 0;
    tVent[k] = o.vents > 0 && hash(k, 9) < o.vents ? 1 : 0;
    tTone[k] = 1 + (hash(k, 2) - 0.5) * o.tone;
  }
  const sc = o.scratch > 0 ? crackMask(S, rng, { count: o.scratch, len: 60, width: 1.1, branch: 0, jitter: 0.05 }) : null;

  for (let y = 0, i = 0; y < S; y++) {
    for (let x = 0; x < S; x++, i++) {
      const id = C.id[i], e = C.ed[i];
      const t = sstep(gap, gap + bev, e);
      const top = tTop[id];
      let h = 0.06 + (top - 0.06) * t;
      h += t * (0.02 * (g(fine, x, y) - 0.5) + 0.03 * o.brush * (g(sH, x, y) - 0.5));
      if (tRec[id]) h -= 0.1 * sstep(0, 3 * q, e - o.recessInset * q) * t;
      if (tVent[id]) {
        const lu = C.lu[i], vv = (C.lv[i] - 0.3) / 0.4;
        if (vv > 0 && vv < 1 && lu > 0.22 && lu < 0.78) {
          const k5 = vv * 5, f = k5 - Math.floor(k5);
          const s = sstep(0.2, 0.3, f) * (1 - sstep(0.7, 0.8, f)) * sstep(0.22, 0.26, lu) * (1 - sstep(0.74, 0.78, lu));
          slot[i] = s; h -= 0.45 * s;
        }
      }
      if (o.chipT < 1) {
        const n = 0.45 * g(fine, x, y, 31, 77) + 0.35 * g(mid, x, y, 5, 201) + 0.2 * g(blot, x, y, 111, 9) + (1 - sstep(0, 16 * q, e)) * o.chipEdge;
        const ch = sstep(o.chipT, o.chipT + 0.035, n);
        chip[i] = ch; h -= 0.12 * ch * t;
      }
      if (sc && sc[i] > 0) h -= 0.05 * sc[i];
      hd[i] = h;
    }
  }
  if (o.rivet) {
    const ins = o.rivet.inset * q, sp = o.rivet.spacing * q, r = o.rivet.r * q;
    const pts = [];
    for (const b of C.blocks) {
      const nx = Math.max(1, Math.round((b.w - 2 * ins) / sp)), ny = Math.max(1, Math.round((b.h - 2 * ins) / sp));
      for (let k = 0; k <= nx; k++) { const x = b.x + ins + (b.w - 2 * ins) * k / nx; pts.push([x, b.y + ins], [x, b.y + b.h - ins]); }
      for (let k = 1; k < ny; k++) { const y = b.y + ins + (b.h - 2 * ins) * k / ny; pts.push([b.x + ins, y], [b.x + b.w - ins, y]); }
    }
    for (const [x, y] of pts) {
      stamp(H, null, x, y, r, o.rivet.h, 0, 'add');
      if (o.rivet.slot) stamp(H, null, x, y, r * 0.45, -o.rivet.h * 0.6, 0, 'add');
      if (rng() < o.drips) {
        const len = (18 + rng() * 50) * q;
        let wob = 0;
        for (let s = 0; s < len; s++) {
          const a = Math.pow(1 - s / len, 1.6);
          wob += (rng() - 0.5) * 0.25;
          const xx = x + wob, yy = (((Math.floor(y + r + s)) % S) + S) % S;
          for (let dx = -1; dx <= 1; dx++) {
            const pxx = ((Math.floor(xx) + dx) % S + S) % S;
            const w = Math.max(0, 1 - Math.abs(pxx + 0.5 - xx) / 1.6);
            const v = a * w * 0.9, k = yy * S + pxx;
            if (v > dr[k]) dr[k] = v;
          }
        }
      }
    }
  }
  const cav = cavity(H, Math.max(2, Math.round(3 * q)));
  const px = runPass(S, (x, y, i, c) => {
    const id = C.id[i], e = C.ed[i];
    const t = sstep(gap - 0.5, gap + 0.5, e);
    const f1 = g(fine, x, y), m1 = g(mid, x, y);
    const v = tTone[id] * (1 + (m1 - 0.5) * 0.2 + (g(sH, x, y) - 0.5) * 0.14 * o.brush + (grain[i] - 0.5) * 0.07);
    setC(c, o.base, v);
    let rough = o.rough + 0.14 * (f1 - 0.5), metal = o.metal;
    scaleC(c, 1 - 0.3 * o.grime * (1 - sstep(1.5 * q, 16 * q, e)));
    if (dr[i] > 0) { toward(c, 0.24, 0.13, 0.07, dr[i] * o.dripAmt); rough += 0.2 * dr[i]; }
    const ch = chip[i];
    if (ch > 0) {
      const rr = sstep(0.35, 0.65, g(mid, x, y, 77, 19));
      toward(c, 0.2 + 0.26 * rr, 0.2 + 0.02 * rr, 0.22 - 0.13 * rr, ch);
      rough += (0.55 + 0.35 * rr - rough) * ch;
      metal += (0.9 - 0.75 * rr - metal) * ch;
      scaleC(c, 1 + 0.35 * ch * (1 - ch) * 4);
    }
    const cv = cav[i];
    if (cv > 0.012 && o.wear > 0) {
      const w = sstep(0.012, 0.04, cv) * sstep(0.3, 0.55, f1 + 0.15) * o.wear;
      toward(c, 0.62, 0.63, 0.66, w * 0.85);
      metal += (0.92 - metal) * w; rough += (0.28 - rough) * w;
    }
    if (sc && sc[i] > 0) { toward(c, 0.7, 0.7, 0.72, sc[i] * 0.55); rough -= 0.15 * sc[i]; metal += (0.9 - metal) * sc[i]; }
    if (slot[i] > 0) { toward(c, 0.012, 0.012, 0.016, slot[i]); rough += (0.9 - rough) * slot[i]; metal *= 1 - slot[i]; }
    if (t < 1) { scaleC(c, 0.3 + 0.7 * t); rough += (0.9 - rough) * (1 - t); }
    scaleC(c, Math.min(1.3, Math.max(0.5, 1 + cv * 2.2)));
    c[3] = rough < 0.05 ? 0.05 : rough > 1 ? 1 : rough; c[4] = metal < 0 ? 0 : metal > 1 ? 1 : metal;
  });
  return finish(H, px, { ns: o.ns, metalMap: true });
}

def('metal_panel', 'metal', 2, 512, S => plateGen(S, {
  seed: 1, ox: 0, oy: 0, base: [0.37, 0.41, 0.46], metal: 0.6, rough: 0.42, tone: 0.16, chipT: 0.8, drips: 0.55, wear: 0.6,
  rivet: { inset: 15, spacing: 31, r: 3.5, h: 0.24 },
  layout: (S, rng) => rowLayout(S, [1, 1], [2, 2], rng, [0.85, 1.2]),
}));
def('metal_dark', 'metal', 2, 512, S => plateGen(S, {
  seed: 2, ox: 143, oy: 71, wear: 0.6, base: [0.23, 0.24, 0.265], metal: 0.7, rough: 0.5, tone: 0.34, chipT: 0.86, recess: 0.55,
  recessInset: 22, vents: 0.3, drips: 0.2, scratch: 16, gap: 1.2, bev: 4, step: 0.08,
  rivet: { inset: 17, spacing: 120, r: 4.6, h: 0.3, slot: true },
  layout: (S) => gridLayout(S, 4),
}));
def('metal_painted_yellow', 'metal', 2, 512, S => plateGen(S, {
  seed: 3, ox: 271, oy: 311, base: [0.95, 0.73, 0.07], metal: 0.06, rough: 0.42, tone: 0.07, brush: 0.2, chipT: 0.67,
  chipEdge: 0.25, wear: 0.45, drips: 0.3, grime: 0.7, scratch: 22, gap: 1.5, bev: 5, step: 0.04,
  rivet: { inset: 16, spacing: 36, r: 3.4, h: 0.22 },
  layout: (S) => gridLayout(S, 2),
}));

// ------------------------------------------------------------------ rusty steel

def('metal_rust', 'metal', 2, 512, S => {
  const B = bank(S), q = S / 512, N = S * S;
  const { mid, fine, grain, blot, ridge, streakV: sV } = B;
  const g = sampler(S, 331, 127);
  const rng = mulberry32(3131);
  const C = buildCells(S, gridLayout(S, 2));
  const H = new Field(S), hd = H.data;
  const paintM = new Float32Array(N), rustM = new Float32Array(N);
  for (let y = 0, i = 0; y < S; y++) {
    for (let x = 0; x < S; x++, i++) {
      const a = 0.5 * g(blot, x, y) + 0.5 * g(mid, x, y, 40, 90);
      const p = sstep(0.49, 0.515, a);
      const streak = sstep(0.6, 0.92, g(sV, x, y)) * 0.25;
      const r = sstep(0.36, 0.62, 0.55 * g(blot, x, y, 200, 61) + 0.45 * g(fine, x, y) + streak + (1 - p) * 0.14);
      paintM[i] = p; rustM[i] = r;
      const e = C.ed[i];
      let h = p > 0.5 ? 0.72 : 0.5 + 0.22 * g(ridge, x, y, 7, 5) + 0.16 * (g(fine, x, y, 12, 3) - 0.5);
      h = 0.5 + (h - 0.5) * (0.6 + 0.4 * p) - 0.16 * r * (1 - p) + 0.12 * p;
      h += 0.05 * (grain[i] - 0.5);
      h = 0.06 + (h - 0.06) * sstep(1.2 * q, 6 * q, e);
      hd[i] = h;
    }
  }
  scatter(S, 260, rng, (cx, cy) => stamp(H, null, cx, cy, (1.2 + rng() * 2.4) * Math.max(q, 0.6), -0.2, 0, 'add'));
  const cav = cavity(H, Math.max(2, Math.round(3 * q)));
  const rustR = ramp([[0, '#24130a'], [0.35, '#472510'], [0.7, '#743d17'], [1, '#98592a']]);
  const px = runPass(S, (x, y, i, c) => {
    const p = paintM[i], r = rustM[i];
    const f1 = g(fine, x, y), m1 = g(mid, x, y);
    const sv = 0.85 + 0.3 * (m1 - 0.5) + 0.2 * (grain[i] - 0.5);
    const rt = clamp01(0.25 + 0.55 * g(mid, x, y, 90, 30) + 0.5 * (f1 - 0.5) + 0.3 * r);
    rustR(rt, c, 0.75 + 0.5 * (grain[i] - 0.5));
    let rough = 0.95, metal = 0.12;
    // exposed dark steel where the rust has not taken hold
    const st = (1 - r) * 0.85;
    toward(c, 0.22 * sv, 0.22 * sv, 0.24 * sv, st);
    rough += (0.5 - rough) * st; metal += (0.85 - metal) * st;
    // paint remnants
    if (p > 0) {
      const pa = p * (1 - 0.55 * r);
      toward(c, 0.24 * sv, 0.28 * sv, 0.33 * sv, pa);
      rough += (0.5 - rough) * pa; metal += (0.5 - metal) * pa;
    }
    const edge = p * (1 - p) * 4;
    if (edge > 0) toward(c, 0.52, 0.5, 0.46, edge * 0.35);
    scaleC(c, Math.min(1.3, Math.max(0.5, 1 + cav[i] * 2)));
    const e = C.ed[i];
    if (e < 1.8 * q) scaleC(c, 0.5);
    c[3] = rough + 0.06 * (f1 - 0.5); c[4] = metal;
  });
  return finish(H, px, { ns: 3.6, metalMap: true });
});

// ------------------------------------------------------------------ floor grating (cut-out holes via alphaMap)

def('metal_grate', 'metal', 1, 512, S => {
  const B = bank(S), q = S / 512, N = S * S;
  const { mid, fine, grain, blot } = B;
  const g = sampler(S, 19, 407);
  const cell = S / 8, hb = 12 * q, hc = 9 * q;
  const H = new Field(S), hd = H.data, al = new Float32Array(N), weld = new Float32Array(N);
  const dAxis = new Float32Array(S);
  for (let k = 0; k < S; k++) dAxis[k] = Math.abs((k + 0.5) % cell - cell * 0.5);
  for (let y = 0, i = 0; y < S; y++) {
    const dy = dAxis[y];
    for (let x = 0; x < S; x++, i++) {
      const dx = dAxis[x];
      const aB = 1 - sstep(hb - 1.1, hb + 0.4, dy), aC = 1 - sstep(hc - 1.1, hc + 0.4, dx);
      const a = Math.max(aB, aC);
      al[i] = a;
      let h = 0;
      if (aB > 0) h = Math.max(h, aB * (0.92 - 0.42 * sstep(hb * 0.45, hb, dy)));
      if (aC > 0) h = Math.max(h, aC * (0.74 - 0.34 * sstep(hc * 0.4, hc, dx)));
      // serrated grip notches along the bearing bars
      if (aB > 0.5 && dy < hb * 0.6) h -= 0.09 * sstep(0.62, 0.7, 0.5 + 0.5 * Math.sin((x + 0.5) / q * 0.78));
      // weld blobs at intersections
      const wd = Math.hypot(dx, dy * 0.8);
      const wv = 1 - sstep(hc * 0.4, hc * 1.05, wd);
      if (aB > 0.5 && aC > 0.5) { weld[i] = wv; h += 0.06 * wv; }
      h += a * (0.03 * (g(fine, x, y) - 0.5) + 0.02 * (grain[i] - 0.5));
      hd[i] = h;
    }
  }
  const cav = cavity(H, Math.max(2, Math.round(2.5 * q)));
  const px = runPass(S, (x, y, i, c) => {
    const m1 = g(mid, x, y), f1 = g(fine, x, y);
    const v = 0.85 + 0.3 * (m1 - 0.5) + 0.22 * (grain[i] - 0.5) + 0.2 * (f1 - 0.5);
    c[0] = 0.24 * v; c[1] = 0.25 * v; c[2] = 0.27 * v;
    let rough = 0.5 + 0.2 * (f1 - 0.5), metal = 0.78;
    const rs = sstep(0.62, 0.78, g(blot, x, y, 60, 5) * 0.6 + g(mid, x, y, 5, 99) * 0.4);
    if (rs > 0) { toward(c, 0.42, 0.2, 0.08, rs * 0.7); rough += 0.35 * rs; metal -= 0.5 * rs; }
    const cv = cav[i];
    if (cv > 0.01) { const w = sstep(0.01, 0.045, cv) * (0.55 + 0.6 * f1) * (1 - rs); toward(c, 0.55, 0.56, 0.6, w * 0.7); metal += 0.15 * w; }
    if (weld[i] > 0) toward(c, 0.32, 0.31, 0.3, weld[i] * 0.5);
    scaleC(c, Math.min(1.3, Math.max(0.5, 1 + cv * 2)));
    c[3] = rough; c[4] = metal < 0.05 ? 0.05 : metal;
    c[8] = al[i];
  }, { alpha: true });
  const out = finish(H, px, { ns: 4, metalMap: true, props: { alphaToCoverage: true } });
  return out;
});

// ------------------------------------------------------------------ corrugated sheet + shipping containers

/** Rib profile (1 crest .. 0 valley) with flat crest / valley and smooth flanks; phase in [0, 1). */
function ribAt(phase, crestFlat, valleyFlat) {
  // phase in [0,1): crest centred on 0
  let f = phase - Math.floor(phase);
  if (f > 0.5) f = 1 - f;                 // 0..0.5 distance from crest centre
  const a = crestFlat * 0.5, b = 0.5 - valleyFlat * 0.5;
  if (f <= a) return 1;
  if (f >= b) return 0;
  const t = (f - a) / (b - a);
  return 1 - t * t * (3 - 2 * t);
}

def('metal_corrugated', 'metal', 2, 512, S => {
  const B = bank(S), q = S / 512, N = S * S;
  const { mid, fine, grain, blot, streakV: sV } = B;
  const W = B.worley(16, 41);
  const g = sampler(S, 55, 301);
  const rng = mulberry32(2024);
  const R = 20;
  const prof = new Float32Array(S);
  for (let x = 0; x < S; x++) {
    const ph = (x + 0.5) / S * R;
    prof[x] = 0.5 + 0.5 * Math.cos(ph * 6.2832);
  }
  const H = new Field(S), hd = H.data;
  const dr = new Float32Array(N);
  for (let y = 0, i = 0; y < S; y++) {
    for (let x = 0; x < S; x++, i++) {
      hd[i] = 0.3 + 0.5 * prof[x] + 0.1 * (g(blot, x, y) - 0.5) + 0.05 * (g(mid, x, y) - 0.5) + 0.02 * (grain[i] - 0.5);
    }
  }
  // fasteners on the crests + rust drips
  for (const ry of [0.25, 0.75]) {
    for (let k = 0; k < R; k++) {
      const cx = k * S / R + 0.0, cy = ry * S;
      stamp(H, null, cx, cy, 3.6 * q, 0.3, 0, 'add');
      stamp(H, null, cx, cy, 1.6 * q, -0.1, 0, 'add');
      if (rng() < 0.7) {
        const len = (25 + rng() * 60) * q; let wob = 0;
        for (let s = 0; s < len; s++) {
          const a = Math.pow(1 - s / len, 1.5);
          wob += (rng() - 0.5) * 0.3;
          const xx = cx + wob, yy = (((Math.floor(cy + 3 * q + s)) % S) + S) % S;
          for (let dx = -1; dx <= 1; dx++) {
            const pxx = ((Math.floor(xx) + dx) % S + S) % S;
            const w = Math.max(0, 1 - Math.abs(pxx + 0.5 - xx) / 1.8);
            const v = a * w * 0.85, kk = yy * S + pxx;
            if (v > dr[kk]) dr[kk] = v;
          }
        }
      }
    }
  }
  const cav = cavity(H, Math.max(2, Math.round(2.5 * q)));
  const px = runPass(S, (x, y, i, c) => {
    const p = prof[x], m1 = g(mid, x, y), f1 = g(fine, x, y);
    // galvanised spangle
    const cellV = W.id[i];
    const sp = 0.94 + 0.12 * cellV;
    const v = (0.82 + 0.3 * p) * sp * (1 + (m1 - 0.5) * 0.18 + (grain[i] - 0.5) * 0.06);
    c[0] = 0.6 * v; c[1] = 0.63 * v; c[2] = 0.66 * v;
    let rough = 0.42 + 0.14 * (f1 - 0.5) + 0.12 * (1 - cellV), metal = 0.8;
    const sk = sstep(0.58, 0.9, g(sV, x, y)) * (0.35 + 0.65 * (1 - p));
    const rs = Math.max(sk * 0.9, dr[i] * 0.9, sstep(0.72, 0.85, f1 * 0.7 + g(blot, x, y, 5, 80) * 0.3) * (1 - p) * 0.8);
    if (rs > 0) {
      const rv = 0.7 + 0.5 * (f1 - 0.5) + 0.3 * (grain[i] - 0.5);
      toward(c, 0.5 * rv, 0.24 * rv, 0.1 * rv, rs);
      rough += (0.92 - rough) * rs; metal += (0.2 - metal) * rs;
    }
    const dirt = (1 - p) * sstep(0.45, 0.8, g(blot, x, y, 111, 7)) * 0.35;
    scaleC(c, 1 - dirt);
    scaleC(c, Math.min(1.3, Math.max(0.5, 1 + cav[i] * 2.4)));
    c[3] = rough; c[4] = metal;
  });
  return finish(H, px, { ns: 2.4, metalMap: true });
});

// --- containers: normal / roughness / metalness maps are shared by all six colours

const _containerBase = new Map();
function containerBase(S) {
  let b = _containerBase.get(S);
  if (b) return b;
  const B = bank(S), q = S / 512, N = S * S;
  const { mid, fine, grain, blot, streakV: sV } = B;
  const g = sampler(S, 173, 29);
  const rng = mulberry32(6060);
  const R = 24;
  const prof = new Float32Array(S);
  for (let x = 0; x < S; x++) prof[x] = ribAt((x + 0.5) / S * R, 0.26, 0.2);
  const H = new Field(S), hd = H.data;
  const chip = new Float32Array(N), rs = new Float32Array(N), sc = crackMask(S, rng, { count: 14, len: 55, width: 1.2, branch: 0, jitter: 0.05 });
  for (let y = 0, i = 0; y < S; y++) {
    for (let x = 0; x < S; x++, i++) {
      const p = prof[x];
      const n = 0.5 * g(mid, x, y) + 0.3 * g(fine, x, y, 9, 40) + 0.2 * g(blot, x, y, 31, 3) + 0.07 * (p - 0.5);
      const ch = sstep(0.685, 0.705, n);
      chip[i] = ch;
      rs[i] = sstep(0.5, 0.86, g(sV, x, y)) * (0.35 + 0.65 * (1 - p));
      hd[i] = 0.25 + 0.55 * p + 0.09 * (g(blot, x, y, 60, 60) - 0.5) + 0.04 * (g(mid, x, y, 3, 5) - 0.5) + 0.03 * (grain[i] - 0.5) - 0.07 * ch - 0.05 * sc[i];
    }
  }
  const cav = cavity(H, Math.max(2, Math.round(2.5 * q)));
  const rmPass = runPass(S, (x, y, i, c) => {
    const ch = Math.max(chip[i], sc[i] * 0.7);
    const rr = rs[i] * 0.6;
    c[3] = 0.42 + 0.16 * (g(fine, x, y) - 0.5) + (0.3 * ch) + 0.2 * rr;
    c[4] = 0.08 + (0.75 - 0.08) * ch - 0.05 * rr;
  });
  b = {
    prof, chip, rs, cav, sc, g, S,
    normalMap: canvasTexture(H.toNormalCanvas(2.2), { srgb: false }),
    rm: canvasTexture(rmPass.rm, { srgb: false }),
  };
  _containerBase.set(S, b);
  return b;
}

function containerGen(S, hex, seedShift) {
  const base = containerBase(S);
  const B = bank(S);
  const { mid, fine, grain, blot } = B;
  const { prof, chip, rs, cav, sc } = base;
  const g = sampler(S, 173 + seedShift * 71, 29 + seedShift * 113);
  const colr = col(hex);
  const dark = 0.299 * colr[0] + 0.587 * colr[1] + 0.114 * colr[2];
  const px = runPass(S, (x, y, i, c) => {
    const p = prof[x], m1 = g(mid, x, y), f1 = g(fine, x, y);
    const v = (0.87 + 0.2 * p) * (1 + (m1 - 0.5) * 0.16 + (f1 - 0.5) * 0.1 + (grain[i] - 0.5) * 0.06);
    setC(c, colr, v);
    // sun-bleached / faded patches
    const fb = sstep(0.55, 0.85, g(blot, x, y, 200, 90)) * 0.5;
    if (fb > 0) toward(c, dark * 1.3 + 0.1, dark * 1.3 + 0.1, dark * 1.3 + 0.1, fb * 0.35);
    // dirt collects in the valleys
    const dirt = (1 - p) * (0.15 + 0.25 * sstep(0.4, 0.8, g(blot, x, y, 5, 130)));
    scaleC(c, 1 - dirt);
    const r = rs[i];
    if (r > 0.02) {
      const rv = 0.75 + 0.4 * (f1 - 0.5);
      toward(c, 0.42 * rv, 0.2 * rv, 0.09 * rv, r * 0.7);
    }
    const ch = chip[i];
    if (ch > 0) {
      const rr = sstep(0.4, 0.7, g(mid, x, y, 90, 12));
      toward(c, 0.17 + 0.28 * rr, 0.16 + 0.05 * rr, 0.17 - 0.07 * rr, ch);
      scaleC(c, 1 + 0.3 * ch * (1 - ch) * 4);
    }
    const s = sc[i];
    if (s > 0) toward(c, 0.55, 0.55, 0.57, s * 0.6);
    scaleC(c, Math.min(1.25, Math.max(0.6, 1 + cav[i] * 1.6)));
  });
  return finish(null, px, { normalMap: base.normalMap, rm: base.rm, metalMap: true });
}

const CONTAINER_COLORS = {
  container_red: '#a8271e', container_blue: '#25569f', container_green: '#2c7645', container_yellow: '#e0a71a',
  container_white: '#d9d9d2', container_orange: '#dc6720',
};
Object.keys(CONTAINER_COLORS).forEach((name, k) => def(name, 'metal', 2.5, 512, S => containerGen(S, CONTAINER_COLORS[name], k)));
