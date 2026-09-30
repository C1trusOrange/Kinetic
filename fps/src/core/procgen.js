/**
 * Procedural texture toolkit shared by Textures.js, WeaponModels.js and BotModel.js.
 *
 * Workflow: build Float32 "fields" (height / masks) with Field + TileNoise, then convert to
 * canvases/textures: albedo via field.toCanvas(colorFn) or makeCanvasFrom(fn), normal maps via
 * field.toNormalCanvas(), roughness via field.toGrayCanvas(). All fields wrap (tileable) by default.
 *
 * Colors in this module are [r, g, b] arrays of floats in 0..1 (sRGB display values).
 */
import * as THREE from 'three';
import { mulberry32 } from './utils.js';

// ------------------------------------------------------------------ noise

/** Tileable gradient (Perlin) + cellular (Worley) noise. */
export class TileNoise {
  constructor(seed = 1) {
    const rng = mulberry32((seed * 9973 + 17) >>> 0);
    const p = new Uint16Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    for (let i = 255; i > 0; i--) {
      const j = (rng() * (i + 1)) | 0;
      const t = p[i]; p[i] = p[j]; p[j] = t;
    }
    this.perm = new Uint16Array(512);
    for (let i = 0; i < 512; i++) this.perm[i] = p[i & 255];
    this.gx = new Float32Array(256);
    this.gy = new Float32Array(256);
    this.jx = new Float32Array(256);
    this.jy = new Float32Array(256);
    for (let i = 0; i < 256; i++) {
      const a = rng() * Math.PI * 2;
      this.gx[i] = Math.cos(a);
      this.gy[i] = Math.sin(a);
      this.jx[i] = rng();
      this.jy[i] = rng();
    }
  }

  _hash(ix, iy) {
    return this.perm[this.perm[ix & 255] + (iy & 255)];
  }

  /** Perlin noise in ~[-1, 1], periodic with (px, py) lattice cells. */
  perlin(x, y, px = 256, py = 256) {
    const xf0 = Math.floor(x), yf0 = Math.floor(y);
    const fx = x - xf0, fy = y - yf0;
    let x0 = xf0 % px; if (x0 < 0) x0 += px;
    let y0 = yf0 % py; if (y0 < 0) y0 += py;
    const x1 = (x0 + 1) % px, y1 = (y0 + 1) % py;
    const u = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
    const v = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
    let h = this._hash(x0, y0); const n00 = this.gx[h] * fx + this.gy[h] * fy;
    h = this._hash(x1, y0); const n10 = this.gx[h] * (fx - 1) + this.gy[h] * fy;
    h = this._hash(x0, y1); const n01 = this.gx[h] * fx + this.gy[h] * (fy - 1);
    h = this._hash(x1, y1); const n11 = this.gx[h] * (fx - 1) + this.gy[h] * (fy - 1);
    const a = n00 + u * (n10 - n00);
    const b = n01 + u * (n11 - n01);
    return (a + v * (b - a)) * 1.414;
  }

  /**
   * Tileable fractal noise over uv in [0,1). baseFreq = integer lattice cells across the tile.
   * Returns ~[-1, 1].
   */
  fbm(u, v, baseFreq = 4, octaves = 4, gain = 0.5) {
    let sum = 0, amp = 1, norm = 0, f = baseFreq;
    for (let o = 0; o < octaves; o++) {
      sum += amp * this.perlin(u * f, v * f, f, f);
      norm += amp;
      amp *= gain;
      f *= 2;
    }
    return sum / norm;
  }

  /** Ridged multifractal, tileable, returns ~[0, 1] (sharp creases - cracks, veins, rock). */
  ridged(u, v, baseFreq = 4, octaves = 4, gain = 0.5) {
    let sum = 0, amp = 1, norm = 0, f = baseFreq;
    for (let o = 0; o < octaves; o++) {
      const n = 1 - Math.abs(this.perlin(u * f, v * f, f, f));
      sum += amp * n * n;
      norm += amp;
      amp *= gain;
      f *= 2;
    }
    return sum / norm;
  }

  /**
   * Tileable cellular noise. Returns F1 (distance to nearest feature point, in cell units, ~0..1).
   * After the call: this.f2 = second-nearest distance, this.cellId = 0..255 id of the nearest cell.
   */
  worley(u, v, cells = 8) {
    const x = u * cells, y = v * cells;
    const xi = Math.floor(x), yi = Math.floor(y);
    let f1 = 9, f2 = 9, id = 0;
    for (let oy = -1; oy <= 1; oy++) {
      for (let ox = -1; ox <= 1; ox++) {
        const cx = xi + ox, cy = yi + oy;
        let wx = cx % cells; if (wx < 0) wx += cells;
        let wy = cy % cells; if (wy < 0) wy += cells;
        const h = this._hash(wx, wy);
        const dx = cx + this.jx[h] - x;
        const dy = cy + this.jy[h] - y;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d < f1) { f2 = f1; f1 = d; id = h; } else if (d < f2) { f2 = d; }
      }
    }
    this.f2 = f2;
    this.cellId = id;
    return f1;
  }
}

// ------------------------------------------------------------------ fields

/** A wrapping 2D float field (height maps, masks, roughness...). */
export class Field {
  constructor(w, h = w, fill = 0) {
    this.w = w;
    this.h = h;
    this.data = new Float32Array(w * h);
    if (fill !== 0) this.data.fill(fill);
  }

  clone() {
    const f = new Field(this.w, this.h);
    f.data.set(this.data);
    return f;
  }

  idx(x, y) {
    const w = this.w, h = this.h;
    x %= w; if (x < 0) x += w;
    y %= h; if (y < 0) y += h;
    return y * w + x;
  }

  get(x, y) { return this.data[this.idx(x | 0, y | 0)]; }
  set(x, y, v) { this.data[this.idx(x | 0, y | 0)] = v; }

  /** Bilinear sample at uv (wrapping). */
  sample(u, v) {
    const x = u * this.w - 0.5, y = v * this.h - 0.5;
    const x0 = Math.floor(x), y0 = Math.floor(y);
    const fx = x - x0, fy = y - y0;
    const a = this.get(x0, y0), b = this.get(x0 + 1, y0);
    const c = this.get(x0, y0 + 1), d = this.get(x0 + 1, y0 + 1);
    return (a + (b - a) * fx) * (1 - fy) + (c + (d - c) * fx) * fy;
  }

  /** data[i] = fn(u, v, x, y, current). u,v are pixel-center coordinates in [0,1). */
  apply(fn) {
    const { w, h, data } = this;
    for (let y = 0; y < h; y++) {
      const v = (y + 0.5) / h;
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        data[i] = fn((x + 0.5) / w, v, x, y, data[i]);
      }
    }
    return this;
  }

  fill(v) { this.data.fill(v); return this; }

  /** Adds amp * fbm noise (range ~[-amp, amp]). */
  addNoise(noise, { freq = 4, octaves = 4, amp = 1, gain = 0.5 } = {}) {
    return this.apply((u, v, x, y, c) => c + amp * noise.fbm(u, v, freq, octaves, gain));
  }

  _write(i, value, mode) {
    const d = this.data;
    switch (mode) {
      case 'max': if (value > d[i]) d[i] = value; break;
      case 'min': if (value < d[i]) d[i] = value; break;
      case 'add': d[i] += value; break;
      case 'mul': d[i] *= value; break;
      case 'blend': break; // handled by caller
      default: d[i] = value;
    }
  }

  /**
   * Axis-aligned rectangle in pixel coords (wraps). With bevel > 0 the value ramps from `base`
   * at the edge to `value` over `bevel` pixels (raised panels, bricks, tiles).
   * mode: 'set' | 'max' | 'min' | 'add' | 'mul'
   */
  rect(x0, y0, rw, rh, value, { bevel = 0, mode = 'set', base = 0 } = {}) {
    const x1 = x0 + rw, y1 = y0 + rh;
    for (let y = Math.floor(y0); y < Math.ceil(y1); y++) {
      for (let x = Math.floor(x0); x < Math.ceil(x1); x++) {
        let v = value;
        if (bevel > 0) {
          const e = Math.min(x + 0.5 - x0, x1 - (x + 0.5), y + 0.5 - y0, y1 - (y + 0.5));
          const t = Math.max(0, Math.min(1, e / bevel));
          v = base + (value - base) * (t * t * (3 - 2 * t));
        }
        this._write(this.idx(x, y), v, mode);
      }
    }
    return this;
  }

  /**
   * Circle / dome in pixel coords. shape: 'flat' (plateau with `soft` px falloff) or 'dome'
   * (hemispherical profile - rivets, bolts, bumps).
   */
  circle(cx, cy, r, value, { soft = 1, mode = 'max', shape = 'flat' } = {}) {
    const R = r + soft;
    for (let y = Math.floor(cy - R); y <= Math.ceil(cy + R); y++) {
      for (let x = Math.floor(cx - R); x <= Math.ceil(cx + R); x++) {
        const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
        if (d > R) continue;
        let t;
        if (shape === 'dome') t = d >= r ? 0 : Math.sqrt(1 - (d / r) * (d / r));
        else t = d <= r ? 1 : 1 - (d - r) / Math.max(soft, 1e-6);
        this._write(this.idx(x, y), value * t, mode);
      }
    }
    return this;
  }

  /** Thick line segment in pixel coords with soft edges (scratches, seams, cracks). */
  line(x0, y0, x1, y1, width, value, { mode = 'min', soft = 1 } = {}) {
    const minX = Math.floor(Math.min(x0, x1) - width - soft), maxX = Math.ceil(Math.max(x0, x1) + width + soft);
    const minY = Math.floor(Math.min(y0, y1) - width - soft), maxY = Math.ceil(Math.max(y0, y1) + width + soft);
    const dx = x1 - x0, dy = y1 - y0;
    const len2 = dx * dx + dy * dy || 1e-6;
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const px = x + 0.5, py = y + 0.5;
        let t = ((px - x0) * dx + (py - y0) * dy) / len2;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const d = Math.hypot(px - (x0 + dx * t), py - (y0 + dy * t));
        const half = width * 0.5;
        if (d > half + soft) continue;
        const k = d <= half ? 1 : 1 - (d - half) / soft;
        const i = this.idx(x, y);
        if (mode === 'min' || mode === 'max' || mode === 'set') {
          const cur = this.data[i];
          const target = cur + (value - cur) * k;
          this._write(i, target, mode === 'set' ? 'set' : mode);
        } else {
          this._write(i, value * k, mode);
        }
      }
    }
    return this;
  }

  /** Separable wrapping box blur, `passes` times (2-3 passes approximate a gaussian). */
  blur(radius = 1, passes = 2) {
    if (radius < 1) return this;
    const { w, h } = this;
    const tmp = new Float32Array(w * h);
    const r = Math.floor(radius);
    const norm = 1 / (2 * r + 1);
    for (let p = 0; p < passes; p++) {
      const src = this.data;
      for (let y = 0; y < h; y++) {
        let acc = 0;
        for (let k = -r; k <= r; k++) acc += src[y * w + ((k % w) + w) % w];
        for (let x = 0; x < w; x++) {
          tmp[y * w + x] = acc * norm;
          const add = (x + r + 1) % w, sub = ((x - r) % w + w) % w;
          acc += src[y * w + add] - src[y * w + sub];
        }
      }
      for (let x = 0; x < w; x++) {
        let acc = 0;
        for (let k = -r; k <= r; k++) acc += tmp[(((k % h) + h) % h) * w + x];
        for (let y = 0; y < h; y++) {
          src[y * w + x] = acc * norm;
          const add = (y + r + 1) % h, sub = ((y - r) % h + h) % h;
          acc += tmp[add * w + x] - tmp[sub * w + x];
        }
      }
    }
    return this;
  }

  /** Rescale values linearly so min -> 0, max -> 1. */
  normalize() {
    let lo = Infinity, hi = -Infinity;
    for (const v of this.data) { if (v < lo) lo = v; if (v > hi) hi = v; }
    const s = hi > lo ? 1 / (hi - lo) : 0;
    for (let i = 0; i < this.data.length; i++) this.data[i] = (this.data[i] - lo) * s;
    return this;
  }

  clamp01() {
    const d = this.data;
    for (let i = 0; i < d.length; i++) d[i] = d[i] < 0 ? 0 : d[i] > 1 ? 1 : d[i];
    return this;
  }

  /** out = fn(this, other) elementwise; fields must match in size. */
  combine(other, fn) {
    const a = this.data, b = other.data;
    for (let i = 0; i < a.length; i++) a[i] = fn(a[i], b[i]);
    return this;
  }

  /** Albedo canvas: colorFn(value, u, v, x, y) -> [r,g,b] (0..1). */
  toCanvas(colorFn) {
    const { w, h, data } = this;
    const { canvas, ctx } = makeCanvas(w, h);
    const img = ctx.createImageData(w, h);
    const px = img.data;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        const c = colorFn(data[i], (x + 0.5) / w, (y + 0.5) / h, x, y);
        px[i * 4] = to255(c[0]);
        px[i * 4 + 1] = to255(c[1]);
        px[i * 4 + 2] = to255(c[2]);
        px[i * 4 + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    return canvas;
  }

  /** Grayscale canvas of the (clamped) field. Suitable for roughness / metalness / emissive masks. */
  toGrayCanvas() {
    return this.toCanvas(v => [v, v, v]);
  }

  /**
   * Tangent-space normal map (OpenGL convention, as three.js expects) from this height field.
   * strength scales the slopes; ~2-6 is typical for 0..1 height fields at 256-512 px.
   */
  toNormalCanvas(strength = 3) {
    const { w, h, data } = this;
    const { canvas, ctx } = makeCanvas(w, h);
    const img = ctx.createImageData(w, h);
    const px = img.data;
    const s = strength * (w / 256);
    for (let y = 0; y < h; y++) {
      const yu = ((y - 1 + h) % h) * w, yd = ((y + 1) % h) * w, yr = y * w;
      for (let x = 0; x < w; x++) {
        const xl = (x - 1 + w) % w, xr = (x + 1) % w;
        // canvas y grows downward == -v in texture space (CanvasTexture flipY)
        const dhdu = (data[yr + xr] - data[yr + xl]) * 0.5;
        const dhdv = (data[yu + x] - data[yd + x]) * 0.5;
        let nx = -dhdu * s, ny = -dhdv * s, nz = 1;
        const inv = 1 / Math.sqrt(nx * nx + ny * ny + nz * nz);
        nx *= inv; ny *= inv; nz *= inv;
        const i = (yr + x) * 4;
        px[i] = (nx * 0.5 + 0.5) * 255;
        px[i + 1] = (ny * 0.5 + 0.5) * 255;
        px[i + 2] = (nz * 0.5 + 0.5) * 255;
        px[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    return canvas;
  }
}

// ------------------------------------------------------------------ color helpers

const to255 = v => (v <= 0 ? 0 : v >= 1 ? 255 : Math.round(v * 255));

/** '#rrggbb' -> [r,g,b] in 0..1 */
export function hexToRgb(hex) {
  const c = new THREE.Color(hex);
  // THREE.Color stores linear values when ColorManagement is enabled; convert back to sRGB.
  c.convertLinearToSRGB();
  return [c.r, c.g, c.b];
}

export const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
export const scale = (c, s) => [c[0] * s, c[1] * s, c[2] * s];

/**
 * Multi-stop color ramp. stops: [[t, '#hex' | [r,g,b]], ...] sorted by t.
 * Returns fn(t) -> [r,g,b].
 */
export function colorRamp(stops) {
  const s = stops.map(([t, c]) => [t, typeof c === 'string' || typeof c === 'number' ? hexToRgb(c) : c]);
  return t => {
    if (t <= s[0][0]) return s[0][1];
    for (let i = 1; i < s.length; i++) {
      if (t <= s[i][0]) {
        const k = (t - s[i - 1][0]) / (s[i][0] - s[i - 1][0] || 1);
        return mix(s[i - 1][1], s[i][1], k);
      }
    }
    return s[s.length - 1][1];
  };
}

// ------------------------------------------------------------------ canvas / texture helpers

export function makeCanvas(w, h = w) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  return { canvas, ctx };
}

/** Canvas whose pixels are fn(u, v, x, y) -> [r,g,b] or [r,g,b,a] (0..1). */
export function makeCanvasFrom(w, h, fn) {
  const { canvas, ctx } = makeCanvas(w, h);
  const img = ctx.createImageData(w, h);
  const px = img.data;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const c = fn((x + 0.5) / w, (y + 0.5) / h, x, y);
      const i = (y * w + x) * 4;
      px[i] = to255(c[0]);
      px[i + 1] = to255(c[1]);
      px[i + 2] = to255(c[2]);
      px[i + 3] = c.length > 3 ? to255(c[3]) : 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

let _maxAnisotropy = 8;
/** Called once by World/Game with renderer.capabilities.getMaxAnisotropy(). */
export function setMaxAnisotropy(v) { _maxAnisotropy = Math.max(1, v | 0); }

/**
 * Wrap a canvas in a THREE texture.
 * srgb: true for albedo / emissive color maps, false for data (normal, roughness, metalness).
 */
export function canvasTexture(canvas, { srgb = true, repeat = true, anisotropy = 8 } = {}) {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = Math.min(anisotropy, _maxAnisotropy);
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}

/**
 * Convenience: build a PBR texture set.
 *   size        texture resolution (power of two)
 *   albedo      fn(u, v, x, y) -> [r,g,b]            (required)
 *   height      Field (0..1) for the normal map      (optional)
 *   roughness   Field | fn(u,v,x,y)->0..1 | number   (optional)
 *   metalness   Field | fn | number                  (optional; only if non-constant)
 *   emissive    fn(u,v,x,y) -> [r,g,b]               (optional)
 *   normalStrength
 * Returns { map, normalMap?, roughnessMap?, metalnessMap?, emissiveMap? }.
 */
export function buildTextureSet({ size = 512, albedo, height = null, roughness = null, metalness = null, emissive = null, normalStrength = 3 }) {
  const out = {};
  out.map = canvasTexture(makeCanvasFrom(size, size, albedo), { srgb: true });
  if (height) out.normalMap = canvasTexture(height.toNormalCanvas(normalStrength), { srgb: false });
  const gray = src => {
    if (src instanceof Field) return canvasTexture(src.clone().clamp01().toGrayCanvas(), { srgb: false });
    return canvasTexture(makeCanvasFrom(size, size, (u, v, x, y) => { const g = src(u, v, x, y); return [g, g, g]; }), { srgb: false });
  };
  if (roughness !== null && typeof roughness !== 'number') out.roughnessMap = gray(roughness);
  if (metalness !== null && typeof metalness !== 'number') out.metalnessMap = gray(metalness);
  if (emissive) out.emissiveMap = canvasTexture(makeCanvasFrom(size, size, emissive), { srgb: true });
  return out;
}

// ------------------------------------------------------------------ cached shared noise

const _noiseCache = new Map();
/** Shared seeded noise instances (cheap to reuse across generators). */
export function getNoise(seed = 1) {
  let n = _noiseCache.get(seed);
  if (!n) { n = new TileNoise(seed); _noiseCache.set(seed, n); }
  return n;
}

const _fieldCache = new Map();
/**
 * Cached tileable fbm field (0..1 normalized). Reuse across materials to save generation time.
 */
export function noiseField(size = 256, freq = 4, octaves = 5, seed = 1, gain = 0.5) {
  const key = `${size}|${freq}|${octaves}|${seed}|${gain}`;
  let f = _fieldCache.get(key);
  if (!f) {
    const n = getNoise(seed);
    f = new Field(size, size).apply((u, v) => n.fbm(u, v, freq, octaves, gain)).normalize();
    _fieldCache.set(key, f);
  }
  return f;
}
