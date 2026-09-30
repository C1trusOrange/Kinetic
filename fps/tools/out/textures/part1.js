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
import { mulberry32 } from '../core/utils.js';

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
      const j = i << 2;
      a[j] = c[0] * 255; a[j + 1] = c[1] * 255; a[j + 2] = c[2] * 255; a[j + 3] = 255;
      r[j] = 255; r[j + 1] = c[3] * 255; r[j + 2] = c[4] * 255; r[j + 3] = 255;
      if (e) { e[j] = c[5] * 255; e[j + 1] = c[6] * 255; e[j + 2] = c[7] * 255; e[j + 3] = 255; }
      if (al) { al[j] = al[j + 1] = al[j + 2] = c[8] * 255; al[j + 3] = 255; }
    }
  }
  A.ctx.putImageData(ia, 0, 0);
  R.ctx.putImageData(ir, 0, 0);
  if (E) E.ctx.putImageData(ie, 0, 0);
  if (L) L.ctx.putImageData(il, 0, 0);
  return { albedo: A.canvas, rm: R.canvas, emissive: E ? E.canvas : null, alpha: L ? L.canvas : null };
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
