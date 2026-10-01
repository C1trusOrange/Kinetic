/**
 * KINETIC - procedural PBR material library (ARCHITECTURE.md section 6.1).
 *
 * Every material is generated lazily on first use (getMaterial) or in the background
 * (preloadMaterials) from noise fields + structural stamps. Each material owns:
 *   map (albedo), normalMap (from a float height field), roughnessMap (G) that doubles as
 *   metalnessMap (B) where the metalness varies, plus emissiveMap / alphaMap where needed.
 * All textures tile seamlessly: noise banks wrap, structures are laid out on integer repeats.
 *
 * Performance notes: per-pixel loops write straight into ImageData with scratch Float32Arrays
 * (no allocations), noise banks are shared between materials, container colours share their
 * normal / roughness / metalness maps.
 */
import * as THREE from 'three';
import { Field, getNoise, noiseField, makeCanvas, canvasTexture, setMaxAnisotropy } from '../core/procgen.js';
import { mulberry32, yieldHiddenSafe } from '../core/utils.js';

// ------------------------------------------------------------------ math / colour helpers

const clamp01 = x => (x < 0 ? 0 : x > 1 ? 1 : x);
const sstep = (a, b, x) => {
  const t = (x - a) / (b - a);
  return t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t);
};

/** Deterministic hash of an integer id (+ salt) to [0, 1). */
function hash(n, s = 0) {
  let h = Math.imul(n | 0, 0x9E3779B1) ^ Math.imul((s | 0) + 0x7F4A7C15, 0x85EBCA6B);
  h ^= h >>> 15; h = Math.imul(h, 0x2C1B3C6D);
  h ^= h >>> 12; h = Math.imul(h, 0x297A2D39);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

/** '#rrggbb' | 0xrrggbb -> [r, g, b] sRGB floats. */
function col(c) {
  const n = typeof c === 'string' ? parseInt(c.replace('#', ''), 16) : c;
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/** Multi-stop colour ramp baked into a 256-entry LUT. Returns fn(t, out, k = 1) writing out[0..2] = colour * k. */
function ramp(stops) {
  const s = stops.map(([t, c]) => [t, Array.isArray(c) ? c : col(c)]);
  const lut = new Float32Array(256 * 3);
  for (let q = 0; q < 256; q++) {
    const t = q / 255;
    let a = s[0], b = s[s.length - 1];
    for (let i = 1; i < s.length; i++) if (t <= s[i][0]) { a = s[i - 1]; b = s[i]; break; }
    const k = b[0] === a[0] ? 0 : clamp01((t - a[0]) / (b[0] - a[0]));
    for (let j = 0; j < 3; j++) lut[q * 3 + j] = a[1][j] + (b[1][j] - a[1][j]) * k;
  }
  return (t, out, k = 1) => {
    let q = (t * 255 + 0.5) | 0;
    q = q < 0 ? 0 : q > 255 ? 255 : q;
    out[0] = lut[q * 3] * k; out[1] = lut[q * 3 + 1] * k; out[2] = lut[q * 3 + 2] * k;
  };
}

/** c = c + (target - c) * t  (all three channels). */
function toward(c, r, g, b, t) {
  c[0] += (r - c[0]) * t; c[1] += (g - c[1]) * t; c[2] += (b - c[2]) * t;
}
function towardC(c, a, t) { toward(c, a[0], a[1], a[2], t); }
function scaleC(c, k) { c[0] *= k; c[1] *= k; c[2] *= k; }
function setC(c, a, k = 1) { c[0] = a[0] * k; c[1] = a[1] * k; c[2] = a[2] * k; }

// ------------------------------------------------------------------ shared noise banks

const _banks = new Map();

/** Lazily built, cached noise arrays for a texture size (Float32Array of S*S, wrapping). */
class Bank {
  constructor(S) { this.S = S; this.m = S - 1; this._ = Object.create(null); }
  /** Large soft blotches (0..1). */
  get blot() { return this._.blot || (this._.blot = noiseField(this.S, 3, 5, 101).data); }
  /** Medium mottling. */
  get mid() { return this._.mid || (this._.mid = noiseField(this.S, 8, 4, 202).data); }
  /** Fine grit. */
  get fine() { return this._.fine || (this._.fine = noiseField(this.S, 32, 3, 303).data); }
  /** Per-pixel white noise. */
  get grain() {
    if (!this._.grain) {
      const r = mulberry32(777), a = new Float32Array(this.S * this.S);
      for (let i = 0; i < a.length; i++) a[i] = r();
      this._.grain = a;
    }
    return this._.grain;
  }
  /** Ridged noise, ~1 along creases (rock, water). */
  get ridge() {
    if (!this._.ridge) {
      const n = getNoise(505), S = this.S, a = new Float32Array(S * S);
      let i = 0;
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) a[i++] = n.ridged((x + 0.5) / S, (y + 0.5) / S, 4, 4, 0.5);
      this._.ridge = a;
    }
    return this._.ridge;
  }
  _streak(fx, fy, seed) {
    const n = getNoise(seed), S = this.S, a = new Float32Array(S * S);
    let lo = 9, hi = -9, i = 0;
    for (let y = 0; y < S; y++) {
      const v = (y + 0.5) / S;
      for (let x = 0; x < S; x++) {
        const u = (x + 0.5) / S;
        const s = n.perlin(u * fx, v * fy, fx, fy) + 0.5 * n.perlin(u * fx * 2, v * fy * 2, fx * 2, fy * 2);
        a[i++] = s;
        if (s < lo) lo = s;
        if (s > hi) hi = s;
      }
    }
    const k = 1 / (hi - lo);
    for (let j = 0; j < a.length; j++) a[j] = (a[j] - lo) * k;
    return a;
  }
  /** Streaks running along X (varies quickly with y). */
  get streakH() { return this._.sh || (this._.sh = this._streak(2, 44, 606)); }
  /** Streaks running along Y (varies quickly with x). */
  get streakV() { return this._.sv || (this._.sv = this._streak(44, 2, 707)); }
  /** Cellular noise: { f1, edge (f2 - f1), id (0..1) } with `cells` feature points across the tile. */
  worley(cells, seed = 9) {
    const key = 'w' + cells + '_' + seed;
    if (!this._[key]) {
      const S = this.S, rng = mulberry32(seed * 7919 + cells);
      const px = new Float32Array(cells * cells), py = new Float32Array(cells * cells), pid = new Float32Array(cells * cells);
      for (let i = 0; i < px.length; i++) { px[i] = rng(); py[i] = rng(); pid[i] = rng(); }
      const f1 = new Float32Array(S * S), edge = new Float32Array(S * S), id = new Float32Array(S * S);
      let i = 0;
      for (let y = 0; y < S; y++) {
        const fy = (y + 0.5) / S * cells, cy = Math.floor(fy);
        for (let x = 0; x < S; x++) {
          const fx = (x + 0.5) / S * cells, cx = Math.floor(fx);
          let d1 = 9, d2 = 9, best = 0;
          for (let oy = -1; oy <= 1; oy++) {
            let wy = (cy + oy) % cells; if (wy < 0) wy += cells;
            for (let ox = -1; ox <= 1; ox++) {
              let wx = (cx + ox) % cells; if (wx < 0) wx += cells;
              const k = wy * cells + wx;
              const dx = cx + ox + px[k] - fx, dy = cy + oy + py[k] - fy;
              const d = dx * dx + dy * dy;
              if (d < d1) { d2 = d1; d1 = d; best = k; } else if (d < d2) d2 = d;
            }
          }
          const r1 = Math.sqrt(d1);
          f1[i] = r1; edge[i] = Math.sqrt(d2) - r1; id[i] = pid[best]; i++;
        }
      }
      this._[key] = { f1, edge, id };
    }
    return this._[key];
  }
}
function bank(S) {
  let b = _banks.get(S);
  if (!b) { b = new Bank(S); _banks.set(S, b); }
  return b;
}

// ------------------------------------------------------------------ field / stamp helpers

/**
 * Height field minus its box-blurred copy (single wrapping pass, radius r + 1): positive on
 * convex edges, negative in cavities. Used as cheap ambient occlusion / edge highlight.
 */
function cavity(H, r = 3) {
  const S = H.w, m = S - 1, a = H.data, n = S * S;
  const tmp = new Float32Array(n), out = new Float32Array(n), acc = new Float32Array(S);
  r += 1;
  const inv = 1 / (2 * r + 1);
  for (let y = 0; y < S; y++) {
    const row = y * S;
    let s = 0;
    for (let k = -r; k <= r; k++) s += a[row + (k & m)];
    for (let x = 0; x < S; x++) {
      tmp[row + x] = s * inv;
      s += a[row + ((x + r + 1) & m)] - a[row + ((x - r) & m)];
    }
  }
  for (let k = -r; k <= r; k++) { const row = (k & m) * S; for (let x = 0; x < S; x++) acc[x] += tmp[row + x]; }
  for (let y = 0; y < S; y++) {
    const row = y * S, add = ((y + r + 1) & m) * S, sub = ((y - r) & m) * S;
    for (let x = 0; x < S; x++) {
      out[row + x] = a[row + x] - acc[x] * inv;
      acc[x] += tmp[add + x] - tmp[sub + x];
    }
  }
  return out;
}

/**
 * Stamp a dome (pebble / rivet / pit when h < 0) into H. T (optional) receives `tone` where
 * the stamp is visible. mode 'max': pebble packing (highest wins); 'add': accumulate.
 */
function stamp(H, T, cx, cy, r, h, tone, mode = 'max', round = 0.5) {
  const S = H.w, d = H.data, rr = r * r, ah = Math.abs(h);
  const x0 = Math.floor(cx - r), x1 = Math.ceil(cx + r), y0 = Math.floor(cy - r), y1 = Math.ceil(cy + r);
  for (let yy = y0; yy <= y1; yy++) {
    const py = ((yy % S) + S) % S, dy = yy + 0.5 - cy;
    for (let xx = x0; xx <= x1; xx++) {
      const dx = xx + 0.5 - cx, q = (dx * dx + dy * dy) / rr;
      if (q >= 1) continue;
      const k = py * S + (((xx % S) + S) % S);
      let v = Math.sqrt(1 - q);
      if (round !== 0.5) v = Math.pow(1 - q, round);
      v *= h;
      if (mode === 'max') {
        if (v > d[k]) { d[k] = v; if (T) T[k] = tone; }
      } else {
        d[k] += v;
        if (T && Math.abs(v) > 0.15 * ah) T[k] = tone;
      }
    }
  }
}

/**
 * Partition of the texture into rectangles (blocks / bricks / tiles / planks). Blocks are
 * {x, y, w, h} in pixels, may extend past S (they wrap). Returns per-pixel id, edge distance
 * (px to the nearest block edge) and local coordinates (0..1).
 */
function buildCells(S, blocks) {
  const n = S * S;
  const id = new Uint16Array(n), ed = new Float32Array(n), lu = new Float32Array(n), lv = new Float32Array(n);
  for (let k = 0; k < blocks.length; k++) {
    const b = blocks[k];
    const x0 = Math.ceil(b.x - 0.5), x1 = Math.ceil(b.x + b.w - 0.5);
    const y0 = Math.ceil(b.y - 0.5), y1 = Math.ceil(b.y + b.h - 0.5);
    for (let yy = y0; yy < y1; yy++) {
      const py = ((yy % S) + S) % S, fy = yy + 0.5 - b.y, dy = Math.min(fy, b.h - fy);
      for (let xx = x0; xx < x1; xx++) {
        const px = ((xx % S) + S) % S, fx = xx + 0.5 - b.x, i = py * S + px;
        id[i] = k;
        ed[i] = Math.min(dy, fx, b.w - fx);
        lu[i] = fx / b.w;
        lv[i] = fy / b.h;
      }
    }
  }
  return { id, ed, lu, lv, blocks };
}

// ------------------------------------------------------------------ per-pixel pass -> canvases

const _c = new Float32Array(12);

/**
 * Glare control. Large glossy / metallic surfaces mirror the sky, the sun and every lamp as bright sheets
 * and hotspots. Every material's roughness is remapped from [0..1] to [rough..1] (a raised floor: polished
 * stays polished, but never mirror-like) and its metalness capped, so light scatters and diffuses instead.
 * Per-material overrides below (glass, water, gold keep a little more shine; the near-white marble / tile floors, which
 * cover a lot of screen, are also a touch darker: pure white under a lamp is what reads as a glaring sheet).
 */
const GLARE_DEFAULT = { rough: 0.36, metal: 0.66, albedo: 1 };
const GLARE_OVERRIDE = {
  water: { rough: 0.14, metal: 1, albedo: 1 },
  glass_window: { rough: 0.22, metal: 0.85, albedo: 1 },
  gold: { rough: 0.22, metal: 0.9, albedo: 1 },
  marble: { rough: 0.32, metal: 1, albedo: 0.86 },
  tiles_white: { rough: 0.34, metal: 1, albedo: 0.86 },
};
let _glare = GLARE_DEFAULT;

/**
 * Detail softening: after a material's albedo is generated, every pixel is pulled toward the texture's mean colour by
 * this fraction, so grime, blotches, speckle and grout read as calm surface variation instead of busy noise (the
 * structure stays, only its contrast drops). Emissive materials (signs, neon, lamps) are exempt automatically.
 * Normal maps are flattened by NORMAL_SCALE for the same reason (softer bumps, less shimmering highlights).
 */
const SOFTEN_DEFAULT = 0.3;
const SOFTEN_OVERRIDE = { hazard: 0, dev_grid: 0, gold: 0.1, crate: 0.2, cloud: 0, snow: 0.2 };
const NORMAL_SCALE = 0.72;
let _soften = SOFTEN_DEFAULT;

/**
 * Runs fn(x, y, i, c) for every pixel. c[0..2] albedo, c[3] roughness, c[4] metalness,
 * c[5..7] emissive colour, c[8] alpha (only when alpha: true). Returns canvases.
 */
function runPass(S, fn, { emissive = false, alpha = false } = {}) {
  const A = makeCanvas(S), R = makeCanvas(S);
  const ia = A.ctx.createImageData(S, S), ir = R.ctx.createImageData(S, S);
  const a = ia.data, r = ir.data;
  let E = null, ie = null, e = null, L = null, il = null, al = null;
  if (emissive) { E = makeCanvas(S); ie = E.ctx.createImageData(S, S); e = ie.data; }
  if (alpha) { L = makeCanvas(S); il = L.ctx.createImageData(S, S); al = il.data; }
  const c = _c;
  for (let y = 0, i = 0; y < S; y++) {
    for (let x = 0; x < S; x++, i++) {
      c[0] = c[1] = c[2] = 0.5; c[3] = 0.8; c[4] = 0; c[5] = c[6] = c[7] = 0; c[8] = 1;
      fn(x, y, i, c);
      c[3] = _glare.rough + (1 - _glare.rough) * c[3];
      if (c[4] > _glare.metal) c[4] = _glare.metal;
      if (_glare.albedo !== 1) { c[0] *= _glare.albedo; c[1] *= _glare.albedo; c[2] *= _glare.albedo; }
      const j = i << 2;
      a[j] = c[0] * 255; a[j + 1] = c[1] * 255; a[j + 2] = c[2] * 255; a[j + 3] = 255;
      r[j] = 255; r[j + 1] = c[3] * 255; r[j + 2] = c[4] * 255; r[j + 3] = 255;
      if (e) { e[j] = c[5] * 255; e[j + 1] = c[6] * 255; e[j + 2] = c[7] * 255; e[j + 3] = 255; }
      if (al) { al[j] = al[j + 1] = al[j + 2] = c[8] * 255; al[j + 3] = 255; }
    }
  }
  if (_soften > 0 && !emissive) softenAlbedo(a, S * S, _soften);
  A.ctx.putImageData(ia, 0, 0);
  R.ctx.putImageData(ir, 0, 0);
  if (E) E.ctx.putImageData(ie, 0, 0);
  if (L) L.ctx.putImageData(il, 0, 0);
  return { albedo: A.canvas, rm: R.canvas, emissive: E ? E.canvas : null, alpha: L ? L.canvas : null };
}

/** Pull every albedo pixel (RGBA bytes, n pixels) toward the mean colour by fraction k (see SOFTEN_DEFAULT). */
function softenAlbedo(a, n, k) {
  let r = 0, g = 0, b = 0;
  for (let j = 0, e = n << 2; j < e; j += 4) { r += a[j]; g += a[j + 1]; b += a[j + 2]; }
  r /= n; g /= n; b /= n;
  const f = 1 - k;
  for (let j = 0, e = n << 2; j < e; j += 4) {
    a[j] = r + (a[j] - r) * f;
    a[j + 1] = g + (a[j + 1] - g) * f;
    a[j + 2] = b + (a[j + 2] - b) * f;
  }
}

/** Canvas textures for a finished pass. */
function finish(H, px, o = {}) {
  const g = {
    map: canvasTexture(px.albedo, { srgb: true }),
    normalMap: o.normalMap || canvasTexture(H.toNormalCanvas(o.ns ?? 3), { srgb: false }),
    rm: o.rm || canvasTexture(px.rm, { srgb: false }),
    metalMap: !!o.metalMap,
    metalness: o.metalness ?? 0,
    props: o.props || null,
  };
  if (px.emissive) g.emissiveMap = canvasTexture(px.emissive, { srgb: true });
  if (px.alpha) g.alphaMap = canvasTexture(px.alpha, { srgb: false });
  return g;
}

/** Sampler for a noise array with a per-material offset: at(arr, x, y[, dx, dy]). */
function sampler(S, ox, oy) {
  const m = S - 1;
  return (a, x, y, dx = 0, dy = 0) => a[((y + dy + oy) & m) * S + ((x + dx + ox) & m)];
}


/**
 * Random-walk crack network (0..1 alpha, AA, wraps): count cracks of ~len px with width px,
 * tapering to a point and branching. Sizes are given for a 512 texture and scaled to S.
 */
function crackMask(S, rng, { count = 6, len = 160, width = 1.4, branch = 0.35, jitter = 0.3 } = {}) {
  const out = new Float32Array(S * S), q = S / 512;
  const dot = (x, y, w) => {
    const r = w * 0.5 + 1.2;
    for (let yy = Math.floor(y - r); yy <= Math.ceil(y + r); yy++) {
      const py = ((yy % S) + S) % S, dy = yy + 0.5 - y;
      for (let xx = Math.floor(x - r); xx <= Math.ceil(x + r); xx++) {
        const dx = xx + 0.5 - x, d = Math.sqrt(dx * dx + dy * dy);
        const a = 1 - sstep(w * 0.5 - 0.25, w * 0.5 + 0.9, d);
        if (a <= 0) continue;
        const k = py * S + (((xx % S) + S) % S);
        if (a > out[k]) out[k] = a;
      }
    }
  };
  const walk = (x, y, ang, length, w, depth) => {
    const steps = Math.max(2, (length / 1.5) | 0);
    let a = ang;
    for (let s = 0; s < steps; s++) {
      const t = s / steps;
      dot(x, y, Math.max(0.9, w * (1 - t * 0.8)));
      a += (rng() - 0.5) * jitter + (rng() < 0.05 ? (rng() - 0.5) * 1.1 : 0);
      x += Math.cos(a) * 1.5; y += Math.sin(a) * 1.5;
      if (depth < 2 && rng() < branch * 0.022) {
        walk(x, y, a + (rng() < 0.5 ? -1 : 1) * (0.35 + rng() * 0.7), length * (0.25 + 0.3 * rng()) * (1 - t), w * 0.7, depth + 1);
      }
    }
  };
  for (let k = 0; k < count; k++) walk(rng() * S, rng() * S, rng() * 6.283, len * q * (0.6 + 0.8 * rng()), width * q, 0);
  return out;
}

/** Random scatter helper. */
function scatter(S, count, rng, fn) {
  for (let k = 0; k < count; k++) fn(rng() * S, rng() * S, k);
}

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

// ------------------------------------------------------------------ Stratos: ceramic hull, hex deck, solar cells, cool neon

/** Hex-lattice deck plating: 7 x 8 hexagons per repeat (aspect error ~1 %), gunmetal cells with jitter and a groove. */
function hexGen(S) {
  const B = bank(S), q = S / 512, N = S * S, { mid, fine, grain } = B;
  const g = sampler(S, 211, 97);
  const NX = 7, NY = 8, RH = 0.8660254, PW = NX, PH = NY * RH;
  const H = new Field(S), hd = H.data;
  const tone = new Float32Array(N), dot = new Float32Array(N);
  const cx = new Float32Array(8), cy = new Float32Array(8), cid = new Float32Array(8);
  for (let y = 0, i = 0; y < S; y++) {
    const py = (y + 0.5) / S * PH;
    const j0 = Math.round(py / RH);
    for (let x = 0; x < S; x++, i++) {
      const px = (x + 0.5) / S * PW;
      let n = 0;
      for (let j = j0 - 1; j <= j0 + 1; j++) {
        const off = (j & 1) * 0.5;
        const i0 = Math.round(px - off);
        for (let k = i0 - 1; k <= i0 + 1; k += 1) {
          if (k === i0 - 1 && px - off - i0 > 0) continue;
          if (k === i0 + 1 && px - off - i0 < 0) continue;
          cx[n] = k + off; cy[n] = j * RH;
          cid[n] = (((k % NX) + NX) % NX) + (((j % NY) + NY) % NY) * NX;
          n++;
        }
      }
      let b = 0, d1 = 1e9;
      for (let k = 0; k < n; k++) {
        const dx = cx[k] - px, dy = cy[k] - py, d = dx * dx + dy * dy;
        if (d < d1) { d1 = d; b = k; }
      }
      let e = 1e9;
      for (let k = 0; k < n; k++) {
        if (k === b) continue;
        const dx = cx[k] - px, dy = cy[k] - py;
        const dd = dx * dx + dy * dy - d1;
        const l = Math.hypot(cx[k] - cx[b], cy[k] - cy[b]);
        const ed = dd / (2 * l);
        if (ed < e) e = ed;
      }
      const cell = 1 - sstep(0.035, 0.085, e);              // 1 in the groove
      tone[i] = 0.85 + 0.25 * hash(cid[b], 5) - 0.16 * cell;
      dot[i] = 1 - sstep(0.03, 0.06, Math.sqrt(d1));
      hd[i] = 0.62 - 0.5 * cell + 0.03 * (g(fine, x, y) - 0.5) - 0.07 * dot[i] + 0.04 * (hash(cid[b], 9) - 0.5);
    }
  }
  const cav = cavity(H, Math.max(2, Math.round(3 * q)));
  const px = runPass(S, (x, y, i, c) => {
    const v = tone[i] * (1 + (g(mid, x, y) - 0.5) * 0.18 + (grain[i] - 0.5) * 0.06);
    setC(c, [0.31, 0.34, 0.41], v);
    let rough = 0.5 + 0.14 * (g(fine, x, y) - 0.5), metal = 0.28;
    const cv = cav[i];
    if (cv > 0.01) { const w = sstep(0.01, 0.035, cv); toward(c, 0.62, 0.66, 0.72, w * 0.4); rough -= 0.12 * w; metal += 0.3 * w; }
    if (dot[i] > 0) { scaleC(c, 1 - 0.5 * dot[i]); rough += 0.3 * dot[i]; }
    scaleC(c, Math.min(1.3, Math.max(0.55, 1 + cv * 2)));
    c[3] = rough; c[4] = metal;
  });
  return finish(H, px, { ns: 3, metalMap: true });
}

/** Solar panel skin: 8 x 4 cells per repeat, navy silicon, silver busbars, gap grooves, diagonal sheen. */
function solarGen(S) {
  const B = bank(S), q = S / 512, { mid, fine } = B;
  const g = sampler(S, 53, 149);
  const blocks = [];
  for (let j = 0; j < 4; j++) for (let i = 0; i < 8; i++) blocks.push({ x: i * S / 8, y: j * S / 4, w: S / 8, h: S / 4 });
  const C = buildCells(S, blocks);
  const gap = 2.2 * q, bev = 3 * q;
  const H = new Field(S), hd = H.data;
  const bus = new Float32Array(S * S), fing = new Float32Array(S * S);
  for (let y = 0, i = 0; y < S; y++) {
    for (let x = 0; x < S; x++, i++) {
      const e = C.ed[i], lu = C.lu[i], lv = C.lv[i];
      const t = sstep(gap, gap + bev, e);
      let bb = 0;
      for (const c0 of [0.25, 0.5, 0.75]) bb = Math.max(bb, 1 - sstep(0.4 * q, 1.1 * q, Math.abs(lu - c0) * (S / 8)));
      bb *= t;
      const fg = t * (0.5 + 0.5 * Math.sin(lv * (S / 4) * 0.5 / q)) * (1 - bb);
      bus[i] = bb; fing[i] = fg;
      hd[i] = 0.08 + 0.5 * t + 0.07 * bb - 0.02 * fg + 0.015 * (g(fine, x, y) - 0.5);
    }
  }
  const px = runPass(S, (x, y, i, c) => {
    const id = C.id[i], e = C.ed[i];
    const t = sstep(gap - 0.5, gap + 0.5, e);
    const diag = 0.5 + 0.5 * Math.sin(((x + y) / S) * 6.2832 * 2);
    setC(c, [0.10, 0.19, 0.44], (0.85 + 0.3 * hash(id, 3)) * (1 + (g(mid, x, y) - 0.5) * 0.16) * (0.9 + 0.35 * diag * t));
    let rough = 0.24 + 0.1 * (g(fine, x, y) - 0.5) + 0.12 * (1 - diag), metal = 0.4;
    if (fing[i] > 0) scaleC(c, 1 + 0.18 * fing[i]);
    if (bus[i] > 0) { toward(c, 0.55, 0.58, 0.66, bus[i] * 0.7); rough += (0.3 - rough) * bus[i]; metal += (0.8 - metal) * bus[i]; }
    if (t < 1) { toward(c, 0.02, 0.025, 0.04, 1 - t); rough += (0.7 - rough) * (1 - t); metal *= t; }
    c[3] = rough; c[4] = metal;
  });
  return finish(H, px, { ns: 2.2, metalMap: true });
}

def('ceramic_white', 'metal', 2, 512, S => plateGen(S, {
  seed: 11, ox: 37, oy: 191, base: [0.78, 0.81, 0.84], metal: 0.05, rough: 0.3, tone: 0.1, wear: 0.25, grime: 0.15, gap: 1.2, bev: 4,
  rivet: { inset: 16, spacing: 60, r: 3, h: 0.2 }, layout: (S) => gridLayout(S, 2),
}));
def('ceramic_teal', 'metal', 2, 512, S => plateGen(S, {
  seed: 12, ox: 91, oy: 233, base: [0.10, 0.42, 0.48], metal: 0.15, rough: 0.3, tone: 0.1, wear: 0.25, grime: 0.15, gap: 1.2, bev: 4,
  rivet: { inset: 16, spacing: 60, r: 3, h: 0.2 }, layout: (S) => gridLayout(S, 2),
}));
def('hex_deck', 'metal', 2, 512, hexGen);
def('solar_cells', 'metal', 2, 512, solarGen);
// cool neons (glare rule: emissive ~1.1-1.5, the wide bloom supplies the halo)
const NEON_STRATOS = { neon_cyan: [0.05, 0.9, 1.0], neon_violet: [0.6, 0.2, 1.0], neon_white: [1.0, 1.0, 1.0] };
const NEON_STRATOS_I = { neon_cyan: 1.3, neon_violet: 1.3, neon_white: 1.15 };
Object.keys(NEON_STRATOS).forEach((name, k) => def(name, 'energy', 1, 256, S => neonGen(S, NEON_STRATOS[name], { ox: 200 + k * 61, oy: 90 + k * 29, intensity: NEON_STRATOS_I[name] }), { emissive: true }));

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
  return finish(H, px, { ns: 2.5, metalMap: true, props: { emissiveIntensity: 1.25 } });
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
  return finish(H, px, { ns: 1.6, props: { emissiveIntensity: opt.intensity || 1.5 } });
}

const NEON = {
  neon_blue: [0.05, 0.38, 1.0], neon_pink: [1.0, 0.05, 0.4], neon_orange: [1.0, 0.36, 0.02], neon_green: [0.1, 1.0, 0.28],
};
// Emissive strength (linear HDR multiplier). ACES desaturates anything much above ~1.5 towards white / yellow, which is
// what made neon read as flat glare (it used to be 2.2-3.4); ~1.1-1.6 keeps the hue and lets the bloom supply the halo.
const NEON_I = { neon_blue: 1.6, neon_pink: 1.25, neon_orange: 1.15, neon_green: 1.1 };
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
    // frosted diffuser: brightest at the middle of a cell, fading towards its rim (soft glow falloff, no flat white slab)
    const gx = C.lu[i] * 2 - 1, gy = C.lv[i] * 2 - 1;
    const frost = 1 - 0.3 * Math.min(1, (gx * gx + gy * gy) * 0.5);
    const b = (0.93 + 0.07 * hash(id, 2) + 0.04 * (g(mid, x, y) - 0.5)) * (0.96 + 0.04 * dot) * frost;
    const k = b * t + 0.16 * (1 - t);
    c[5] = 1.0 * k; c[6] = 0.97 * k; c[7] = 0.9 * k;
    const a = 0.55 * t + 0.35 * (1 - t);
    c[0] = a; c[1] = a * 0.98; c[2] = a * 0.94;
    c[3] = 0.4 + 0.1 * (grain[i] - 0.5); c[4] = 0;
  }, { emissive: true });
  return finish(H, px, { ns: 1.6, props: { emissiveIntensity: 1.4 } });
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

// ==================================================================== AERIE materials (begin)
// High-key alpine set for the map "Aerie": cloud sea, snow, glacier ice, frosted glacier rock.
// Same conventions as above: seamless (shared wrapping noise banks), albedo + normal + roughness maps, glare-safe
// (snow / ice sit under a bright noon sun, so their albedo is capped well below white to avoid blown-out surfaces).

GLARE_OVERRIDE.snow = { rough: 0.55, metal: 0, albedo: 0.9 };
GLARE_OVERRIDE.ice = { rough: 0.16, metal: 0.5, albedo: 0.9 };
GLARE_OVERRIDE.cloud = { rough: 0.9, metal: 0, albedo: 0.94 };
GLARE_OVERRIDE.glacier_rock = { rough: 0.3, metal: 0, albedo: 1 };
GLARE_OVERRIDE.peak_rock = { rough: 0.3, metal: 0, albedo: 1 };

// ---- cloud: soft cumulus blots (a sea of cloud); emissive keeps it bright and flat-lit so it never shows a tile grid
def('cloud', 'glass', 70, 256, S => {
  const B = bank(S);
  const { blot, mid, fine } = B;
  const g = sampler(S, 41, 233);
  const H = new Field(S), hd = H.data;
  for (let y = 0, i = 0; y < S; y++) {
    for (let x = 0; x < S; x++, i++) {
      hd[i] = 0.5 + 0.7 * (g(blot, x, y) - 0.5) + 0.34 * (g(mid, x, y, 17, 29) - 0.5) + 0.08 * (g(fine, x, y) - 0.5);
    }
  }
  const px = runPass(S, (x, y, i, c) => {
    const t = sstep(0.36, 0.66, hd[i]);
    const f = g(fine, x, y, 5, 90) - 0.5;
    c[0] = 0.7 + 0.27 * t + f * 0.04;
    c[1] = 0.79 + 0.2 * t + f * 0.04;
    c[2] = 0.92 + 0.07 * t + f * 0.03;
    c[3] = 1;
  });
  return finish(H, px, { ns: 1.5, props: { emissive: 0x9db8d8, emissiveIntensity: 0.6 } });
});

// ---- snow: wind-packed drifts, blue-shadowed hollows, faint ripples and a sparse glitter of crystals
def('snow', 'sand', 3, 512, S => {
  const B = bank(S), q = S / 512;
  const { blot, mid, fine, grain, ridge } = B;
  const g = sampler(S, 7, 301);
  const H = new Field(S), hd = H.data;
  for (let y = 0, i = 0; y < S; y++) {
    for (let x = 0; x < S; x++, i++) {
      hd[i] = 0.5 + 0.24 * (g(blot, x, y) - 0.5) + 0.16 * (g(mid, x, y) - 0.5) + 0.05 * (g(fine, x, y) - 0.5)
        + 0.1 * (g(ridge, x, y, 60, 20) - 0.5) + 0.02 * (grain[i] - 0.5);
    }
  }
  const cav = cavity(H, Math.max(2, Math.round(3 * q)));
  const px = runPass(S, (x, y, i, c) => {
    const h = hd[i];
    const v = 0.9 + 0.2 * (h - 0.5) + (g(fine, x, y, 33, 71) - 0.5) * 0.06;
    c[0] = 0.84 * v; c[1] = 0.87 * v; c[2] = 0.92 * v;
    const hollow = 1 - sstep(0.32, 0.52, h);
    if (hollow > 0) toward(c, 0.6, 0.7, 0.85, hollow * 0.5);
    scaleC(c, Math.min(1.1, Math.max(0.78, 1 + cav[i] * 1.3)));
    let rough = 0.82;
    if (grain[i] > 0.985) { scaleC(c, 1.08); rough = 0.35; }
    c[3] = rough;
  });
  return finish(H, px, { ns: 2.4 });
});

// ---- ice: pale glacier ice with deep blue cores, white fracture veins and trapped bubbles
def('ice', 'glass', 2, 512, S => {
  const B = bank(S), q = S / 512;
  const { blot, mid, fine, ridge, grain } = B;
  const g = sampler(S, 205, 118);
  const H = new Field(S), hd = H.data;
  const T = new Float32Array(S * S);
  for (let y = 0, i = 0; y < S; y++) {
    for (let x = 0; x < S; x++, i++) {
      hd[i] = 0.5 + 0.2 * (g(ridge, x, y) - 0.5) + 0.12 * (g(mid, x, y) - 0.5) + 0.03 * (g(fine, x, y) - 0.5);
    }
  }
  const rng = mulberry32(9137);
  scatter(S, 70, rng, (cx, cy) => stamp(H, T, cx, cy, (1.2 + rng() * 2.6) * Math.max(q, 0.6), 0.1, 1, 'add'));
  const px = runPass(S, (x, y, i, c) => {
    const d = sstep(0.3, 0.75, g(blot, x, y, 80, 200) * 0.6 + g(mid, x, y, 11, 5) * 0.4);
    c[0] = 0.56 + 0.16 * (1 - d); c[1] = 0.76 + 0.12 * (1 - d); c[2] = 0.9 + 0.07 * (1 - d);
    const vein = sstep(0.66, 0.9, g(ridge, x, y, 30, 140));
    if (vein > 0) toward(c, 0.92, 0.97, 1, vein * 0.55);
    if (T[i] > 0) toward(c, 0.95, 0.98, 1, 0.55);
    scaleC(c, 1 + (grain[i] - 0.5) * 0.04);
    c[3] = 0.1 + 0.16 * (g(fine, x, y) - 0.5) + 0.3 * vein;
  });
  return finish(H, px, { ns: 2.2 });
});

// ---- cliff rock: calm horizontal strata in cool granite tones with frost on the ledge lips. Replaced glacierGen's
// voronoi cells on Aerie's cliffs and peaks, which read as giant cobblestones and made the map look busy.
function cliffGen(S, o = {}) {
  const B = bank(S), q = S / 512;
  const { blot, mid, fine, grain, ridge } = B;
  const g = sampler(S, o.ox ?? 37, o.oy ?? 91);
  const layers = o.layers ?? 6;   // strata per texture repeat (an integer, so it tiles vertically)
  const H = new Field(S), hd = H.data;
  const lip = new Float32Array(S * S), lid = new Float32Array(S * S);
  for (let y = 0, i = 0; y < S; y++) {
    for (let x = 0; x < S; x++, i++) {
      const warp = (g(mid, x, y) - 0.5) * 0.8 + (g(blot, x, y) - 0.5) * 1.2;
      const v = (y / S) * layers + warp;
      const f = v - Math.floor(v);
      const ledge = sstep(0.0, 0.16, f) * (1 - sstep(0.7, 1.0, f));
      lip[i] = sstep(0.0, 0.1, f) * (1 - sstep(0.1, 0.28, f));
      lid[i] = hash(((Math.floor(v) % layers) + layers) % layers, 31);
      hd[i] = 0.42 + 0.24 * ledge + 0.08 * (g(mid, x, y) - 0.5) + 0.05 * (g(fine, x, y) - 0.5) + 0.06 * (g(ridge, x, y) - 0.5) + 0.03 * (grain[i] - 0.5);
    }
  }
  const cav = cavity(H, Math.max(2, Math.round(3 * q)));
  const pal = ramp([[0, '#262c34'], [0.5, '#48525c'], [1, '#76818b']]);
  const px = runPass(S, (x, y, i, c) => {
    const v = 0.88 + 0.16 * (g(mid, x, y) - 0.5) + 0.12 * (g(fine, x, y) - 0.5) + 0.06 * (grain[i] - 0.5);
    pal(0.3 + 0.45 * lid[i] + 0.15 * (g(blot, x, y) - 0.5), c, v);
    scaleC(c, Math.min(1.2, Math.max(0.7, 1 + cav[i] * 1.1)));
    // frost lodged on the ledge lips, patchy
    const fr = lip[i] * sstep(0.4, 0.65, g(blot, x, y, 120, 60)) * (o.frost ?? 1);
    if (fr > 0) toward(c, 0.78, 0.83, 0.88, fr * 0.55);
    c[3] = 0.84 + 0.08 * (g(fine, x, y) - 0.5) - 0.2 * fr;
  });
  return finish(H, px, { ns: 3 });
}
def('glacier_rock', 'stone', 3, 512, S => cliffGen(S));
// the same rock at mountain scale (16 m per repeat, 256 px) for the distant peaks: a few broad strata
def('peak_rock', 'stone', 16, 256, S => cliffGen(S, { layers: 4, ox: 140, oy: 20, frost: 1.4 }));
// ==================================================================== AERIE materials (end)

// ==================================================================== SKYLINE light strips + signage
// Warmer, calmer light strips than the stock neon (Skyline maps its neon_* names onto these, see skyline.js).
const NEON_SKYLINE = { neon_amber: [1.0, 0.52, 0.12], neon_warm: [1.0, 0.8, 0.56], neon_steel: [0.32, 0.55, 1.0] };
const NEON_SKYLINE_I = { neon_amber: 1.15, neon_warm: 1.0, neon_steel: 1.25 };
Object.keys(NEON_SKYLINE).forEach((name, k) => def(name, 'energy', 1, 256, S => neonGen(S, NEON_SKYLINE[name], { ox: 400 + k * 61, oy: 170 + k * 29, intensity: NEON_SKYLINE_I[name] }), { emissive: true }));

// Signs are typeset on canvas in the UI's bundled faces (style.css @font-face; preloadMaterials waits for them) and
// mapped 1:1 onto `panel` solids with `fit: true`. Letter signs glow from an emissive layer of their own; lightboxes
// (ads, the market, parking) use the picture itself as the emissive map, as if lit from behind.
const SF_COND = '"Barlow Condensed", "Arial Narrow", "Segoe UI", sans-serif';
const SF_TEXT = '"Barlow", "Segoe UI", sans-serif';
const SIGN_FONT_LOADS = ['400 80px "Barlow Condensed"', '600 80px "Barlow Condensed"', '700 80px "Barlow Condensed"',
  '800 80px "Barlow Condensed"', '600 40px "Barlow"', '700 40px "Barlow"'];
let _signFonts = null;

/** Resolves once the sign faces are loaded (at most 4 s; without a FontFaceSet the fallback faces are used). */
function signFontsReady() {
  if (!_signFonts) {
    const fonts = typeof document !== 'undefined' ? document.fonts : null;
    _signFonts = fonts && fonts.load
      ? Promise.race([Promise.all(SIGN_FONT_LOADS.map(f => fonts.load(f))), new Promise(r => setTimeout(r, 4000))]).catch(() => {})
      : Promise.resolve();
  }
  return _signFonts;
}

/** Text centred (or aligned) at (x, y), middle baseline, shrunk to fit maxW. Tracking in em. Returns the width. */
function signText(ctx, text, x, y, { size, weight = 700, face = SF_COND, track = 0, maxW = Infinity, align = 'center' }) {
  let px = size;
  const set = () => {
    ctx.font = `${weight} ${px.toFixed(1)}px ${face}`;
    ctx.letterSpacing = `${(track * px).toFixed(1)}px`;
  };
  set();
  let w = ctx.measureText(text).width;
  if (w > maxW) { px = Math.max(8, px * maxW / w); set(); w = ctx.measureText(text).width; }
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  // letter spacing also trails the last glyph: centred text shifts back by half of it
  ctx.fillText(text, x + (align === 'center' ? (track * px) / 2 : 0), y);
  return w;
}

/** The same text on the albedo (dim) and emissive (bright + halo) layers of a letter sign. */
function litText(a, e, text, x, y, o, dim, bright, halo = 0.3) {
  a.fillStyle = dim;
  signText(a, text, x, y, o);
  e.save();
  e.fillStyle = bright;
  e.shadowColor = bright;
  e.shadowBlur = o.size * halo;
  signText(e, text, x, y, o);
  e.shadowBlur = 0;
  signText(e, text, x, y, o);
  e.restore();
}

function signGen(spec) {
  const { w, h } = spec;
  const A = makeCanvas(w, h);
  const E = spec.lightbox ? null : makeCanvas(w, h);
  if (E) { E.ctx.fillStyle = '#000'; E.ctx.fillRect(0, 0, w, h); }
  spec.draw(A.ctx, E ? E.ctx : null, w, h);
  const R = makeCanvas(4);
  R.ctx.fillStyle = 'rgb(255, 150, 0)';   // roughness ~0.6, metalness 0
  R.ctx.fillRect(0, 0, 4, 4);
  const N = makeCanvas(4);
  N.ctx.fillStyle = 'rgb(128, 128, 255)';   // flat
  N.ctx.fillRect(0, 0, 4, 4);
  const map = canvasTexture(A.canvas, { srgb: true, repeat: false });
  return {
    map,
    normalMap: canvasTexture(N.canvas, { srgb: false }),
    rm: canvasTexture(R.canvas, { srgb: false }),
    emissiveMap: E ? canvasTexture(E.canvas, { srgb: true, repeat: false }) : map,
    metalMap: false,
    metalness: 0,
    // a lightbox's face is its emission: keep its diffuse dim so lamps do not wash the picture out
    props: { emissiveIntensity: spec.intensity ?? 1, ...(spec.lightbox ? { color: new THREE.Color(0.3, 0.3, 0.3) } : {}) },
  };
}

const WARM = '#fff0da', AMBER = '#ffad48', DIM = '#7d7466', PLATE = '#121418';

/** Plain dark plate with a thin inset frame (frame colour on the albedo, glowing on the emissive layer). */
function plate(a, e, w, h, frame = null, inset = 14, lw = 4) {
  a.fillStyle = PLATE;
  a.fillRect(0, 0, w, h);
  if (!frame) return;
  a.strokeStyle = '#5c4a32';
  a.lineWidth = lw;
  a.strokeRect(inset, inset, w - inset * 2, h - inset * 2);
  e.save();
  e.strokeStyle = frame;
  e.lineWidth = lw;
  e.shadowColor = frame;
  e.shadowBlur = lw * 3;
  e.strokeRect(inset, inset, w - inset * 2, h - inset * 2);
  e.restore();
}

const SIGNS = {
  // vertical blade sign, letters stacked
  sign_hotel: {
    w: 256, h: 1024, intensity: 1.35,
    draw(a, e, w, h) {
      plate(a, e, w, h, AMBER, 16, 6);
      [...'HOTEL'].forEach((ch, i) => litText(a, e, ch, w / 2, h * (0.13 + i * 0.185), { size: 176, weight: 700 }, '#cfc6b6', WARM, 0.22));
    },
  },
  sign_lounge: {
    w: 1024, h: 320, intensity: 1.4,
    draw(a, e, w, h) {
      plate(a, e, w, h);
      litText(a, e, 'LOUNGE', w / 2, h * 0.43, { size: 168, weight: 600, track: 0.14, maxW: w * 0.86 }, '#a8773a', AMBER, 0.28);
      litText(a, e, 'COCKTAILS  ·  UPSTAIRS', w / 2, h * 0.82, { size: 36, weight: 600, face: SF_TEXT, track: 0.2, maxW: w * 0.8 }, DIM, WARM, 0.2);
    },
  },
  sign_noodle: {
    w: 1024, h: 320, intensity: 1.35,
    draw(a, e, w, h) {
      plate(a, e, w, h);
      litText(a, e, 'NOODLE HOUSE', w / 2, h * 0.42, { size: 150, weight: 700, track: 0.04, maxW: w * 0.9 }, '#bfb3a0', WARM, 0.24);
      litText(a, e, 'RAMEN  ·  DUMPLINGS  ·  OPEN LATE', w / 2, h * 0.8, { size: 34, weight: 600, face: SF_TEXT, track: 0.16, maxW: w * 0.84 }, '#8a6534', AMBER, 0.2);
    },
  },
  sign_meridian: {
    w: 1024, h: 188, intensity: 1.3,
    draw(a, e, w, h) {
      plate(a, e, w, h);
      litText(a, e, 'MERIDIAN', w / 2, h * 0.53, { size: 128, weight: 400, track: 0.32, maxW: w * 0.9 }, '#b9b1a4', WARM, 0.2);
    },
  },
  sign_crown: {
    w: 1024, h: 410, intensity: 1.25,
    draw(a, e, w, h) {
      plate(a, e, w, h, AMBER, 18, 3);
      litText(a, e, 'SKYLINE', w / 2, h * 0.45, { size: 200, weight: 600, track: 0.16, maxW: w * 0.84 }, '#d7cfc2', WARM, 0.18);
      litText(a, e, 'CENTRAL  PLAZA', w / 2, h * 0.79, { size: 42, weight: 600, face: SF_TEXT, track: 0.34, maxW: w * 0.7 }, '#8a6534', AMBER, 0.2);
    },
  },
  // lightboxes
  sign_market: {
    w: 1024, h: 340, intensity: 0.7, lightbox: true,
    draw(a, e, w, h) {
      a.fillStyle = '#efe9de';
      a.fillRect(0, 0, w, h);
      const bw = w * 0.26;
      a.fillStyle = '#c3352b';
      a.fillRect(0, 0, bw, h);
      a.fillStyle = '#fff6ea';
      signText(a, '24', bw / 2, h * 0.43, { size: 200, weight: 800 });
      signText(a, 'HOURS', bw / 2, h * 0.82, { size: 44, weight: 700, track: 0.12, maxW: bw * 0.8 });
      a.fillStyle = '#1b1e24';
      signText(a, 'CORNER MARKET', bw + (w - bw) / 2, h * 0.42, { size: 118, weight: 700, track: 0.02, maxW: (w - bw) * 0.88 });
      a.fillStyle = '#6b6f78';
      signText(a, 'GROCERIES  ·  COFFEE  ·  NEWS', bw + (w - bw) / 2, h * 0.76, { size: 34, weight: 600, face: SF_TEXT, track: 0.14, maxW: (w - bw) * 0.8 });
    },
  },
  sign_parking: {
    w: 512, h: 640, intensity: 0.75, lightbox: true,
    draw(a, e, w, h) {
      a.fillStyle = '#1c55b8';
      a.fillRect(0, 0, w, h);
      a.strokeStyle = '#eef3fb';
      a.lineWidth = 10;
      a.strokeRect(22, 22, w - 44, h - 44);
      a.fillStyle = '#f4f7fc';
      signText(a, 'P', w / 2, h * 0.42, { size: 400, weight: 800 });
      signText(a, 'PARKING', w / 2, h * 0.84, { size: 78, weight: 700, track: 0.08, maxW: w * 0.78 });
    },
  },
};

/** Billboard ad as two lightbox materials: `name` (2.56 : 1, roofs and the crown) and `name_wide` (3.5 : 1, perimeter). */
function ad(name, draw, intensity = 0.65) {
  SIGNS[name] = { w: 1024, h: 400, intensity, lightbox: true, draw };
  SIGNS[name + '_wide'] = { w: 1024, h: 292, intensity, lightbox: true, draw };
}
ad('sign_ad_halcyon', (a, e, w, h) => {
  const sky = a.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, '#13213d');
  sky.addColorStop(0.62, '#3c4c72');
  sky.addColorStop(1, '#c98a5c');
  a.fillStyle = sky;
  a.fillRect(0, 0, w, h);
  const cx = w - h * 0.78, cy = h * 0.66, r = h * 0.36;
  const sun = a.createRadialGradient(cx, cy, r * 0.1, cx, cy, r);
  sun.addColorStop(0, '#ffe2b0');
  sun.addColorStop(1, '#ff9a55');
  a.fillStyle = sun;
  a.beginPath();
  a.arc(cx, cy, r, 0, Math.PI * 2);
  a.fill();
  // skyline silhouette along the bottom
  const rnd = mulberry32(77);
  a.fillStyle = '#0d1424';
  for (let x = w * 0.45; x < w; x += h * 0.09) {
    const bh = h * (0.12 + 0.22 * rnd());
    a.fillRect(x, h - bh, h * 0.085, bh);
  }
  a.fillRect(0, h * 0.94, w, h * 0.06);
  a.fillStyle = '#ffffff';
  signText(a, 'HALCYON', h * 0.16, h * 0.42, { size: h * 0.3, weight: 800, track: 0.05, align: 'left', maxW: w * 0.5 });
  a.fillStyle = '#ffd8ad';
  signText(a, 'RESIDENCES  —  NOW LEASING', h * 0.17, h * 0.66, { size: h * 0.075, weight: 600, face: SF_TEXT, track: 0.16, align: 'left', maxW: w * 0.5 });
});
ad('sign_ad_nova', (a, e, w, h) => {
  const bg = a.createLinearGradient(0, 0, w, h);
  bg.addColorStop(0, '#071420');
  bg.addColorStop(1, '#15485e');
  a.fillStyle = bg;
  a.fillRect(0, 0, w, h);
  // flight path: a thin arc with a small aircraft at its head
  a.strokeStyle = 'rgba(255, 255, 255, 0.55)';
  a.lineWidth = Math.max(2, h * 0.008);
  a.setLineDash([h * 0.03, h * 0.025]);
  a.beginPath();
  a.moveTo(w * 0.52, h * 0.86);
  a.quadraticCurveTo(w * 0.74, h * 0.06, w - h * 0.22, h * 0.3);
  a.stroke();
  a.setLineDash([]);
  a.fillStyle = '#ffffff';
  a.save();
  a.translate(w - h * 0.2, h * 0.31);
  a.rotate(0.35);
  a.beginPath();
  a.moveTo(h * 0.07, 0);
  a.lineTo(-h * 0.05, -h * 0.045);
  a.lineTo(-h * 0.02, 0);
  a.lineTo(-h * 0.05, h * 0.045);
  a.closePath();
  a.fill();
  a.restore();
  signText(a, 'NOVA AIR', h * 0.16, h * 0.44, { size: h * 0.3, weight: 800, track: 0.04, align: 'left', maxW: w * 0.5 });
  a.fillStyle = '#9fd6f0';
  signText(a, 'THE CITY, FROM ABOVE', h * 0.17, h * 0.68, { size: h * 0.075, weight: 600, face: SF_TEXT, track: 0.16, align: 'left', maxW: w * 0.5 });
});
ad('sign_ad_vanta', (a, e, w, h) => {
  a.fillStyle = '#0b0b0d';
  a.fillRect(0, 0, w, h);
  const cx = w - h * 0.62, cy = h * 0.5, r = h * 0.3;
  const spot = a.createRadialGradient(cx, cy, 0, cx, cy, h * 0.75);
  spot.addColorStop(0, '#3d2c18');
  spot.addColorStop(1, '#0b0b0d');
  a.fillStyle = spot;
  a.fillRect(0, 0, w, h);
  // watch face: ring, twelve ticks, two hands
  a.strokeStyle = '#d8b16a';
  a.lineWidth = h * 0.02;
  a.beginPath();
  a.arc(cx, cy, r, 0, Math.PI * 2);
  a.stroke();
  for (let k = 0; k < 12; k++) {
    const t = (k / 12) * Math.PI * 2, r0 = r * (k % 3 ? 0.84 : 0.76);
    a.lineWidth = h * (k % 3 ? 0.008 : 0.014);
    a.beginPath();
    a.moveTo(cx + Math.sin(t) * r0, cy - Math.cos(t) * r0);
    a.lineTo(cx + Math.sin(t) * r * 0.92, cy - Math.cos(t) * r * 0.92);
    a.stroke();
  }
  a.lineCap = 'round';
  for (const [t, len, lw] of [[-0.9, 0.5, 0.018], [1.95, 0.72, 0.011]]) {
    a.lineWidth = h * lw;
    a.beginPath();
    a.moveTo(cx, cy);
    a.lineTo(cx + Math.sin(t) * r * len, cy - Math.cos(t) * r * len);
    a.stroke();
  }
  a.fillStyle = '#f2e6d0';
  signText(a, 'VANTA', h * 0.16, h * 0.44, { size: h * 0.3, weight: 600, track: 0.28, align: 'left', maxW: w * 0.5 });
  a.fillStyle = '#c9a46a';
  signText(a, 'TIME, WELL KEPT', h * 0.17, h * 0.68, { size: h * 0.075, weight: 600, face: SF_TEXT, track: 0.2, align: 'left', maxW: w * 0.5 });
});

for (const [name, spec] of Object.entries(SIGNS)) def(name, 'energy', 1, spec.w, () => signGen(spec), { emissive: true });
// ==================================================================== SKYLINE materials (end)

// ------------------------------------------------------------------ public API

const _cache = new Map();
const _warned = new Set();

/** Every material name this library can build. */
export const MATERIAL_NAMES = Object.keys(DEFS);

let _renderer = null;

/** Call once with the renderer (sets the anisotropic filtering level used by all textures). */
export function initTextures(renderer) {
  if (renderer && renderer.capabilities) setMaxAnisotropy(renderer.capabilities.getMaxAnisotropy());
  _renderer = renderer || null;
}

function resolveName(name) {
  if (DEFS[name]) return name;
  if (!_warned.has(name)) {
    _warned.add(name);
    console.warn(`[Textures] unknown material '${name}', using 'dev_grid'`);
  }
  return 'dev_grid';
}

function buildMaterial(name) {
  const d = DEFS[name];
  _glare = GLARE_OVERRIDE[name] || GLARE_DEFAULT;
  _soften = d.emissive ? 0 : (SOFTEN_OVERRIDE[name] ?? SOFTEN_DEFAULT);
  const g = d.gen(d.size, name);
  _glare = GLARE_DEFAULT;
  _soften = SOFTEN_DEFAULT;
  const params = {
    map: g.map,
    normalMap: g.normalMap,
    normalScale: new THREE.Vector2(NORMAL_SCALE, NORMAL_SCALE),
    roughnessMap: g.rm,
    roughness: 1,
    metalness: g.metalMap ? 1 : g.metalness,
    metalnessMap: g.metalMap ? g.rm : null,
  };
  if (g.emissiveMap) {
    params.emissive = new THREE.Color(0xffffff);
    params.emissiveMap = g.emissiveMap;
  }
  if (g.alphaMap) {
    params.alphaMap = g.alphaMap;
    params.alphaTest = 0.4;
  }
  if (g.props) Object.assign(params, g.props);
  const mat = new THREE.MeshStandardMaterial(params);
  mat.name = name;
  mat.userData.surface = d.surface;
  mat.userData.scale = d.scale;
  return mat;
}

/**
 * Shared, cached MeshStandardMaterial for a material name (generated on first use).
 * Unknown names warn once and return the 'dev_grid' fallback. Never dispose the result.
 * @param {string} name
 * @returns {THREE.MeshStandardMaterial}
 */
export function getMaterial(name) {
  const key = resolveName(name);
  let m = _cache.get(key);
  if (!m) {
    m = buildMaterial(key);
    _cache.set(key, m);
  }
  return m;
}

/**
 * Static info about a material: physical size of one texture repeat, gameplay surface type,
 * and whether it is a self-illuminated (light-emitting) material.
 * @param {string} name
 * @returns {{surface: string, scale: number, emissive: boolean}}
 */
export function getMaterialInfo(name) {
  const d = DEFS[DEFS[name] ? name : 'dev_grid'];
  return { surface: d.surface, scale: d.scale, emissive: d.emissive };
}

const TEX_SLOTS = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'alphaMap'];

/** Upload a material's textures to the GPU now (avoids a hitch on the first frame that uses it). */
function uploadTextures(mat) {
  if (!_renderer || typeof _renderer.initTexture !== 'function') return;
  try {
    const seen = new Set();
    for (const k of TEX_SLOTS) {
      const t = mat[k];
      if (t && !seen.has(t)) { seen.add(t); _renderer.initTexture(t); }
    }
  } catch (err) {
    if (!_warned.has('upload')) { _warned.add('upload'); console.warn('[Textures] GPU pre-upload failed:', err); }
  }
}

const yieldFrame = () => yieldHiddenSafe(() => new Promise(res => {
  let done = false;
  const f = () => { if (!done) { done = true; res(); } };
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(f);
  setTimeout(f, 40);
}));

/**
 * Generate materials ahead of time, yielding to the browser between materials so a loading
 * screen keeps animating.
 * @param {string[]} names
 * @param {(fraction: number) => void} [onProgress]
 */
export async function preloadMaterials(names = MATERIAL_NAMES, onProgress) {
  const list = [...new Set(names)];
  const n = list.length;
  if (!n) { if (onProgress) onProgress(1); return; }
  if (list.some(m => m.startsWith('sign_'))) await signFontsReady();   // signs are typeset in the UI faces
  let last = performance.now();
  for (let i = 0; i < n; i++) {
    uploadTextures(getMaterial(list[i]));
    if (onProgress) onProgress((i + 1) / n);
    // yield once ~a frame of work has accumulated (cheap materials are batched)
    if (performance.now() - last >= 24) {
      await yieldFrame();
      last = performance.now();
    }
  }
}
