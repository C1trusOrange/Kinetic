
// ------------------------------------------------------------------ sand (wind ripples)

def('sand', 'sand', 3, 512, S => {
  const B = bank(S), q = S / 512, N = S * S;
  const { mid, fine, grain, blot } = B;
  const g = sampler(S, 137, 219);
  const rng = mulberry32(88);
  const H = new Field(S), hd = H.data, T = new Float32Array(N);
  const K = 26;
  const prof = new Float32Array(N);
  for (let y = 0, i = 0; y < S; y++) {
    const v = (y + 0.5) / S;
    for (let x = 0; x < S; x++, i++) {
      const u = (x + 0.5) / S;
      const amp = 0.35 + 0.65 * sstep(0.32, 0.62, g(blot, x, y));
      const ph = (K * v + 3 * u + 0.9 * (g(mid, x, y) - 0.5) + 0.5 * (g(blot, x, y, 70, 20) - 0.5)) * 6.2832;
      const p = 0.5 + 0.5 * Math.sin(ph + 0.75 * Math.sin(ph));
      prof[i] = (p - 0.5) * amp;
      hd[i] = 0.5 + 0.55 * prof[i] + 0.05 * (g(fine, x, y) - 0.5) + 0.06 * (grain[i] - 0.5);
    }
  }
  scatter(S, 46, rng, (cx, cy) => stamp(H, T, cx, cy, (1.8 + rng() * 2.4) * Math.max(q, 0.6), 0.35, 0.3 + 0.4 * rng(), 'max', 0.4));
  const cav = cavity(H, Math.max(2, Math.round(2 * q)));
  const pal = ramp([[0, '#a58658'], [0.5, '#c6a672'], [1, '#e3c894']]);
  const px = runPass(S, (x, y, i, c) => {
    const m1 = g(mid, x, y, 30, 60);
    const t = clamp01(0.5 + 0.9 * prof[i] + 0.35 * (m1 - 0.5) + 0.1 * (grain[i] - 0.5));
    pal(t, c, 0.92 + 0.16 * (g(fine, x, y) - 0.5));
    const gr = grain[i];
    if (gr > 0.985) scaleC(c, 0.55); else if (gr < 0.012) scaleC(c, 1.3);
    const damp = sstep(0.6, 0.85, g(blot, x, y, 220, 110)) * 0.25;
    scaleC(c, 1 - damp);
    if (T[i] > 0) { toward(c, 0.36, 0.3, 0.24, 0.55 * T[i] + 0.2); }
    scaleC(c, Math.min(1.25, Math.max(0.6, 1 + cav[i] * 1.8)));
    c[3] = 0.95 - 0.06 * T[i];
  });
  return finish(H, px, { ns: 3 });
});

// ------------------------------------------------------------------ dirt

def('dirt', 'dirt', 3, 512, S => {
  const B = bank(S), q = S / 512, N = S * S;
  const { mid, fine, grain, blot } = B;
  const W = B.worley(9, 61);
  const g = sampler(S, 5, 471);
  const rng = mulberry32(1234);
  const H = new Field(S), hd = H.data, T = new Float32Array(N), net = new Float32Array(N);
  for (let y = 0, i = 0; y < S; y++) {
    for (let x = 0; x < S; x++, i++) {
      const dry = sstep(0.5, 0.64, g(blot, x, y, 120, 40));
      const cr = (1 - sstep(0, 0.045, W.edge[i])) * dry;
      net[i] = cr;
      hd[i] = 0.55 - 0.3 * W.f1[i] + 0.16 * (g(mid, x, y) - 0.5) + 0.12 * (g(fine, x, y) - 0.5) + 0.08 * (grain[i] - 0.5) - 0.28 * cr;
    }
  }
  T.fill(-1);
  scatter(S, 320, rng, (cx, cy) => stamp(H, T, cx, cy, (1.4 + rng() * rng() * 4.2) * Math.max(q, 0.6), 0.25 + 0.3 * rng(), rng(), 'add', 0.42));
  const cav = cavity(H, Math.max(2, Math.round(3 * q)));
  const soil = ramp([[0, '#241509'], [0.45, '#3e2917'], [0.75, '#5a3d24'], [1, '#785636']]);
  const peb = ramp([[0, '#3d3a34'], [0.5, '#5c554a'], [1, '#807560']]);
  const px = runPass(S, (x, y, i, c) => {
    const t = clamp01(0.32 + 0.55 * (hd[i] - 0.25) + 0.35 * (g(mid, x, y, 50, 9) - 0.5) + 0.22 * (grain[i] - 0.5));
    soil(t, c, 0.9 + 0.2 * (g(fine, x, y) - 0.5));
    const wet = sstep(0.55, 0.8, g(blot, x, y, 10, 200));
    scaleC(c, 1 - 0.3 * wet);
    const dryC = sstep(0.5, 0.64, g(blot, x, y, 120, 40));
    toward(c, 0.55, 0.42, 0.28, dryC * 0.2);
    if (net[i] > 0) scaleC(c, 1 - 0.4 * net[i]);
    if (T[i] >= 0) { const k = 0.7 + 0.5 * T[i]; peb(T[i], _c2, k); toward(c, _c2[0], _c2[1], _c2[2], 0.55); }
    scaleC(c, Math.min(1.3, Math.max(0.5, 1 + cav[i] * 1.8)));
    c[3] = 0.96 - 0.1 * wet;
  });
  return finish(H, px, { ns: 3.6 });
});
const _c2 = new Float32Array(3);

// ------------------------------------------------------------------ grass

def('grass', 'grass', 3, 512, S => {
  const B = bank(S), q = S / 512, N = S * S;
  const { mid, fine, grain, blot } = B;
  const g = sampler(S, 301, 77);
  const rng = mulberry32(2718);
  const H = new Field(S), hd = H.data;
  const R = new Float32Array(N), G = new Float32Array(N), Bc = new Float32Array(N);
  const pal = ramp([[0, '#1a3309'], [0.3, '#2b5410'], [0.6, '#477518'], [0.85, '#6c9224'], [1, '#98ae3a']]);
  for (let y = 0, i = 0; y < S; y++) {
    for (let x = 0; x < S; x++, i++) {
      const t = clamp01(0.18 + 0.5 * g(blot, x, y) + 0.3 * (g(mid, x, y) - 0.5));
      pal(t, _c2, 0.42);
      R[i] = _c2[0]; G[i] = _c2[1]; Bc[i] = _c2[2];
      hd[i] = 0.2 + 0.06 * (g(fine, x, y) - 0.5);
    }
  }
  const nb = (N / 24) | 0;
  for (let k = 0; k < nb; k++) {
    const x0 = rng() * S, y0 = rng() * S, ang = rng() * 6.2832, len = (6 + rng() * 10) * Math.max(q, 0.7);
    const tone = clamp01(0.15 + 0.7 * rng() + 0.25 * (g(blot, x0 | 0, y0 | 0, 5, 9) - 0.5)), bend = (rng() - 0.5) * 0.06;
    for (let s = 0; s < len; s += 0.7) {
      const a = ang + bend * s, cs_ = Math.cos(a), sn = Math.sin(a), f = s / len;
      pal(tone, _c2, 0.5 + 0.75 * f);
      for (let w = 0; w < 2; w++) {
        const ix = ((Math.floor(x0 + cs_ * s - sn * w * 0.9) % S) + S) % S;
        const iy = ((Math.floor(y0 + sn * s + cs_ * w * 0.9) % S) + S) % S, ii = iy * S + ix;
        R[ii] = _c2[0]; G[ii] = _c2[1]; Bc[ii] = _c2[2];
        const hh = 0.35 + 0.65 * f;
        if (hh > hd[ii] || w === 0) hd[ii] = Math.max(hd[ii], hh * (0.75 + 0.25 * tone));
      }
    }
  }
  // clover / small flowers
  const flowers = [[0.92, 0.92, 0.86], [0.96, 0.82, 0.18], [0.8, 0.55, 0.85]];
  scatter(S, 46, rng, (cx, cy, k) => {
    const fc = flowers[k % 3];
    for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
      const ii = (((Math.floor(cy) + dy) % S + S) % S) * S + (((Math.floor(cx) + dx) % S + S) % S);
      R[ii] = fc[0]; G[ii] = fc[1]; Bc[ii] = fc[2]; hd[ii] = 0.9;
    }
  });
  const cav = cavity(H, 2);
  const px = runPass(S, (x, y, i, c) => {
    c[0] = R[i]; c[1] = G[i]; c[2] = Bc[i];
    const dry = sstep(0.62, 0.78, g(blot, x, y, 111, 222));
    if (dry > 0) toward(c, 0.5, 0.44, 0.2, dry * 0.45);
    scaleC(c, 0.9 + 0.2 * (g(mid, x, y, 5, 5) - 0.5) + (grain[i] - 0.5) * 0.14);
    scaleC(c, Math.min(1.35, Math.max(0.55, 1 + cav[i] * 1.4)));
    c[3] = 0.9 - 0.08 * (hd[i] - 0.2);
  });
  return finish(H, px, { ns: 2.4 });
});

// ------------------------------------------------------------------ roof gravel

def('roof_gravel', 'sand', 2, 512, S => {
  const B = bank(S), q = S / 512, N = S * S;
  const { mid, fine, grain, blot } = B;
  const g = sampler(S, 349, 17);
  const rng = mulberry32(555);
  const H = new Field(S), hd = H.data, T = new Float32Array(N).fill(-1);
  for (let i = 0; i < N; i++) hd[i] = 0.06 + 0.04 * (mid[i] - 0.5) + 0.03 * (grain[i] - 0.5);
  scatter(S, (N / 26) | 0, rng, (cx, cy) => {
    const r = (2.4 + rng() * rng() * 6.4) * Math.max(q, 0.6);
    stamp(H, T, cx, cy, r, 0.4 + rng() * 0.5, rng(), 'max', 0.4);
  });
  const cav = cavity(H, Math.max(2, Math.round(3 * q)));
  const stone = ramp([[0, '#4a4844'], [0.15, '#66635d'], [0.3, '#8a7d68'], [0.45, '#8f8b84'], [0.6, '#b4aea2'], [0.75, '#6e5a4a'], [0.9, '#7b7b7a'], [1, '#a59b88']]);
  const px = runPass(S, (x, y, i, c) => {
    const m1 = g(mid, x, y), f1 = g(fine, x, y);
    let rough = 0.93;
    if (T[i] >= 0) {
      stone(T[i], c, 0.85 + 0.3 * (f1 - 0.5) + 0.3 * (m1 - 0.5) + 0.14 * (grain[i] - 0.5) + 0.1 * (hd[i] - 0.5));
    } else {
      const k = 0.7 + 0.5 * (m1 - 0.5) + 0.4 * (grain[i] - 0.5);
      c[0] = 0.05 * k; c[1] = 0.05 * k; c[2] = 0.055 * k;
      rough = 0.85;
    }
    const dust = sstep(0.55, 0.8, g(blot, x, y, 200, 60)) * 0.25;
    toward(c, 0.4, 0.38, 0.34, dust);
    scaleC(c, Math.min(1.3, Math.max(0.45, 1 + cav[i] * 1.8)));
    c[3] = rough;
  });
  return finish(H, px, { ns: 3.6 });
});

// ------------------------------------------------------------------ water

def('water', 'glass', 4, 512, S => {
  const B = bank(S), N = S * S;
  const { mid, fine, blot, ridge } = B;
  const g = sampler(S, 25, 190);
  const H = new Field(S), hd = H.data;
  for (let y = 0, i = 0; y < S; y++) {
    const v = (y + 0.5) / S;
    for (let x = 0; x < S; x++, i++) {
      const u = (x + 0.5) / S;
      const w = g(blot, x, y) - 0.5;
      const w1 = Math.sin((3 * u + 1 * v + 0.9 * w) * 6.2832);
      const w2 = Math.sin((2 * u - 4 * v + 1.2 * (g(mid, x, y, 90, 13) - 0.5)) * 6.2832);
      const w3 = Math.sin((-5 * u - 3 * v + 1.5 * (g(mid, x, y, 5, 140) - 0.5)) * 6.2832);
      hd[i] = 0.5 + 0.1 * w1 + 0.07 * w2 + 0.045 * w3 + 0.2 * (g(ridge, x, y) - 0.5) + 0.09 * (g(mid, x, y, 12, 12) - 0.5) + 0.05 * (g(fine, x, y) - 0.5);
    }
  }
  const pal = ramp([[0, '#04121a'], [0.45, '#0a2a37'], [0.75, '#123f4d'], [1, '#1f5a68']]);
  const px = runPass(S, (x, y, i, c) => {
    const h = hd[i];
    pal(clamp01((h - 0.3) * 1.6), c, 0.9 + 0.2 * (g(mid, x, y, 60, 60) - 0.5));
    const foam = sstep(0.8, 0.95, g(ridge, x, y) * 0.7 + (h - 0.5) * 0.9);
    if (foam > 0) toward(c, 0.32, 0.48, 0.5, foam * 0.3);
    c[3] = 0.05 + 0.07 * (g(fine, x, y) - 0.4) + 0.05 * foam;
    c[4] = 0;
  });
  return finish(H, px, { ns: 5 });
});

// ------------------------------------------------------------------ glass facade (tiling window grid)

def('glass_window', 'glass', 16, 512, S => {
  const B = bank(S), N = S * S;
  const { mid, fine, grain, streakV: sV } = B;
  const g = sampler(S, 9, 333);
  const COLS = 8, ROWS = 5;
  const cw = S / COLS, chh = S / ROWS;
  const wx0 = cw * 0.1, wx1 = cw * 0.9, wy0 = chh * 0.15, wy1 = chh * 0.86, fw = cw * 0.05;
  const trY = wy0 + (wy1 - wy0) * 0.3;
  const H = new Field(S), hd = H.data;
  const region = new Uint8Array(N);         // 0 cladding, 1 frame, 2 glass, 3 sill
  const wid = new Uint16Array(N), paneX = new Float32Array(N), paneY = new Float32Array(N);
  for (let y = 0, i = 0; y < S; y++) {
    const row = Math.floor(y / chh), cy = y + 0.5 - row * chh;
    for (let x = 0; x < S; x++, i++) {
      const col_i = Math.floor(x / cw), cx = x + 0.5 - col_i * cw;
      const id = row * COLS + col_i;
      wid[i] = id;
      let h = 0.5, rg = 0;
      const eo = Math.min(cx - wx0, wx1 - cx, cy - wy0, wy1 - cy);
      if (eo >= 0) {
        const mull = Math.abs(cx - cw * 0.5) < fw * 0.4 || (Math.abs(cy - trY) < fw * 0.4 && true);
        if (eo < fw || mull) { rg = 1; h = 0.78 + 0.05 * sstep(0, fw * 0.5, Math.min(eo, fw - eo)); }
        else { rg = 2; h = 0.32; }
        paneX[i] = (cx - wx0) / (wx1 - wx0);
        paneY[i] = (cy - wy0) / (wy1 - wy0);
      } else if (cy > wy1 && cy < wy1 + fw * 1.1 && cx > wx0 - fw * 0.6 && cx < wx1 + fw * 0.6) {
        rg = 3; h = 0.66;
      } else {
        const sm = Math.min(cx, cw - cx, cy, chh - cy);
        h = 0.5 - 0.15 * (1 - sstep(0.5, 1.6, sm)) + 0.02 * (grain[i] - 0.5);
      }
      region[i] = rg;
      hd[i] = h + 0.01 * (g(fine, x, y) - 0.5);
    }
  }
  const cav = cavity(H, 2);
  // per-window random tables (lit state, colour, interior style)
  const wins = [];
  const order = Array.from({ length: COLS * ROWS }, (_, k) => k);
  const srng = mulberry32(90210);
  for (let k = order.length - 1; k > 0; k--) { const j = (srng() * (k + 1)) | 0; const t = order[k]; order[k] = order[j]; order[j] = t; }
  const litSet = new Set(order.slice(0, Math.round(COLS * ROWS * 0.35)));
  for (let id = 0; id < COLS * ROWS; id++) {
    const kt = hash(id, 12);
    let lr, lg, lb;
    if (kt < 0.5) { lr = 1.0; lg = 0.74 + 0.08 * hash(id, 15); lb = 0.4 + 0.12 * hash(id, 16); }
    else if (kt < 0.75) { lr = 0.62; lg = 0.8; lb = 1.0; }
    else if (kt < 0.87) { lr = 0.86; lg = 1.0; lb = 0.88; }
    else if (kt < 0.94) { lr = 1.0; lg = 0.5; lb = 0.28; }
    else { lr = 1.0; lg = 0.93; lb = 0.8; }
    const style = hash(id, 17);
    wins.push({
      tint: 0.85 + 0.3 * hash(id, 3), lit: litSet.has(id),
      pane: [hash(id * 2, 14) < 0.92, hash(id * 2 + 1, 14) < 0.92],
      b: [0.5 + 0.5 * hash(id * 2, 13), 0.5 + 0.5 * hash(id * 2 + 1, 13)],
      lr, lg, lb, style, fb: 0.25 + 0.5 * hash(id, 18), left: hash(id, 19) < 0.5, ox: 0.15 + 0.4 * hash(id, 20),
      tv: hash(id, 21) < 0.05, cl: hash(id, 5),
    });
  }
  const px = runPass(S, (x, y, i, c) => {
    const rg = region[i], id = wid[i];
    let rough, metal, ex = 0, ey = 0, ez = 0;
    if (rg === 2) {
      const W = wins[id], t = W.tint;
      c[0] = 0.05 * t; c[1] = 0.085 * t; c[2] = 0.115 * t;
      const streak = sstep(0.55, 0.9, g(sV, x, y));
      rough = 0.06 + 0.1 * streak + 0.03 * (g(fine, x, y) - 0.5); metal = 0.88;
      const px_ = paneX[i], py_ = paneY[i];
      const pane = px_ < 0.5 ? 0 : 1;
      if (W.lit && W.pane[pane]) {
        let b = W.b[pane] * (1.05 - 0.45 * py_);
        if (W.style < 0.28) {
          if (py_ < W.fb) { const s = ((y * 0.5) % 1); b *= 0.28 + 0.72 * sstep(0.05, 0.35, s) * (1 - sstep(0.7, 0.95, s)); }
        } else if (W.style < 0.45) {
          const side = W.left ? px_ : 1 - px_;
          if (side < 0.28) b *= 0.35;
        } else if (W.style < 0.62) {
          if (py_ > 0.68 && px_ > W.ox && px_ < W.ox + 0.42) b *= 0.16;
        }
        const edgeD = Math.min(px_, 1 - px_, py_, 1 - py_);
        b *= 0.55 + 0.45 * sstep(0, 0.12, edgeD);
        ex = W.lr * b; ey = W.lg * b; ez = W.lb * b;
        toward(c, W.lr * 0.08, W.lg * 0.08, W.lb * 0.08, 0.5);
      } else if (W.tv) {
        ex = 0.05; ey = 0.09; ez = 0.16;
      }
    } else if (rg === 1) {
      const k = 0.85 + 0.3 * (g(mid, x, y) - 0.5);
      c[0] = 0.2 * k; c[1] = 0.215 * k; c[2] = 0.24 * k;
      rough = 0.4; metal = 0.75;
    } else if (rg === 3) {
      c[0] = 0.5; c[1] = 0.5; c[2] = 0.5;
      rough = 0.7; metal = 0.1;
    } else {
      const k = 0.9 + 0.22 * (g(mid, x, y) - 0.5) + 0.08 * (grain[i] - 0.5);
      const pt = 0.94 + 0.12 * wins[id].cl;
      c[0] = 0.29 * k * pt; c[1] = 0.32 * k * pt; c[2] = 0.37 * k * pt;
      const stain = sstep(0.55, 0.9, g(sV, x, y)) * 0.35;
      scaleC(c, 1 - stain);
      rough = 0.6 + 0.1 * (g(fine, x, y) - 0.5); metal = 0.3;
    }
    scaleC(c, Math.min(1.3, Math.max(0.5, 1 + cav[i] * 2)));
    c[3] = rough; c[4] = metal; c[5] = ex; c[6] = ey; c[7] = ez;
  }, { emissive: true });
  return finish(H, px, { ns: 2.5, metalMap: true, props: { emissiveIntensity: 1.8 } });
});

// ------------------------------------------------------------------ emissive: neon strips + light panel

function neonGen(S, rgb, opt = {}) {
  const B = bank(S), q = S / 256;
  const { mid, fine, grain } = B;
  const g = sampler(S, opt.ox || 0, opt.oy || 0);
  const H = new Field(S), hd = H.data;
  const half = S / 2;
  const joint = new Float32Array(S * S);
  const jAxis = new Float32Array(S), lensAxis = new Float32Array(S);
  for (let k = 0; k < S; k++) {
    const m = (k + 0.5) % half;
    jAxis[k] = Math.min(m, half - m);
    lensAxis[k] = 0.5 + 0.5 * Math.cos((k + 0.5) / S * 6.2832 * 20);
  }
  for (let y = 0, i = 0; y < S; y++) {
    for (let x = 0; x < S; x++, i++) {
      const lens = lensAxis[x];
      const dj = Math.min(jAxis[x], jAxis[y]);
      const j = 1 - sstep(0.6 * q, 2.2 * q, dj);
      joint[i] = j;
      hd[i] = 0.6 + 0.08 * lens - 0.4 * j + 0.03 * (grain[i] - 0.5);
    }
  }
  const white = [1, 1, 1];
  const px = runPass(S, (x, y, i, c) => {
    const n = g(mid, x, y), f = g(fine, x, y);
    const lens = lensAxis[x];
    let b = 0.9 + 0.1 * (n - 0.5) * 2 + 0.05 * (lens - 0.5) + 0.03 * (grain[i] - 0.5);
    b *= 1 - 0.75 * joint[i];
    const hot = sstep(0.62, 0.85, n * 0.7 + f * 0.3) * (opt.hot ?? 0.12);
    let r = rgb[0] * b, gg = rgb[1] * b, bb = rgb[2] * b;
    r += (white[0] - r) * hot * b; gg += (white[1] - gg) * hot * b; bb += (white[2] - bb) * hot * b;
    c[5] = r; c[6] = gg; c[7] = bb;
    const a = 0.3 * (1 - joint[i] * 0.7);
    c[0] = rgb[0] * a; c[1] = rgb[1] * a; c[2] = rgb[2] * a;
    c[3] = 0.35 + 0.15 * (f - 0.5); c[4] = 0;
  }, { emissive: true });
  return finish(H, px, { ns: 1.6, props: { emissiveIntensity: opt.intensity || 2.2 } });
}

const NEON = {
  neon_blue: [0.05, 0.38, 1.0], neon_pink: [1.0, 0.05, 0.4], neon_orange: [1.0, 0.36, 0.02], neon_green: [0.1, 1.0, 0.28],
};
const NEON_I = { neon_blue: 3.4, neon_pink: 2.6, neon_orange: 2.4, neon_green: 2.2 };
Object.keys(NEON).forEach((name, k) => def(name, 'energy', 1, 256, S => neonGen(S, NEON[name], { ox: k * 61, oy: k * 29, intensity: NEON_I[name] }), { emissive: true }));

def('light_panel', 'energy', 1, 256, S => {
  const B = bank(S), q = S / 256;
  const { mid, grain } = B;
  const g = sampler(S, 77, 3);
  const C = buildCells(S, gridLayout(S, 2));
  const H = new Field(S), hd = H.data;
  for (let y = 0, i = 0; y < S; y++) {
    for (let x = 0; x < S; x++, i++) {
      const e = C.ed[i];
      const dot = 0.5 + 0.5 * Math.sin((x + 0.5) * 0.9 * 1 / q) * Math.sin((y + 0.5) * 0.9 / q);
      hd[i] = 0.4 + 0.4 * sstep(1.5 * q, 4 * q, e) + 0.05 * dot * sstep(1.5 * q, 4 * q, e);
    }
  }
  const px = runPass(S, (x, y, i, c) => {
    const id = C.id[i], e = C.ed[i];
    const t = sstep(1.8 * q, 3.6 * q, e);
    const dot = 0.5 + 0.5 * Math.sin((x + 0.5) * 0.9 / q) * Math.sin((y + 0.5) * 0.9 / q);
    const b = (0.93 + 0.07 * hash(id, 2) + 0.04 * (g(mid, x, y) - 0.5)) * (0.96 + 0.04 * dot);
    const k = b * t + 0.16 * (1 - t);
    c[5] = 1.0 * k; c[6] = 0.97 * k; c[7] = 0.9 * k;
    const a = 0.55 * t + 0.35 * (1 - t);
    c[0] = a; c[1] = a * 0.98; c[2] = a * 0.94;
    c[3] = 0.4 + 0.1 * (grain[i] - 0.5); c[4] = 0;
  }, { emissive: true });
  return finish(H, px, { ns: 1.6, props: { emissiveIntensity: 2.2 } });
}, { emissive: true });

// ------------------------------------------------------------------ dev grid (fallback)

def('dev_grid', 'concrete', 2, 512, S => {
  const B = bank(S), q = S / 512;
  const { fine, grain } = B;
  const g = sampler(S, 0, 0);
  const H = new Field(S), hd = H.data;
  const cell = S / 2, minor = cell / 4;
  const major = new Float32Array(S * S), mid_ = new Float32Array(S * S), small = new Float32Array(S * S);
  const dMaj = new Float32Array(S), dMid = new Float32Array(S), dMin = new Float32Array(S);
  const tri = (v, period) => { const m = v % period; return Math.min(m, period - m); };
  for (let k = 0; k < S; k++) { dMaj[k] = tri(k + 0.5, cell); dMid[k] = tri(k + 0.5, cell / 2); dMin[k] = tri(k + 0.5, minor); }
  for (let y = 0, i = 0; y < S; y++) {
    for (let x = 0; x < S; x++, i++) {
      const d = Math.min(dMaj[x], dMaj[y]);
      const dm = Math.min(dMid[x], dMid[y]);
      const dn = Math.min(dMin[x], dMin[y]);
      major[i] = 1 - sstep(1.4 * q, 2.6 * q, d);
      mid_[i] = 1 - sstep(0.5 * q, 1.4 * q, dm);
      small[i] = 1 - sstep(0.3 * q, 0.9 * q, dn);
      hd[i] = 0.6 - 0.3 * major[i] - 0.15 * mid_[i] - 0.06 * small[i] + 0.02 * (grain[i] - 0.5);
    }
  }
  const px = runPass(S, (x, y, i, c) => {
    const chk = (((x / cell) | 0) + ((y / cell) | 0)) & 1;
    const k = (chk ? 0.5 : 0.58) + 0.03 * (g(fine, x, y) - 0.5) + 0.02 * (grain[i] - 0.5);
    c[0] = k; c[1] = k * 1.01; c[2] = k * 1.03;
    toward(c, 0.36, 0.37, 0.39, small[i] * 0.6);
    toward(c, 0.27, 0.28, 0.3, mid_[i] * 0.75);
    toward(c, 1.0, 0.5, 0.1, major[i]);
    c[3] = 0.8; c[4] = 0;
  });
  return finish(H, px, { ns: 2 });
});
