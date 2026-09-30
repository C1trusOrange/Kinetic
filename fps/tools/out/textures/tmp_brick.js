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

