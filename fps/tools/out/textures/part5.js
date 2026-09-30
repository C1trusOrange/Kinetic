
// ------------------------------------------------------------------ hazard stripes

def('hazard', 'metal', 1, 256, S => {
  const B = bank(S), q = S / 512, N = S * S;
  const { mid, fine, grain, blot } = B;
  const g = sampler(S, 13, 271);
  const rng = mulberry32(909);
  const P = S / 4;
  const H = new Field(S), hd = H.data;
  const stripe = new Float32Array(N), chip = new Float32Array(N);
  const sc = crackMask(S, rng, { count: 12, len: 60, width: 1.2, branch: 0, jitter: 0.06 });
  for (let y = 0, i = 0; y < S; y++) {
    for (let x = 0; x < S; x++, i++) {
      const f = ((x + y + 1) & (P - 1)) / P;
      const d = Math.min(f, Math.abs(f - 0.5), 1 - f) * P / 1.4142 / q * 0.5;
      const sd = f < 0.5 ? d : -d;
      stripe[i] = sstep(-0.9, 0.9, sd);
      const n = 0.45 * g(fine, x, y) + 0.3 * g(mid, x, y, 60, 5) + 0.25 * g(blot, x, y, 4, 77);
      const ch = sstep(0.61, 0.645, n);
      chip[i] = ch;
      hd[i] = 0.55 + 0.06 * stripe[i] + 0.16 * (g(fine, x, y, 5, 5) - 0.5) + 0.12 * (grain[i] - 0.5) - 0.12 * ch - 0.06 * sc[i];
    }
  }
  const cav = cavity(H, 2);
  const px = runPass(S, (x, y, i, c) => {
    const v = 1 + (g(mid, x, y) - 0.5) * 0.18 + (grain[i] - 0.5) * 0.08;
    const s = stripe[i];
    c[0] = (0.06 + (0.95 - 0.06) * s) * v;
    c[1] = (0.06 + (0.73 - 0.06) * s) * v;
    c[2] = (0.065 + (0.06 - 0.065) * s) * v;
    let rough = 0.55 + 0.15 * (g(fine, x, y) - 0.5), metal = 0.08;
    const wear = sstep(0.5, 0.75, g(blot, x, y, 100, 30)) * 0.5;
    toward(c, 0.32, 0.29, 0.24, wear * 0.55 * s);
    scaleC(c, 1 - 0.25 * sstep(0.55, 0.85, g(blot, x, y, 200, 10)));
    const ch = chip[i];
    if (ch > 0) {
      const rr = sstep(0.4, 0.65, g(mid, x, y, 12, 90));
      toward(c, 0.22 + 0.24 * rr, 0.22 + 0.02 * rr, 0.24 - 0.14 * rr, ch);
      rough += (0.6 - rough) * ch; metal += (0.8 - metal) * ch;
      scaleC(c, 1 + 0.3 * ch * (1 - ch) * 4);
    }
    if (sc[i] > 0) { toward(c, 0.62, 0.6, 0.55, sc[i] * 0.55); }
    scaleC(c, Math.min(1.3, Math.max(0.55, 1 + cav[i] * 2)));
    c[3] = rough; c[4] = metal;
  });
  return finish(H, px, { ns: 2.4, metalMap: true });
});

// ------------------------------------------------------------------ rubber (studded mat)

def('rubber', 'metal', 0.5, 256, S => {
  const B = bank(S), q = S / 512, N = S * S;
  const { mid, fine, grain, blot } = B;
  const g = sampler(S, 7, 333);
  const rng = mulberry32(31);
  const H = new Field(S), hd = H.data, T = new Float32Array(N);
  const n = 16, sp = S / n;
  for (let y = 0, i = 0; y < S; y++) for (let x = 0; x < S; x++, i++) hd[i] = 0.16 + 0.05 * (g(fine, x, y) - 0.5) + 0.04 * (grain[i] - 0.5);
  for (let r = 0; r < n; r++) {
    for (let k = 0; k < n; k++) stamp(H, T, (k + 0.5 + (r & 1) * 0.5) * sp, (r + 0.5) * sp, sp * 0.36, 0.7, 1, 'add', 0.42);
  }
  const sc = crackMask(S, rng, { count: 10, len: 60, width: 1.3, branch: 0, jitter: 0.08 });
  const cav = cavity(H, 2);
  const px = runPass(S, (x, y, i, c) => {
    const m1 = g(mid, x, y);
    const top = T[i];
    const v = 0.85 + 0.3 * (m1 - 0.5) + 0.2 * (grain[i] - 0.5);
    const k = 0.055 * v + 0.07 * top * sstep(0.3, 0.9, g(blot, x, y, 5, 5)) + 0.035 * top;
    c[0] = k; c[1] = k; c[2] = k * 1.04;
    if (sc[i] > 0) toward(c, 0.22, 0.22, 0.23, sc[i] * 0.5);
    scaleC(c, Math.min(1.5, Math.max(0.5, 1 + cav[i] * 1.5)));
    c[3] = 0.78 - 0.14 * top + 0.1 * (g(fine, x, y) - 0.5);
    c[4] = 0;
  });
  return finish(H, px, { ns: 3.4 });
});

// ------------------------------------------------------------------ gold (hammered)

def('gold', 'metal', 1, 256, S => {
  const B = bank(S), q = S / 512, N = S * S;
  const { mid, fine, grain, blot } = B;
  const W = B.worley(14, 51);
  const g = sampler(S, 211, 61);
  const rng = mulberry32(77);
  const H = new Field(S), hd = H.data;
  const sc = crackMask(S, rng, { count: 22, len: 70, width: 1, branch: 0, jitter: 0.06 });
  for (let y = 0, i = 0; y < S; y++) {
    for (let x = 0; x < S; x++, i++) {
      const bowl = Math.min(1, W.f1[i] * 1.15);
      hd[i] = 0.32 + 0.4 * bowl * bowl + 0.07 * (g(mid, x, y, 40, 17) - 0.5) + 0.05 * (g(mid, x, y) - 0.5) + 0.03 * (g(fine, x, y) - 0.5) - 0.06 * sc[i];
    }
  }
  const cav = cavity(H, 2);
  const px = runPass(S, (x, y, i, c) => {
    const v = 0.92 + 0.2 * (g(mid, x, y) - 0.5) + 0.08 * (g(fine, x, y) - 0.5) + 0.06 * (grain[i] - 0.5);
    c[0] = 1.0 * v; c[1] = 0.77 * v; c[2] = 0.3 * v;
    let rough = 0.27 + 0.1 * (g(fine, x, y) - 0.5) + 0.05 * (1 - W.f1[i]);
    const tar = sstep(0.62, 0.82, g(blot, x, y, 90, 30) * 0.7 + g(mid, x, y, 5, 5) * 0.3);
    if (tar > 0) { toward(c, 0.5, 0.34, 0.13, tar * 0.6); rough += 0.35 * tar; }
    if (sc[i] > 0) { toward(c, 1, 0.9, 0.6, sc[i] * 0.5); rough -= 0.1 * sc[i]; }
    scaleC(c, Math.min(1.35, Math.max(0.5, 1 + cav[i] * 3.2)));
    c[3] = rough; c[4] = 0.88 - 0.35 * tar;
  });
  return finish(H, px, { ns: 2.6, metalMap: true, props: { envMapIntensity: 1.5 } });
});

// ------------------------------------------------------------------ wood

const _mkTab = salt => { const a = new Float32Array(1024); for (let i = 0; i < 1024; i++) a[i] = hash(i, salt); return a; };
const WH2 = _mkTab(2), WH3 = _mkTab(3), WH4 = _mkTab(4), WH5 = _mkTab(5), WH6 = _mkTab(6), WH7 = _mkTab(7);

/** Wood colour + grain height for a board (grain runs along x). Writes albedo into c, returns grain relief. */
function woodColor(c, pal, id, lx, ly, bh, x, y, g, B, q, o) {
  const { mid, fine, streakH: sH } = B;
  const warp = (g(mid, x, y, id * 13, id * 7) - 0.5) * 14 * q;
  let yy = ly + warp + WH3[id] * 60;
  // knot
  let core = 0;
  if (o.knots > 0 && WH4[id] < o.knots) {
    const kx = (0.2 + 0.6 * WH5[id]) * o.boardLen(id), ky = (0.3 + 0.4 * WH6[id]) * bh;
    const R = (5 + 7 * WH7[id]) * q, dxk = lx - kx, dyk = (ly - ky) * 1.5;
    const d = Math.sqrt(dxk * dxk + dyk * dyk);
    if (d < R * 3.4) {
      yy += 16 * q * Math.exp(-(d * d) / (R * R * 4)) * (dyk < 0 ? -1 : 1);
      core = 1 - sstep(R * 0.35, R, d);
      const halo = 1 - sstep(R, R * 2.6, d);
      yy += halo * 10 * q * Math.sin(d / (2.2 * q));
    }
  }
  const t = yy / (o.ring * q);
  let ring = 0.5 + 0.5 * Math.sin(t * 6.2832);
  ring = ring * ring * (3 - 2 * ring);
  const fib = g(sH, x, y, id * 31, id * 57), f1 = g(fine, x, y, id * 5, id * 3);
  const k = clamp01(0.46 + 0.3 * (ring - 0.5) + 0.55 * (fib - 0.5) + 0.2 * (f1 - 0.5));
  pal(k, c, (0.82 + 0.34 * WH2[id]) * (1 - 0.6 * core));
  return 0.5 * (fib - 0.5) + 0.35 * (ring - 0.5) - 0.5 * core;
}

def('wood_planks', 'wood', 2, 512, S => {
  const B = bank(S), q = S / 512, N = S * S;
  const { fine, grain, blot } = B;
  const g = sampler(S, 421, 9);
  const rng = mulberry32(5150);
  const C = buildCells(S, rowLayout(S, new Array(10).fill(1), [1, 2, 1, 2, 2, 1, 2, 1, 1, 2], rng, [0.55, 1.45]));
  const H = new Field(S), hd = H.data;
  const gh = new Float32Array(N);
  const pal = ramp([[0, '#3f2716'], [0.4, '#623e23'], [0.7, '#815733'], [1, '#a37647']]);
  const opt = { knots: 0.55, ring: 34, boardLen: id => C.blocks[id].w };
  const gap = 1.3 * q, bev = 2.6 * q;
  const col_ = new Float32Array(N * 3);
  for (let y = 0, i = 0; y < S; y++) {
    for (let x = 0; x < S; x++, i++) {
      const id = C.id[i], b = C.blocks[id];
      const gr = woodColor(_c, pal, id, C.lu[i] * b.w, C.lv[i] * b.h, b.h, x, y, g, B, q, opt);
      col_[i * 3] = _c[0]; col_[i * 3 + 1] = _c[1]; col_[i * 3 + 2] = _c[2];
      gh[i] = gr;
      const e = C.ed[i], t = sstep(gap, gap + bev, e);
      hd[i] = 0.08 + 0.72 * t + t * (0.07 * gr + 0.03 * (grain[i] - 0.5));
    }
  }
  // nails at both plank ends
  const nails = [];
  for (const b of C.blocks) {
    for (const [ex, dir] of [[b.x + 13 * q, 1], [b.x + b.w - 13 * q, -1]]) {
      for (const fy of [0.3, 0.7]) nails.push([ex, b.y + b.h * fy]);
    }
  }
  for (const [nx, ny] of nails) { stamp(H, null, nx, ny, 2.6 * q, 0.22, 0, 'add'); stamp(H, null, nx, ny, 4.4 * q, -0.08, 0, 'add'); }
  const cav = cavity(H, Math.max(2, Math.round(2.5 * q)));
  const px = runPass(S, (x, y, i, c) => {
    const id = C.id[i];
    c[0] = col_[i * 3]; c[1] = col_[i * 3 + 1]; c[2] = col_[i * 3 + 2];
    const wthr = sstep(0.5, 0.8, g(blot, x, y, id * 9, 4)) * 0.4;
    toward(c, 0.46, 0.4, 0.34, wthr * 0.5);
    scaleC(c, 1 + (grain[i] - 0.5) * 0.08);
    let rough = 0.66 + 0.16 * (g(fine, x, y) - 0.5) + 0.2 * wthr;
    const e = C.ed[i], t = sstep(gap - 0.5, gap + 0.5, e);
    if (t < 1) { scaleC(c, 0.25 + 0.75 * t); rough += (0.95 - rough) * (1 - t); }
    scaleC(c, Math.min(1.3, Math.max(0.5, 1 + cav[i] * 2.2)));
    c[3] = rough;
  });
  for (const [nx, ny] of nails) {
    // nail heads painted into albedo through a tiny canvas pass
    const ctx = px.albedo.getContext('2d');
    for (const ox of [-S, 0, S]) for (const oy of [-S, 0, S]) {
      const cx = nx + ox, cy = ny + oy;
      if (cx < -6 || cx > S + 6 || cy < -6 || cy > S + 6) continue;
      ctx.fillStyle = 'rgba(26,24,24,0.85)';
      ctx.beginPath(); ctx.arc(cx, cy, 2.6 * q, 0, 6.2832); ctx.fill();
      ctx.fillStyle = 'rgba(110,100,92,0.9)';
      ctx.beginPath(); ctx.arc(cx - 0.6 * q, cy - 0.6 * q, 1.2 * q, 0, 6.2832); ctx.fill();
      ctx.fillStyle = 'rgba(70,40,20,0.35)';
      ctx.fillRect(cx - 1 * q, cy + 2 * q, 2 * q, 9 * q);
    }
  }
  return finish(H, px, { ns: 3 });
});

def('crate', 'wood', 1.2, 512, S => {
  const B = bank(S), q = S / 512, N = S * S;
  const { fine, grain, blot } = B;
  const g = sampler(S, 97, 501);
  const cs = S / 2;                    // one 0.6 m frame cell
  const fh = 21.5 * q;                 // half width of a frame board (0.1 m boards)
  const inner = cs - 2 * fh, planks = 3, pw = inner / planks;
  const gap = 1.3 * q, bev = 2.4 * q;
  const pal = ramp([[0, '#6b4a28'], [0.4, '#8f6a3d'], [0.75, '#b08652'], [1, '#cea877']]);
  const opt = { knots: 0.45, ring: 30, boardLen: id => (id < 300 ? S : cs) };
  const H = new Field(S), hd = H.data;
  const col_ = new Float32Array(N * 3), edge = new Float32Array(N);
  const R2 = 1 / Math.SQRT2;
  for (let y = 0, i = 0; y < S; y++) {
    const cyI = Math.floor(y / cs), ly = y + 0.5 - cyI * cs, dyb = Math.min(ly, cs - ly);
    for (let x = 0; x < S; x++, i++) {
      const cxI = Math.floor(x / cs), lx = x + 0.5 - cxI * cs, dxb = Math.min(lx, cs - lx);
      let id, along, across, bh, e, top, base;
      if (dxb < fh) {                            // vertical stile straddling a cell boundary
        const bn = Math.round((x + 0.5) / cs);
        id = 100 + (bn % 2); along = y + 0.5; across = x + 0.5 - (bn * cs - fh); bh = 2 * fh;
        e = fh - dxb; top = 1.0; base = 0.05;
      } else if (dyb < fh) {                     // horizontal rail between two stiles
        const bn = Math.round((y + 0.5) / cs);
        id = 200 + (bn % 2); along = x + 0.5; across = y + 0.5 - (bn * cs - fh); bh = 2 * fh;
        e = Math.min(fh - dyb, dxb - fh); top = 0.98; base = 0.05;
      } else {
        const px_ = lx - fh, py_ = ly - fh;
        const pIdx = Math.min(planks - 1, Math.floor(py_ / pw));
        const lyy = py_ - pIdx * pw;
        const ep = Math.min(lyy, pw - lyy, px_, inner - px_);
        const hp = 0.05 + 0.77 * sstep(gap, gap + bev, ep);
        const flip = ((cxI + cyI) & 1) === 1;
        const fx = flip ? inner - px_ : px_;
        const dd = Math.abs(fx + py_ - inner) * R2;
        const bw = fh * 0.92;
        if (dd < bw) {                           // diagonal brace over the planks
          id = 300 + cxI * 2 + cyI; along = (fx - py_ + inner) * R2 + 40; across = dd + bw; bh = bw * 2;
          e = Math.min(bw - dd, px_, inner - px_, py_, inner - py_); top = 0.93; base = hp;
        } else {
          id = 400 + (cxI * 2 + cyI) * 4 + pIdx; along = px_; across = lyy; bh = pw;
          e = ep; top = 0.82; base = 0.05;
        }
      }
      const gr = woodColor(_c, pal, id, along, across, bh, x, y, g, B, q, opt);
      col_[i * 3] = _c[0]; col_[i * 3 + 1] = _c[1]; col_[i * 3 + 2] = _c[2];
      edge[i] = e;
      const t = sstep(gap, gap + bev, e);
      hd[i] = base + (top - base) * t + t * (0.06 * gr + 0.03 * (grain[i] - 0.5));
    }
  }
  const nails = [];
  for (let cy = 0; cy < 2; cy++) {
    for (let cx = 0; cx < 2; cx++) {
      const x0 = cx * cs, y0 = cy * cs;
      for (let k = 0; k < planks; k++) nails.push([x0, y0 + fh + (k + 0.5) * pw]);
      const flip = ((cx + cy) & 1) === 1;
      const ax = flip ? 0.86 * inner : 0.14 * inner, bx = flip ? 0.14 * inner : 0.86 * inner;
      nails.push([x0 + fh + ax, y0 + fh + 0.86 * inner], [x0 + fh + bx, y0 + fh + 0.14 * inner]);
    }
  }
  for (const [nx, ny] of nails) { stamp(H, null, nx, ny, 2.8 * q, 0.2, 0, 'add'); stamp(H, null, nx, ny, 4.6 * q, -0.07, 0, 'add'); }
  const cav = cavity(H, Math.max(2, Math.round(2.5 * q)));
  const px = runPass(S, (x, y, i, c) => {
    c[0] = col_[i * 3]; c[1] = col_[i * 3 + 1]; c[2] = col_[i * 3 + 2];
    const wthr = sstep(0.5, 0.8, g(blot, x, y, 33, 4)) * 0.35;
    toward(c, 0.5, 0.44, 0.36, wthr * 0.5);
    scaleC(c, 1 + (grain[i] - 0.5) * 0.08);
    let rough = 0.7 + 0.14 * (g(fine, x, y) - 0.5);
    const e = edge[i], t = sstep(gap - 0.5, gap + 0.5, e);
    if (t < 1) { scaleC(c, 0.22 + 0.78 * t); rough += (0.95 - rough) * (1 - t); }
    scaleC(c, Math.min(1.3, Math.max(0.5, 1 + cav[i] * 2.2)));
    c[3] = rough;
  });
  const ctx = px.albedo.getContext('2d');
  for (const [nx, ny] of nails) {
    for (const ox of [-S, 0, S]) for (const oy of [-S, 0, S]) {
      const cx = nx + ox, cy = ny + oy;
      if (cx < -6 || cx > S + 6 || cy < -6 || cy > S + 6) continue;
      ctx.fillStyle = 'rgba(28,26,26,0.9)';
      ctx.beginPath(); ctx.arc(cx, cy, 2.8 * q, 0, 6.2832); ctx.fill();
      ctx.fillStyle = 'rgba(120,110,100,0.9)';
      ctx.beginPath(); ctx.arc(cx - 0.7 * q, cy - 0.7 * q, 1.2 * q, 0, 6.2832); ctx.fill();
      ctx.fillStyle = 'rgba(80,44,22,0.4)';
      ctx.fillRect(cx - 1 * q, cy + 2.4 * q, 2 * q, 10 * q);
    }
  }
  return finish(H, px, { ns: 3.2 });
});
