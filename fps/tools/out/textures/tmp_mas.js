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

