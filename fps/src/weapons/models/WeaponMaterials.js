/**
 * Procedural PBR materials shared by every weapon model (view + world models, grenade, rocket).
 * Built lazily on first use with the procgen toolkit and cached for the whole session - consumers
 * must never dispose these materials or their textures.
 *
 * Tinted variants (polymer, paint, ...) share one texture set and differ only in `material.color`.
 */
import * as THREE from 'three';
import {
  Field, getNoise, noiseField, makeCanvas, makeCanvasFrom, canvasTexture, buildTextureSet, mix, scale,
} from '../../core/procgen.js';
import { mulberry32, smoothstep } from '../../core/utils.js';

/** Meters of geometry per texture repeat, per material key (used by the box-projection UVs). */
export const UV_SCALE = {
  steel: 0.16, steelDark: 0.16, steelBlack: 0.16, poly: 0.14, polyGrey: 0.14, polyTan: 0.14, polyOlive: 0.14,
  paintGreen: 0.16, paintCyan: 0.16, paintOrange: 0.16, paintOlive: 0.16, paintTan: 0.16, paintRed: 0.16, paintWhite: 0.16, paintViolet: 0.16,
  frag: 0.03, grip: 0.05, wood: 0.32, sleeve: 0.06, glove: 0.05, armor: 0.14, rail: 0.02, hazard: 0.18, cell: 0.1,
  ceramic: 0.16,
};
export const DEFAULT_UV_SCALE = 0.2;

let cache = null;

// ------------------------------------------------------------------ texture sets

function steelSet() {
  const S = 256;
  const n = getNoise(41);
  const rng = mulberry32(4242);
  const base = noiseField(256, 3, 4, 21);
  const speck = new Field(S).apply((u, v) => n.fbm(u + 0.5, v, 64, 2) * 0.5 + 0.5);
  const brushed = new Field(S).apply((u, v) => n.perlin(u * 3, v * 120, 3, 120) * 0.5 + 0.5);
  const scratch = new Field(S);
  for (let i = 0; i < 70; i++) {
    const x = rng() * S, y = rng() * S;
    const len = 6 + rng() * 34;
    const ang = (rng() - 0.5) * 0.8 + (rng() < 0.25 ? Math.PI / 2 : 0);
    scratch.line(x, y, x + Math.cos(ang) * len, y + Math.sin(ang) * len, 0.5 + rng() * 0.4, 0.35 + rng() * 0.45, { mode: 'max', soft: 0.7 });
  }
  // sparse edge-wear speckles: small bright flakes
  const wear = new Field(S).apply((u, v) => {
    const f = n.worley(u, v, 44);
    const id = n.cellId / 255;
    const blob = 1 - Math.min(1, f * 3.2);
    return id > 0.93 ? Math.max(0, blob) : 0;
  });
  const height = new Field(S).apply((u, v, x, y) => {
    const i = y * S + x;
    return 0.5 + (speck.data[i] - 0.5) * 0.3 + (brushed.data[i] - 0.5) * 0.05 - scratch.data[i] * 0.3 - wear.data[i] * 0.05;
  });
  const rough = new Field(S).apply((u, v, x, y) => {
    const i = y * S + x;
    return 0.5 + (brushed.data[i] - 0.5) * 0.2 + (speck.data[i] - 0.5) * 0.1 - wear.data[i] * 0.18 + scratch.data[i] * 0.12;
  });
  const metal = new Field(S).apply((u, v, x, y) => 0.56 + wear.data[y * S + x] * 0.4 + (base.sample(u, v) - 0.5) * 0.1);
  const C0 = [0.42, 0.44, 0.48], C1 = [0.5, 0.52, 0.56], BARE = [0.82, 0.84, 0.87];
  return buildTextureSet({
    size: S,
    albedo: (u, v, x, y) => {
      const i = y * S + x;
      let c = mix(C0, C1, base.sample(u, v));
      c = scale(c, 0.94 + (speck.data[i] - 0.5) * 0.14 + brushed.data[i] * 0.05);
      c = mix(c, BARE, Math.min(1, wear.data[i] * 1.4) * 0.75);
      const s = scratch.data[i] * 0.16;
      return [c[0] + s, c[1] + s, c[2] + s];
    },
    height,
    roughness: rough,
    metalness: metal,
    normalStrength: 2.0,
  });
}

function polymerSet() {
  const S = 256;
  const n = getNoise(52);
  const blot = noiseField(256, 5, 4, 53);
  const grain = new Field(S).apply((u, v) => {
    const f1 = n.worley(u, v, 96);
    return 1 - Math.min(1, f1 * 1.35);
  });
  const fine = new Field(S).apply((u, v) => n.fbm(u, v, 64, 2) * 0.5 + 0.5);
  const height = new Field(S).apply((u, v, x, y) => grain.data[y * S + x] * 0.5 + fine.data[y * S + x] * 0.25 + blot.data[y * S + x] * 0.12);
  return buildTextureSet({
    size: S,
    albedo: (u, v, x, y) => {
      const i = y * S + x;
      const g = 0.74 + (blot.data[i] - 0.5) * 0.08 + (grain.data[i] - 0.5) * 0.16 + (fine.data[i] - 0.5) * 0.08;
      return [g, g, g];
    },
    height,
    roughness: (u, v, x, y) => 0.66 + (blot.data[y * S + x] - 0.5) * 0.22 + (grain.data[y * S + x] - 0.5) * 0.14,
    normalStrength: 1.1,
  });
}

/** Painted metal: smooth orange-peel paint with chips that expose dark bare steel. */
function paintSet() {
  const S = 256;
  const n = getNoise(63);
  const blot = noiseField(256, 4, 4, 64);
  const chipN = noiseField(256, 24, 4, 65);
  const chips = new Field(S).apply((u, v, x, y) => {
    const c = chipN.data[y * S + x] + (n.worley(u, v, 24) - 0.5) * 0.35;
    return smoothstep(0.7, 0.76, c);
  });
  const peel = new Field(S).apply((u, v) => n.fbm(u, v, 48, 2) * 0.5 + 0.5);
  const height = new Field(S).apply((u, v, x, y) => 0.55 + peel.data[y * S + x] * 0.12 - chips.data[y * S + x] * 0.25);
  return buildTextureSet({
    size: S,
    albedo: (u, v, x, y) => {
      const i = y * S + x;
      const p = 0.9 + (blot.data[i] - 0.5) * 0.18 + (peel.data[i] - 0.5) * 0.06;
      const k = chips.data[i];
      const g = p * (1 - k) + 0.16 * k;
      return [g, g, g];
    },
    height,
    roughness: (u, v, x, y) => {
      const i = y * S + x;
      return 0.52 + (peel.data[i] - 0.5) * 0.15 + chips.data[i] * -0.18;
    },
    metalness: (u, v, x, y) => 0.06 + chips.data[y * S + x] * 0.85,
    normalStrength: 1.8,
  });
}

/** Walnut with grain running along U (the barrel axis). */
function woodSet() {
  const S = 256;
  const n = getNoise(74);
  const rng = mulberry32(777);
  const warp = new Field(S).apply((u, v) => n.fbm(u, v, 2, 3) * 0.7);
  const streak = new Field(S).apply((u, v) => n.perlin(u * 2, v * 72, 2, 72) * 0.5 + 0.5);
  const rings = new Field(S).apply((u, v, x, y) => {
    const w = warp.data[y * S + x];
    const r = (v * 9 + w * 2.6) % 1;
    return Math.pow(Math.abs(Math.sin(r * Math.PI)), 1.6);
  });
  const pores = new Field(S);
  for (let i = 0; i < 300; i++) {
    const x = rng() * S, y = rng() * S, len = 3 + rng() * 9;
    pores.line(x, y, x + len, y + (rng() - 0.5) * 1.2, 0.7, 1, { mode: 'max', soft: 0.6 });
  }
  const height = new Field(S).apply((u, v, x, y) => {
    const i = y * S + x;
    return 0.5 + streak.data[i] * 0.16 + rings.data[i] * 0.08 - pores.data[i] * 0.18;
  });
  const D = [0.16, 0.085, 0.05], M = [0.34, 0.19, 0.1], L = [0.5, 0.3, 0.16];
  return buildTextureSet({
    size: S,
    albedo: (u, v, x, y) => {
      const i = y * S + x;
      let t = rings.data[i] * 0.55 + streak.data[i] * 0.4 + warp.data[i] * 0.3;
      t = Math.min(1, Math.max(0, t));
      let c = t < 0.5 ? mix(D, M, t * 2) : mix(M, L, (t - 0.5) * 2);
      const p = pores.data[i];
      c = scale(c, 1 - p * 0.45);
      return c;
    },
    height,
    roughness: (u, v, x, y) => 0.42 + streak.data[y * S + x] * 0.16 + pores.data[y * S + x] * 0.25,
    normalStrength: 1.4,
  });
}

/** Diamond knurled rubber. */
function gripSet() {
  const S = 256;
  const n = getNoise(85);
  const wearN = noiseField(256, 6, 4, 86);
  const tri = t => 1 - Math.abs(((t % 1) + 1) % 1 * 2 - 1);
  const height = new Field(S).apply((u, v) => {
    const a = tri(u * 10 + v * 10), b = tri(u * 10 - v * 10);
    return Math.min(1, a * b * 1.6);
  });
  return buildTextureSet({
    size: S,
    albedo: (u, v, x, y) => {
      const i = y * S + x;
      const g = 0.16 + height.data[i] * 0.14 + wearN.data[i] * 0.1;
      return [g, g, g];
    },
    height,
    roughness: (u, v, x, y) => 0.86 - height.data[y * S + x] * 0.1 - wearN.data[y * S + x] * 0.1 + n.fbm(u, v, 32, 1) * 0.04,
    normalStrength: 2.0,
  });
}

/** Woven ripstop fabric for sleeves. */
function fabricSet() {
  const S = 256;
  const n = getNoise(96);
  const thr = 32;
  const height = new Field(S).apply((u, v) => {
    const iu = Math.floor(u * thr), iv = Math.floor(v * thr);
    const over = (iu + iv) & 1;
    const fu = (u * thr) % 1, fv = (v * thr) % 1;
    let h = over ? Math.sin(fv * Math.PI) : Math.sin(fu * Math.PI);
    if (iu % 8 === 0 || iv % 8 === 0) h = h * 0.55 + 0.45;
    return h * 0.6 + n.fbm(u, v, 24, 2) * 0.12;
  });
  return buildTextureSet({
    size: S,
    albedo: (u, v, x, y) => {
      const h = height.data[y * S + x];
      const g = 0.62 + h * 0.3 + n.fbm(u, v, 8, 3) * 0.08;
      return [g, g, g];
    },
    height,
    roughness: () => 0.94,
    normalStrength: 2.6,
  });
}

/** Fine leather / kevlar glove grain. */
function gloveSet() {
  const S = 256;
  const n = getNoise(107);
  const grain = new Field(S).apply((u, v) => 1 - Math.min(1, n.worley(u, v, 128) * 1.3));
  const wrinkle = new Field(S).apply((u, v) => n.ridged(u, v, 8, 3));
  const height = new Field(S).apply((u, v, x, y) => grain.data[y * S + x] * 0.4 + wrinkle.data[y * S + x] * 0.35);
  return buildTextureSet({
    size: S,
    albedo: (u, v, x, y) => {
      const i = y * S + x;
      const g = 0.7 + (grain.data[i] - 0.5) * 0.14 + (wrinkle.data[i] - 0.5) * 0.12;
      return [g, g, g];
    },
    height,
    roughness: (u, v, x, y) => 0.7 + (1 - grain.data[y * S + x]) * 0.15,
    normalStrength: 2.2,
  });
}

/** Picatinny-style slotted rail (one slot per repeat along U). */
function railSet() {
  const S = 128;
  const height = new Field(S).apply((u) => {
    const t = (u * 1) % 1;
    return t < 0.42 ? 1 : t < 0.5 ? 0.6 : t > 0.92 ? 0.6 : 0.05;
  });
  return buildTextureSet({
    size: S,
    albedo: (u) => {
      const t = u % 1;
      const slot = t >= 0.5 && t <= 0.92;
      const g = slot ? 0.14 : 0.5;
      return [g, g, g * 1.05];
    },
    height,
    roughness: (u) => ((u % 1) >= 0.5 && (u % 1) <= 0.92 ? 0.9 : 0.42),
    metalness: (u) => ((u % 1) >= 0.5 && (u % 1) <= 0.92 ? 0.5 : 0.9),
    normalStrength: 2.2,
  });
}

function hazardSet() {
  const S = 128;
  const n = getNoise(118);
  const wearN = noiseField(256, 9, 4, 119);
  const chips = new Field(S).apply((u, v, x, y) => smoothstep(0.66, 0.72, wearN.data[y * S + x] + (n.worley(u, v, 20) - 0.5) * 0.3));
  const height = new Field(S).apply((u, v, x, y) => 0.6 - chips.data[y * S + x] * 0.25 + n.fbm(u, v, 40, 2) * 0.05);
  return buildTextureSet({
    size: S,
    albedo: (u, v, x, y) => {
      const i = y * S + x;
      const stripe = (((u + v) * 5) % 1 + 1) % 1 < 0.5;
      let c = stripe ? [0.95, 0.72, 0.06] : [0.06, 0.06, 0.07];
      const g = 0.86 + (wearN.data[i] - 0.5) * 0.3;
      c = scale(c, g);
      return mix(c, [0.2, 0.2, 0.22], chips.data[i] * 0.85);
    },
    height,
    roughness: (u, v, x, y) => 0.55 + chips.data[y * S + x] * -0.15 + wearN.data[y * S + x] * 0.1,
    metalness: (u, v, x, y) => 0.05 + chips.data[y * S + x] * 0.8,
    normalStrength: 1.6,
  });
}

/** White ceramic glaze (Tempest / Gale): smooth and glossy, faint blotches, hairline panel seams, a few fine chips. */
function ceramicSet() {
  const S = 256;
  const n = getNoise(91);
  const blot = noiseField(256, 3, 4, 92);
  const fine = new Field(S).apply((u, v) => n.fbm(u, v, 40, 2) * 0.5 + 0.5);
  const seam = new Field(S).apply((u, v, x, y) => {
    const dx = Math.min(x % 128, 128 - (x % 128)), dy = Math.min(y % 128, 128 - (y % 128));
    return Math.min(dx, dy) < 1.4 ? 1 : 0;
  });
  const chips = new Field(S).apply((u, v) => {
    const f = n.worley(u, v, 22);
    const id = n.cellId / 255;
    return id > 0.95 ? Math.max(0, 1 - Math.min(1, f * 4.2)) * 0.6 : 0;
  });
  const height = new Field(S).apply((u, v, x, y) => {
    const i = y * S + x;
    return 0.62 + (fine.data[i] - 0.5) * 0.08 - seam.data[i] * 0.4 - chips.data[i] * 0.15;
  });
  return buildTextureSet({
    size: S,
    albedo: (u, v, x, y) => {
      const i = y * S + x;
      const g = 0.95 + (blot.data[i] - 0.5) * 0.09 + (fine.data[i] - 0.5) * 0.04 - seam.data[i] * 0.3 - chips.data[i] * 0.22;
      return [g, g, g * 1.01];
    },
    height,
    roughness: (u, v, x, y) => {
      const i = y * S + x;
      return 0.3 + (fine.data[i] - 0.5) * 0.12 + seam.data[i] * 0.3 + chips.data[i] * 0.2;
    },
    metalness: () => 0.05,
    normalStrength: 1.4,
  });
}

/** Frag grenade body: raised square lugs separated by grooves. */
function fragSet() {
  const S = 128;
  const n = getNoise(139);
  const cells = 8, cs = S / cells;
  const height = new Field(S);
  for (let cy = 0; cy < cells; cy++) for (let cx = 0; cx < cells; cx++) height.rect(cx * cs + 1, cy * cs + 1, cs - 2, cs - 2, 1, { bevel: 3, base: 0, mode: 'max' });
  return buildTextureSet({
    size: S,
    albedo: (u, v, x, y) => {
      const h = height.data[y * S + x];
      const g = 0.4 + h * 0.5 + n.fbm(u, v, 6, 3) * 0.08;
      return [g, g, g];
    },
    height,
    roughness: (u, v, x, y) => 0.7 - height.data[y * S + x] * 0.2,
    metalness: (u, v, x, y) => 0.15 + height.data[y * S + x] * 0.2,
    normalStrength: 3.4,
  });
}

/** Energy cell: horizontal glowing bands with a bright core and circuit notches. */
function cellSet() {
  const S = 128;
  const n = getNoise(129);
  const emissive = (u, v) => {
    const band = 0.5 + 0.5 * Math.sin(v * Math.PI * 2 * 6);
    const core = Math.pow(1 - Math.abs(u - 0.5) * 2, 0.7);
    const g = 0.25 + 0.75 * band * core + n.fbm(u, v, 8, 2) * 0.1;
    return [g * 0.4, g * 0.95, g];
  };
  const map = canvasTexture(makeCanvasFrom(S, S, (u, v) => { const e = emissive(u, v); return [e[0] * 0.3, e[1] * 0.3, e[2] * 0.3]; }), { srgb: true });
  const emissiveMap = canvasTexture(makeCanvasFrom(S, S, emissive), { srgb: true });
  return { map, emissiveMap };
}

// ------------------------------------------------------------------ small texture helpers

function reticleTexture(kind) {
  const S = 128;
  const { canvas, ctx } = makeCanvas(S, S);
  ctx.clearRect(0, 0, S, S);
  const c = S / 2;
  ctx.strokeStyle = '#ffffff';
  ctx.fillStyle = '#ffffff';
  ctx.shadowColor = '#ffffff';
  ctx.shadowBlur = 5;
  if (kind === 'ring') {
    ctx.lineWidth = 3.2;
    ctx.beginPath(); ctx.arc(c, c, 34, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.arc(c, c, 3.6, 0, Math.PI * 2); ctx.fill();
    ctx.lineWidth = 3.2;
    for (let i = 0; i < 4; i++) {
      const a = i * Math.PI / 2;
      ctx.beginPath();
      ctx.moveTo(c + Math.cos(a) * 34, c + Math.sin(a) * 34);
      ctx.lineTo(c + Math.cos(a) * 46, c + Math.sin(a) * 46);
      ctx.stroke();
    }
  } else {
    ctx.beginPath(); ctx.arc(c, c, 6, 0, Math.PI * 2); ctx.fill();
  }
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function glowTexture() {
  const S = 64;
  const { canvas, ctx } = makeCanvas(S, S);
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, 'rgba(255,255,255,0.9)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.35)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ------------------------------------------------------------------ material factory

const _lblCache = new Map();

/**
 * Stencil / label decal material (transparent text on a plane). Cached by key.
 * @param {string} key cache key
 * @param {string} text label text
 * @param {{w?:number,h?:number,color?:string,font?:string,bg?:string|null,size?:number,spacing?:number,opacity?:number}} [o]
 */
export function labelMaterial(key, text, o = {}) {
  let m = _lblCache.get(key);
  if (m) return m;
  const w = o.w || 256, h = o.h || 64;
  const { canvas, ctx } = makeCanvas(w, h);
  ctx.clearRect(0, 0, w, h);
  if (o.bg) { ctx.fillStyle = o.bg; ctx.fillRect(0, 0, w, h); }
  ctx.fillStyle = o.color || '#e8edf2';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const size = o.size || Math.round(h * 0.62);
  ctx.font = `${o.weight || '700'} ${size}px ${o.font || '"Bahnschrift", "Segoe UI", Arial, sans-serif'}`;
  if ('letterSpacing' in ctx) ctx.letterSpacing = `${o.spacing ?? 2}px`;
  const lines = String(text).split('\n');
  const lh = size * 1.05;
  lines.forEach((ln, i) => ctx.fillText(ln, w / 2, h / 2 + (i - (lines.length - 1) / 2) * lh));
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  m = new THREE.MeshStandardMaterial({
    map: tex, transparent: true, opacity: o.opacity ?? 0.92, roughness: 0.55, metalness: 0.1, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });
  _lblCache.set(key, m);
  return m;
}

const SET_FNS = {
  steel: steelSet, poly: polymerSet, paint: paintSet, wood: woodSet, grip: gripSet, fabric: fabricSet,
  glove: gloveSet, rail: railSet, hazard: hazardSet, cell: cellSet, frag: fragSet, ceramic: ceramicSet,
};
const SETS = {};
const TIMES = {};

/** Generates (once) the named procedural texture set. */
function textureSet(key) {
  if (!SETS[key]) {
    const t = performance.now();
    SETS[key] = SET_FNS[key]();
    TIMES[key] = Math.round(performance.now() - t);
    if (typeof window !== 'undefined') window.__WEAPON_TEX_MS__ = TIMES;
  }
  return SETS[key];
}

/**
 * Generates the texture sets one at a time, awaiting `yieldFn` in between (keeps a loading screen alive).
 * @param {() => Promise<void>} yieldFn
 */
export async function preloadMaterialSets(yieldFn) {
  for (const key of Object.keys(SET_FNS)) {
    textureSet(key);
    await yieldFn();
  }
}

function build() {
  const M = {};
  const steel = textureSet('steel');
  const poly = textureSet('poly');
  const paint = textureSet('paint');
  const wood = textureSet('wood');
  const grip = textureSet('grip');
  const fabric = textureSet('fabric');
  const glove = textureSet('glove');
  const rail = textureSet('rail');
  const hazard = textureSet('hazard');
  const cell = textureSet('cell');
  const frag = textureSet('frag');
  const ceramic = textureSet('ceramic');

  const withSet = (set, params) => new THREE.MeshStandardMaterial({
    map: set.map, normalMap: set.normalMap || null, roughnessMap: set.roughnessMap || null, metalnessMap: set.metalnessMap || null,
    vertexColors: true, ...params,
  });

  M.steel = withSet(steel, { color: 0xffffff, roughness: 1, metalness: 1 });
  M.steelDark = withSet(steel, { color: 0xd8dce2, roughness: 1, metalness: 1 });
  M.steelBlack = withSet(steel, { color: 0xb4b9c1, roughness: 1, metalness: 1 });
  M.poly = withSet(poly, { color: 0x555a63, roughness: 1, metalness: 0.04 });
  M.polyGrey = withSet(poly, { color: 0x6f757d, roughness: 1, metalness: 0.04 });
  M.polyTan = withSet(poly, { color: 0xc4ae7c, roughness: 1, metalness: 0.04 });
  M.polyOlive = withSet(poly, { color: 0x77835a, roughness: 1, metalness: 0.04 });
  const paints = { paintGreen: 0x7fd12a, paintCyan: 0x2fc4e6, paintOrange: 0xff8a1e, paintOlive: 0x5f6b45, paintTan: 0x9b8a62, paintRed: 0xc23a2a, paintWhite: 0xd8dde2, paintViolet: 0x7a52d6 };
  for (const [k, c] of Object.entries(paints)) M[k] = withSet(paint, { color: c, roughness: 1, metalness: 1 });
  M.frag = withSet(frag, { color: 0x8c9a66, roughness: 1, metalness: 1 });
  M.ceramic = withSet(ceramic, { color: 0xe6eaee, roughness: 1, metalness: 1 });
  M.grip = withSet(grip, { color: 0xffffff, roughness: 1, metalness: 0 });
  M.wood = withSet(wood, { color: 0xffffff, roughness: 1, metalness: 0, });
  M.sleeve = withSet(fabric, { color: 0x38424e, roughness: 1, metalness: 0 });
  M.glove = withSet(glove, { color: 0x626c78, roughness: 1, metalness: 0 });
  M.armor = withSet(poly, { color: 0x77818d, roughness: 1, metalness: 0.15 });
  M.rail = withSet(rail, { color: 0xc8ccd2, roughness: 1, metalness: 1 });
  M.hazard = withSet(hazard, { color: 0xffffff, roughness: 1, metalness: 1 });
  M.void = new THREE.MeshStandardMaterial({ color: 0x050607, roughness: 0.85, metalness: 0.1, vertexColors: true });
  M.rubber = new THREE.MeshStandardMaterial({ color: 0x141517, roughness: 0.95, metalness: 0, vertexColors: true });
  M.brass = new THREE.MeshStandardMaterial({ color: 0xc79a3c, roughness: 0.32, metalness: 1, vertexColors: true });
  M.cellBody = new THREE.MeshStandardMaterial({
    color: 0x1a3a44, map: cell.map, emissive: 0xffffff, emissiveMap: cell.emissiveMap, emissiveIntensity: 2.2,
    roughness: 0.35, metalness: 0, vertexColors: true,
  });

  const glow = (hex, i) => new THREE.MeshStandardMaterial({ color: 0x0b0d10, emissive: hex, emissiveIntensity: i, roughness: 0.4, metalness: 0, vertexColors: true });
  M.glowCyan = glow(0x3de0ff, 2.6);
  M.glowGreen = glow(0x7dff3a, 2.4);
  M.glowRed = glow(0xff2a1a, 3.0);
  M.glowOrange = glow(0xff8a1e, 2.6);
  M.glowAmber = glow(0xffc23a, 2.6);
  M.glowWhite = glow(0xffffff, 2.2);
  // view-model-only instances whose emissive is driven every frame (smg momentum gauge, rail charge glow / fusion cell)
  M.glowGauge = glow(0xffc23a, 0.4);
  M.glowRing = glow(0xffc23a, 0.3);
  M.glowChannel = glow(0x3de0ff, 0.25);
  M.glowCell = glow(0x3de0ff, 1.0);
  M.glowViolet = glow(0x9a55ff, 1.9);
  M.glowArm = glow(0x3de0ff, 0.95);

  M.lens = new THREE.MeshStandardMaterial({
    color: 0x9ad8ff, roughness: 0.04, metalness: 0, transparent: true, opacity: 0.2, depthWrite: false, envMapIntensity: 2.2, vertexColors: true,
  });
  M.lensDark = new THREE.MeshStandardMaterial({
    color: 0x14284a, roughness: 0.06, metalness: 0.4, transparent: true, opacity: 0.88, envMapIntensity: 2.4, vertexColors: true,
  });
  M.lensRuby = new THREE.MeshStandardMaterial({
    color: 0x5a0a2a, roughness: 0.06, metalness: 0.3, transparent: true, opacity: 0.85, envMapIntensity: 2.4, vertexColors: true,
  });
  M.reticleRing = new THREE.MeshBasicMaterial({
    map: reticleTexture('ring'), color: 0xff3a2a, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, side: THREE.DoubleSide,
  });
  M.reticleDot = new THREE.MeshBasicMaterial({
    map: reticleTexture('dot'), color: 0xff4a3a, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, side: THREE.DoubleSide,
  });
  M.flameGlow = new THREE.MeshBasicMaterial({
    map: glowTexture(), color: 0xff8a2a, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, side: THREE.DoubleSide,
  });
  M.flame = new THREE.MeshBasicMaterial({
    vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, side: THREE.DoubleSide,
  });
  return M;
}

/** Returns the shared material table (built on first call). */
export function getMaterials() {
  if (!cache) cache = build();
  return cache;
}
