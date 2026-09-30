
// ------------------------------------------------------------------ layout helpers

/** Rows of blocks with random widths that sum to S per row (wraps). heights are relative. */
function rowLayout(S, heights, counts, rng, weights = [0.75, 1.4]) {
  const blocks = [];
  const tot = heights.reduce((a, b) => a + b, 0);
  let y = 0;
  for (let r = 0; r < heights.length; r++) {
    const h = heights[r] * S / tot;
    const n = counts[r % counts.length];
    const ws = [];
    let sum = 0;
    for (let k = 0; k < n; k++) { const w = weights[0] + rng() * (weights[1] - weights[0]); ws.push(w); sum += w; }
    let x = rng() * S;
    for (let k = 0; k < n; k++) {
      const w = ws[k] * S / sum;
      blocks.push({ x, y, w, h });
      x += w;
    }
    y += h;
  }
  return blocks;
}

/** Regular grid of n x n blocks. */
function gridLayout(S, n) {
  const blocks = [], s = S / n;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) blocks.push({ x: i * s, y: j * s, w: s, h: s });
  return blocks;
}

// ------------------------------------------------------------------ bricks

function brickGen(S, o) {
  const B = bank(S), q = S / 512;
  const { mid, fine, grain, blot, streakV: sV } = B;
  const g = sampler(S, o.ox, o.oy);
  const NR = 16, NBk = 5, rowH = S / NR, bw = S / NBk;
  const blocks = [];
  for (let r = 0; r < NR; r++) {
    const off = (r & 1) ? bw * 0.5 : 0;
    for (let k = 0; k < NBk; k++) blocks.push({ x: off + k * bw, y: r * rowH, w: bw, h: rowH });
  }
  const C = buildCells(S, blocks);
  const nb = blocks.length;
  // per-brick random tables
  const tTop = new Float32Array(nb), tTone = new Float32Array(nb), tBright = new Float32Array(nb), tBlue = new Uint8Array(nb);
  const tChip = new Uint8Array(nb), tCx = new Uint8Array(nb), tCy = new Uint8Array(nb), tCR = new Float32Array(nb);
  for (let k = 0; k < nb; k++) {
    tTop[k] = 0.86 + 0.14 * hash(k, o.seed + 3);
    tTone[k] = hash(k, o.seed + 1);
    tBright[k] = 0.86 + 0.26 * hash(k, o.seed + 2);
    tBlue[k] = hash(k, o.seed + 9) < o.dark2 ? 1 : 0;
    tChip[k] = hash(k, o.seed + 5) < o.chip ? 1 : 0;
    tCx[k] = hash(k, 6) < 0.5 ? 0 : 1; tCy[k] = hash(k, 7) < 0.5 ? 0 : 1;
    tCR[k] = (7 + 7 * hash(k, 8)) * q;
  }
  const mh = 2.0 * q, bv = 3.2 * q;
  const H = new Field(S), hd = H.data;
  const chip = new Float32Array(S * S), E = new Float32Array(S * S);
  for (let y = 0, i = 0; y < S; y++) {
    for (let x = 0; x < S; x++, i++) {
      const id = C.id[i];
      const e = C.ed[i] + (g(fine, x, y) - 0.5) * 1.3 * q + (g(mid, x, y) - 0.5) * 1.6 * q;
      E[i] = e;
      const t = sstep(mh, mh + bv, e);
      let h = 0.13 + 0.07 * grain[i];
      h += (tTop[id] - 0.13) * t;
      if (t > 0) {
        h += t * (0.08 * (g(mid, x, y, id * 37, id * 91) - 0.5) + 0.07 * (g(fine, x, y, id * 11, id * 5) - 0.5));
        if (tChip[id]) {
          const dx = Math.abs(C.lu[i] - tCx[id]) * bw, dy = Math.abs(C.lv[i] - tCy[id]) * rowH;
          const R = tCR[id];
          const d = Math.sqrt(dx * dx + dy * dy) + (g(fine, x, y) - 0.5) * 5 * q;
          if (d < R) { const ch = sstep(R, R * 0.55, d); chip[i] = ch; h -= 0.4 * ch * t; }
        }
      }
      hd[i] = h;
    }
  }
  const cav = cavity(H, Math.max(2, Math.round(3 * q)));
  const pal = ramp(o.pal);
  const mortar = col(o.mortar);
  const salt = [0.72, 0.7, 0.66];
  const px = runPass(S, (x, y, i, c) => {
    const id = C.id[i];
    const t = sstep(mh - 0.5, mh + 0.5, E[i]);
    let rough;
    if (t > 0.01) {
      const m1 = g(mid, x, y, id * 37, id * 91), f1 = g(fine, x, y, id * 11, id * 5);
      const blue = tBlue[id] === 1;
      pal(blue ? 0.02 : tTone[id], c, tBright[id] + (m1 - 0.5) * 0.36 + (f1 - 0.5) * 0.28 + (grain[i] - 0.5) * 0.1);
      if (blue) toward(c, o.blue[0], o.blue[1], o.blue[2], 0.8);
      const ef = sstep(0.76, 0.9, g(blot, x, y, 60, 140)) * o.salt;
      if (ef > 0) towardC(c, salt, ef * 0.4);
      const sk = sstep(0.5, 0.95, g(sV, x, y)) * o.soot;
      if (sk > 0) scaleC(c, 1 - 0.38 * sk);
      if (chip[i] > 0) towardC(c, o.chipC, chip[i] * 0.85);
      rough = o.rough + 0.12 * (f1 - 0.5);
      if (t < 1) towardC(c, mortar, 1 - t);
    } else {
      const k = 0.82 + 0.34 * grain[i] + 0.3 * (g(mid, x, y) - 0.5);
      setC(c, mortar, k);
      rough = 0.95;
    }
    scaleC(c, Math.min(1.3, Math.max(0.5, 1 + cav[i] * 2.2)));
    c[3] = rough;
  });
  return finish(H, px, { ns: o.ns });
}

def('brick', 'stone', 1.28, 512, S => brickGen(S, {
  seed: 1, ox: 0, oy: 0, chip: 0.1, dark2: 0, blue: [0, 0, 0], salt: 0.6, soot: 0.6, rough: 0.84, ns: 3.4,
  pal: [[0, '#5a2519'], [0.3, '#7b3524'], [0.55, '#8f4629'], [0.8, '#a75d3a'], [1, '#bc7650']],
  mortar: '#9a958b', chipC: [0.62, 0.36, 0.25],
}));
def('brick_dark', 'stone', 1.28, 512, S => brickGen(S, {
  seed: 2, ox: 131, oy: 77, chip: 0.08, dark2: 0.2, blue: [0.13, 0.15, 0.2], salt: 0.2, soot: 1, rough: 0.68, ns: 3.4,
  pal: [[0, '#221315'], [0.3, '#331c1a'], [0.6, '#452622'], [0.85, '#54302a'], [1, '#65392f']],
  mortar: '#4d4b49', chipC: [0.4, 0.22, 0.17],
}));

// ------------------------------------------------------------------ masonry (stone blocks, sandstone, tiles)

function glyph(kind, gu, gv) {
  const aa = 0.05;
  let d;
  switch (kind) {
    case 0: d = Math.abs(Math.hypot(gu - 0.5, gv - 0.5) - 0.3) - 0.07; break;
    case 1: d = Math.max(Math.abs(gu - 0.5) - 0.07, Math.abs(gv - 0.5) - 0.32); break;
    case 2: d = Math.min(Math.max(Math.abs(gu - 0.5) - 0.07, Math.abs(gv - 0.5) - 0.34), Math.max(Math.abs(gu - 0.5) - 0.3, Math.abs(gv - 0.5) - 0.07)); break;
    case 3: d = Math.max(Math.abs(gv - (0.28 + Math.abs(gu - 0.5) * 0.9)) - 0.07, Math.abs(gu - 0.5) - 0.34); break;
    case 4: d = Math.min(Math.hypot(gu - 0.5, gv - 0.26) - 0.13, Math.max(Math.abs(gu - 0.5) - 0.06, Math.abs(gv - 0.64) - 0.2)); break;
    case 5: d = Math.min(Math.max(Math.abs(gu - 0.3), Math.abs(gv - 0.3)), Math.max(Math.abs(gu - 0.5), Math.abs(gv - 0.5)), Math.max(Math.abs(gu - 0.7), Math.abs(gv - 0.7))) - 0.1; break;
    case 6: d = Math.abs(gv - (0.5 + 0.2 * Math.sin(gu * 9.4))) - 0.065; break;
    default: return 0;
  }
  return 1 - sstep(-aa, aa, d);
}

function masonryGen(S, o) {
  const B = bank(S), q = S / 512;
  const { mid, fine, grain, blot, ridge, streakV: sV, streakH: sH } = B;
  const g = sampler(S, o.ox, o.oy);
  const rng = mulberry32(o.seed * 977 + 13);
  const C = buildCells(S, o.layout(S, rng));
  const nb = C.blocks.length;
  const tTop = new Float32Array(nb), tTone = new Float32Array(nb), tBright = new Float32Array(nb), tHue = new Float32Array(nb);
  const tChs = new Uint8Array(nb), tCos = new Float32Array(nb), tSin = new Float32Array(nb), tStr = new Float32Array(nb), tKind = new Float32Array(nb);
  for (let k = 0; k < nb; k++) {
    tTop[k] = 0.72 + 0.22 * hash(k, o.seed + 3);
    tTone[k] = hash(k, o.seed + 1);
    tBright[k] = 0.9 + 0.2 * hash(k, o.seed + 2);
    tHue[k] = (hash(k, 41) - 0.5) * o.hue;
    tChs[k] = o.chisel && hash(k, 11) < o.chisel ? 1 : 0;
    const a = 0.55 + hash(k, 12) * 0.8;
    tCos[k] = Math.cos(a) / (5.5 * q); tSin[k] = Math.sin(a) / (5.5 * q);
    tStr[k] = hash(k, 5) * 6;
    tKind[k] = hash(k, 21);
  }
  const mh = o.mh * q, bv = o.bv * q;
  const H = new Field(S), hd = H.data;
  const gr = new Float32Array(S * S), gl = new Float32Array(S * S), E = new Float32Array(S * S);
  for (let y = 0, i = 0; y < S; y++) {
    for (let x = 0; x < S; x++, i++) {
      const id = C.id[i];
      const m1 = g(mid, x, y, id * 13, id * 5), f1 = g(fine, x, y, id * 3, id * 17);
      const e = C.ed[i] + (m1 - 0.5) * o.wob * q + (f1 - 0.5) * 1.4 * q;
      E[i] = e;
      const t = sstep(mh, mh + bv, e);
      let h = 0.06 + (tTop[id] - 0.06) * t;
      if (t > 0) {
        h += t * (o.relief * (m1 - 0.5) + o.grit * (f1 - 0.5) + o.ridged * (g(ridge, x, y, id * 7, 9) - 0.5));
        if (tChs[id]) {
          const along = x * tCos[id] + y * tSin[id];
          const tri = Math.abs(along - Math.floor(along) - 0.5) * 2;
          const patch = sstep(0.38, 0.55, g(mid, x, y, id * 29 + 50, id * 11));
          const grv = (1 - tri) * patch * t;
          gr[i] = grv; h -= 0.075 * grv;
        }
        if (o.carved) {
          const b = C.blocks[id];
          const px_ = C.lu[i] * b.w, py_ = C.lv[i] * b.h;
          const pad = mh + 10 * q;
          const e2 = Math.min(px_, b.w - px_, py_, b.h - py_) - pad;
          const kind = tKind[id];
          if (e2 > 0 && kind < 0.85) {
            h -= 0.14 * sstep(0, 2.5 * q, e2);
            if (kind < 0.5) {
              const gs = b.h * 0.42, inner = b.w - 2 * pad;
              const cols = Math.max(1, Math.floor(inner / gs)), cw = inner / cols;
              const cxI = Math.min(cols - 1, Math.floor((px_ - pad) / cw));
              const gv = (py_ - (b.h - gs) * 0.5) / gs;
              if (gv > 0 && gv < 1) {
                const gu = ((px_ - pad) - cxI * cw) / cw;
                const m = glyph((hash(id * 31 + cxI, 22) * 7.99) | 0, gu, gv) * sstep(0, 2 * q, e2);
                gl[i] = m; h -= 0.2 * m;
              }
            }
          }
        }
      }
      hd[i] = h;
    }
  }
  const cav = cavity(H, Math.max(2, Math.round(3 * q)));
  const pal = ramp(o.pal), joint = col(o.joint);
  const px = runPass(S, (x, y, i, c) => {
    const id = C.id[i];
    const m1 = g(mid, x, y, id * 13, id * 5), f1 = g(fine, x, y, id * 3, id * 17);
    const t = sstep(mh - 0.5, mh + 0.5, E[i]);
    pal(tTone[id], c, tBright[id] + (m1 - 0.5) * o.mottle + (f1 - 0.5) * 0.3 + (grain[i] - 0.5) * 0.12);
    if (o.hue) { c[0] *= 1 + tHue[id]; c[2] *= 1 - tHue[id]; }
    if (o.strata) {
      const sy = y + 52 * q * (g(blot, x, y) - 0.5);
      const band = 0.5 + 0.5 * Math.sin(sy * 6.2832 * o.strata / S + tStr[id]);
      scaleC(c, 0.93 + 0.14 * band * (0.6 + 0.8 * g(sH, x, y)));
    }
    if (gr[i] > 0) scaleC(c, 1 - 0.14 * gr[i]);
    if (gl[i] > 0) scaleC(c, 1 - 0.3 * gl[i]);
    if (o.soot) {
      const sk = sstep(0.5, 0.95, g(sV, x, y)) * o.soot;
      if (sk > 0) scaleC(c, 1 - 0.3 * sk);
    }
    if (o.lichen) {
      const li = sstep(0.7, 0.8, g(blot, x, y, id * 19, 31) * 0.55 + g(mid, x, y, 91, id) * 0.45) * o.lichen;
      if (li > 0) toward(c, 0.55, 0.58, 0.34, li * 0.6);
    }
    let rough = o.rough + 0.14 * (f1 - 0.5) + 0.06 * (m1 - 0.5);
    if (t < 1) { towardC(c, joint, 1 - t); rough += (0.95 - rough) * (1 - t); }
    scaleC(c, Math.min(1.3, Math.max(0.5, 1 + cav[i] * 2.0)));
    c[3] = rough;
  });
  return finish(H, px, { ns: o.ns });
}

def('stone_blocks', 'stone', 2, 512, S => masonryGen(S, {
  seed: 1, ox: 0, oy: 0, mh: 2.4, bv: 5, wob: 4, relief: 0.12, grit: 0.1, ridged: 0.08, chisel: 0, mottle: 0.5,
  hue: 0.08, soot: 0.6, lichen: 0.5, rough: 0.86, ns: 3.6, joint: '#403f3e',
  pal: [[0, '#6a6b70'], [0.3, '#7d7c7b'], [0.6, '#8b8782'], [1, '#a29d94']],
  layout: (S, rng) => rowLayout(S, [1, 1, 1, 1], [3, 2, 3, 2], rng, [0.8, 1.5]),
}));
def('stone_tiles', 'stone', 2, 512, S => masonryGen(S, {
  seed: 2, ox: 191, oy: 43, mh: 2.6, bv: 4, wob: 5, relief: 0.1, grit: 0.12, ridged: 0.1, chisel: 0, mottle: 0.45,
  hue: 0.16, soot: 0.3, lichen: 0, rough: 0.68, ns: 3, joint: '#25292b',
  pal: [[0, '#394045'], [0.4, '#4b5357'], [0.75, '#5f6667'], [1, '#747a78']],
  layout: (S, rng) => rowLayout(S, [1.15, 0.85, 1, 1], [3, 4, 3, 4], rng, [0.7, 1.3]),
}));
def('sandstone', 'stone', 2, 512, S => masonryGen(S, {
  seed: 3, ox: 53, oy: 251, mh: 2.2, bv: 5.5, wob: 4.5, relief: 0.1, grit: 0.12, ridged: 0.06, chisel: 0.75, mottle: 0.45,
  hue: 0.05, soot: 0.35, lichen: 0, rough: 0.9, ns: 3.3, strata: 9, joint: '#5a4630',
  pal: [[0, '#b58753'], [0.4, '#c99b64'], [0.75, '#d9b07a'], [1, '#e6c793']],
  layout: (S, rng) => rowLayout(S, [1, 1, 1, 1], [2, 3, 2, 3], rng, [0.8, 1.4]),
}));
def('sandstone_dark', 'stone', 2, 512, S => masonryGen(S, {
  seed: 4, ox: 307, oy: 19, mh: 2.4, bv: 5, wob: 3.5, relief: 0.08, grit: 0.1, ridged: 0.05, chisel: 0.35, mottle: 0.4,
  hue: 0.05, soot: 0.5, lichen: 0, rough: 0.88, ns: 3.4, strata: 6, carved: true, joint: '#1f1510',
  pal: [[0, '#5b3a26'], [0.4, '#714830'], [0.75, '#835a3b'], [1, '#976a45']],
  layout: (S, rng) => rowLayout(S, [1, 1, 1, 1], [2, 2, 2, 2], rng, [0.9, 1.1]),
}));

// ------------------------------------------------------------------ tiles_white

def('tiles_white', 'stone', 1.2, 512, S => {
  const B = bank(S), q = S / 512;
  const { mid, fine, grain, blot } = B;
  const g = sampler(S, 233, 149);
  const C = buildCells(S, gridLayout(S, 4));
  const mh = 1.7 * q, bv = 3 * q;
  const H = new Field(S), hd = H.data;
  const chip = new Float32Array(S * S);
  const tw = S / 4;
  for (let y = 0, i = 0; y < S; y++) {
    for (let x = 0; x < S; x++, i++) {
      const id = C.id[i];
      const e = C.ed[i] + (g(fine, x, y) - 0.5) * 0.8 * q;
      const t = sstep(mh, mh + bv, e);
      const du = C.lu[i] - 0.5, dv = C.lv[i] - 0.5;
      let h = 0.12 + (0.82 + 0.05 * (1 - 4 * (du * du + dv * dv)) - 0.12) * t + 0.02 * (g(mid, x, y, id * 5, id * 9) - 0.5) * t;
      if (hash(id, 5) < 0.14) {
        const hx = hash(id, 6) < 0.5 ? 0 : 1, hy = hash(id, 7) < 0.5 ? 0 : 1;
        const dx = Math.abs(C.lu[i] - hx) * tw, dy = Math.abs(C.lv[i] - hy) * tw;
        const R = (8 + 8 * hash(id, 8)) * q;
        const d = Math.sqrt(dx * dx + dy * dy) + (g(fine, x, y) - 0.5) * 6 * q;
        if (d < R) { const ch = sstep(R, R * 0.6, d); chip[i] = ch; h -= 0.3 * ch * t; }
      }
      hd[i] = h;
    }
  }
  const cav = cavity(H, Math.max(2, Math.round(3 * q)));
  const px = runPass(S, (x, y, i, c) => {
    const id = C.id[i];
    const e = C.ed[i] + (g(fine, x, y) - 0.5) * 0.8 * q;
    const t = sstep(mh - 0.5, mh + 0.5, e);
    const tone = 0.93 + 0.07 * hash(id, 2);
    const wc = (hash(id, 3) - 0.5) * 0.05;
    c[0] = 0.86 * tone * (1 + wc); c[1] = 0.865 * tone; c[2] = 0.85 * tone * (1 - wc);
    scaleC(c, 1 + (g(mid, x, y, id * 5, id * 9) - 0.5) * 0.06 + (grain[i] - 0.5) * 0.03);
    const dirt = sstep(0.6, 0.9, g(blot, x, y, id * 23, 5)) * 0.07;
    scaleC(c, 1 - dirt);
    if (chip[i] > 0) toward(c, 0.72, 0.6, 0.48, chip[i] * 0.9);
    let rough = 0.14 + 0.12 * hash(id, 4) + 0.06 * (g(fine, x, y) - 0.5);
    if (chip[i] > 0) rough += 0.5 * chip[i];
    if (t < 1) {
      const k = 0.7 + 0.3 * grain[i] + 0.35 * (g(mid, x, y) - 0.5);
      toward(c, 0.42 * k, 0.42 * k, 0.4 * k, 1 - t);
      rough += (0.92 - rough) * (1 - t);
    }
    scaleC(c, Math.min(1.25, Math.max(0.55, 1 + cav[i] * 1.8)));
    c[3] = rough;
  });
  return finish(H, px, { ns: 2.4 });
});

// ------------------------------------------------------------------ marble

def('marble', 'stone', 2, 512, S => {
  const B = bank(S), q = S / 512;
  const { mid, fine, grain, blot } = B;
  const g = sampler(S, 17, 401);
  const C = buildCells(S, gridLayout(S, 2));
  const H = new Field(S), hd = H.data;
  const vein = new Float32Array(S * S), halo = new Float32Array(S * S), fineV = new Float32Array(S * S);
  const half = S / 2, PI = 3.1416;
  const sl = [];
  for (let id = 0; id < 4; id++) {
    const a1 = hash(id, 3) * PI, a2 = a1 + 0.6 + hash(id, 4) * 0.9;
    const k1 = 2 * (2.0 + 1.4 * hash(id, 5)) / S, k2 = 2 * (5 + 2.5 * hash(id, 7)) / S;
    sl.push({
      ox: (hash(id, 1) * S) | 0, oy: (hash(id, 2) * S) | 0,
      c1: Math.cos(a1) * k1, s1: Math.sin(a1) * k1, p1: hash(id, 6) * 4,
      c2: Math.cos(a2) * k2, s2: Math.sin(a2) * k2, p2: hash(id, 8) * 4,
      tone: 0.96 + 0.05 * hash(id, 4),
    });
  }
  for (let y = 0, i = 0; y < S; y++) {
    for (let x = 0; x < S; x++, i++) {
      const id = C.id[i], w_ = sl[id], ox = w_.ox, oy = w_.oy;
      const lx = x % half, ly = y % half;
      const turb = (g(blot, x, y, ox, oy) - 0.5) * 0.7 + (g(mid, x, y, oy, ox) - 0.5) * 0.55 + (g(fine, x, y, ox, 7) - 0.5) * 0.16;
      const f1 = Math.abs(Math.sin(PI * (lx * w_.c1 + ly * w_.s1 + turb + w_.p1)));
      const w = 0.03 + 0.07 * g(blot, x, y, ox + 200, oy + 30);
      vein[i] = (1 - sstep(w * 0.25, w, f1)) * 0.95;
      const hl = 1 - sstep(0, 0.42, f1);
      halo[i] = hl * hl * 0.55;
      const gate = sstep(0.5, 0.62, g(mid, x, y, ox + 90, oy + 140));
      if (gate > 0) {
        const f2 = Math.abs(Math.sin(PI * (lx * w_.c2 + ly * w_.s2 + turb * 1.2 + w_.p2)));
        fineV[i] = (1 - sstep(0.012, 0.05, f2)) * gate * 0.7;
      }
      const e = C.ed[i];
      hd[i] = 0.7 * sstep(0.6 * q, 2.4 * q, e) + 0.3 + 0.015 * (g(fine, x, y) - 0.5);
    }
  }
  const px = runPass(S, (x, y, i, c) => {
    const id = C.id[i];
    const cloud = (g(blot, x, y, id * 37, 3) - 0.5) * 0.8 + (g(mid, x, y, id * 11, 8) - 0.5) * 0.5;
    const tone = sl[id].tone;
    c[0] = (0.87 + cloud * 0.1) * tone; c[1] = (0.865 + cloud * 0.1) * tone; c[2] = (0.84 + cloud * 0.11) * tone;
    scaleC(c, 1 + (grain[i] - 0.5) * 0.03);
    toward(c, 0.6, 0.55, 0.48, halo[i] * 0.55);
    toward(c, 0.34, 0.31, 0.29, fineV[i] * 0.55);
    toward(c, 0.24, 0.26, 0.3, vein[i] * 0.85);
    const e = C.ed[i];
    let rough = 0.13 + 0.12 * (g(mid, x, y) - 0.5) + 0.05 * (g(fine, x, y) - 0.5) + 0.12 * vein[i];
    if (e < 1.6 * q) { toward(c, 0.22, 0.22, 0.22, 1); rough = 0.8; }
    else if (e < 3 * q) scaleC(c, 0.8);
    c[3] = Math.max(0.05, rough);
  });
  return finish(H, px, { ns: 1.2 });
});

// ------------------------------------------------------------------ rock

def('rock', 'stone', 3, 512, S => {
  const B = bank(S), q = S / 512;
  const { mid, fine, grain, blot, ridge } = B;
  const W = B.worley(6, 21), W2 = B.worley(15, 33);
  const g = sampler(S, 91, 173);
  const H = new Field(S), hd = H.data;
  const crev = new Float32Array(S * S);
  for (let y = 0, i = 0; y < S; y++) {
    for (let x = 0; x < S; x++, i++) {
      const id = W.id[i];
      const cr = 1 - sstep(0.0, 0.11, W.edge[i]);
      const cr2 = 1 - sstep(0.0, 0.08, W2.edge[i]);
      crev[i] = Math.max(cr, cr2 * 0.6);
      let h = 0.55 + 0.32 * (hash((id * 255) | 0, 3) - 0.5) - 0.3 * W.f1[i] + 0.16 * (0.5 - W2.f1[i]) * 0.6;
      h += 0.16 * (g(mid, x, y) - 0.5) + 0.1 * (g(fine, x, y) - 0.5) + 0.14 * (g(ridge, x, y) - 0.5) + 0.03 * (grain[i] - 0.5);
      h -= 0.45 * cr + 0.22 * cr2;
      hd[i] = h;
    }
  }
  const cav = cavity(H, Math.max(2, Math.round(4 * q)));
  const pal = ramp([[0, '#2a2622'], [0.35, '#4a423b'], [0.65, '#6b6157'], [1, '#8b8072']]);
  const px = runPass(S, (x, y, i, c) => {
    const idn = W.id[i], idi = (idn * 255) | 0;
    const v = 0.78 + 0.35 * hash(idi, 5) + (g(mid, x, y) - 0.5) * 0.5 + (g(fine, x, y) - 0.5) * 0.35 + (grain[i] - 0.5) * 0.1;
    pal(hash(idi, 6), c, v);
    if (hash(idi, 8) < 0.3) { c[0] *= 0.94; c[2] *= 1.08; }
    const rg = sstep(0.6, 0.85, g(ridge, x, y));
    scaleC(c, 1 - 0.18 * rg);
    const hv = hd[i];
    const li = sstep(0.71, 0.82, g(blot, x, y, 0, 60) * 0.5 + g(mid, x, y, 40, 90) * 0.5) * sstep(0.5, 0.7, hv);
    if (li > 0) toward(c, 0.6, 0.62, 0.36, li * 0.55);
    const mo = sstep(0.55, 0.8, g(blot, x, y, 150, 20)) * crev[i];
    if (mo > 0) toward(c, 0.14, 0.24, 0.09, mo * 0.7);
    scaleC(c, 1 - 0.55 * crev[i]);
    scaleC(c, Math.min(1.35, Math.max(0.45, 1 + cav[i] * 1.6)));
    c[3] = 0.88 + 0.1 * (g(fine, x, y) - 0.5);
  });
  return finish(H, px, { ns: 4.2 });
});
