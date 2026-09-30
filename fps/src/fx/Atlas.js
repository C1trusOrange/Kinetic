import * as THREE from 'three';

/**
 * Procedural sprite atlases for the effects system (generated once, no external assets).
 *
 * PARTICLE atlas: 4x4 cells of 128 px (512x512, RGBA8, origin bottom-left). Cell index = col + row * 4.
 * DECAL atlas:    4x2 cells of 128 px (512x256).
 * Texture data is used as data (alpha + grey shading), never as sRGB colour.
 */

export const CELL = 128;

/** Particle atlas frame indices. */
export const F = {
  GLOW: 0, DISC: 1, STREAK: 2,
  SMOKE0: 3, SMOKE1: 4, SMOKE2: 5, SMOKE3: 6,
  FIRE0: 7, FIRE1: 8,
  DEBRIS0: 9, DEBRIS1: 10, SPLINTER: 11,
  STAR: 12, RING: 13, DOT: 14, ZAP: 15,
};

/** Decal atlas frame indices. */
export const D = {
  HOLE_METAL: 0, HOLE_CONCRETE: 1, HOLE_WOOD: 2, HOLE_DIRT: 3,
  GLASS: 4, SCORCH_ENERGY: 5, SCORCH_BLAST: 6, SCORCH_BLAST2: 7,
};

// ------------------------------------------------------------------ noise helpers

function hash2(ix, iy, seed) {
  let h = (Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(seed, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function vnoise(x, y, seed) {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy, seed), b = hash2(ix + 1, iy, seed);
  const c = hash2(ix, iy + 1, seed), d = hash2(ix + 1, iy + 1, seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

function fbm(x, y, seed, oct = 4) {
  let s = 0, amp = 0.5, f = 1, norm = 0;
  for (let i = 0; i < oct; i++) {
    s += amp * vnoise(x * f, y * f, seed + i * 17);
    norm += amp;
    amp *= 0.5;
    f *= 2.03;
  }
  return s / norm;
}

const clamp01 = v => (v < 0 ? 0 : v > 1 ? 1 : v);
function ss(e0, e1, x) {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
}

/** Paint one atlas cell: fn(u, v) with u, v in [-1, 1] (v up) returns [r, g, b, a] in 0..1. */
function paint(data, width, cols, idx, fn) {
  const cx = (idx % cols) * CELL, cy = Math.floor(idx / cols) * CELL;
  for (let y = 0; y < CELL; y++) {
    const v = ((y + 0.5) / CELL) * 2 - 1;
    for (let x = 0; x < CELL; x++) {
      const u = ((x + 0.5) / CELL) * 2 - 1;
      const px = fn(u, v);
      const o = ((cy + y) * width + cx + x) * 4;
      data[o] = Math.round(clamp01(px[0]) * 255);
      data[o + 1] = Math.round(clamp01(px[1]) * 255);
      data[o + 2] = Math.round(clamp01(px[2]) * 255);
      data[o + 3] = Math.round(clamp01(px[3]) * 255);
    }
  }
}

const PX = [0, 0, 0, 0];
const px = (r, g, b, a) => { PX[0] = r; PX[1] = g; PX[2] = b; PX[3] = a; return PX; };

// ------------------------------------------------------------------ particle cells

function smokeCell(seed) {
  return (u, v) => {
    const r = Math.hypot(u, v);
    const wob = fbm(u * 1.4 + seed * 3.1, v * 1.4 + seed * 1.7, seed, 4) - 0.5;
    const rr = r + wob * 0.75;
    let a = Math.pow(ss(0.96, 0.22, rr), 1.15);
    const dens = 0.6 + 0.4 * fbm(u * 3.0 + seed * 7.3, v * 3.0 + seed * 2.9, seed + 9, 4);
    a = clamp01(a * dens * 1.25);
    const s = 2.0;
    const h0 = fbm(u * s + seed, v * s, seed + 3, 4);
    const hx = fbm((u + 0.09) * s + seed, v * s, seed + 3, 4);
    const hy = fbm(u * s + seed, (v + 0.09) * s, seed + 3, 4);
    let shade = 0.8 + (-(hx - h0) + (hy - h0)) * 2.7;
    shade *= 0.86 + 0.14 * (1 - r);
    shade = Math.max(0.5, Math.min(1, shade));
    return px(shade, shade, shade, a * ss(1.0, 0.88, r));
  };
}

function fireCell(seed) {
  return (u, v) => {
    const r = Math.hypot(u, v);
    const n1 = fbm(u * 2.2 + seed * 5.1, v * 2.2 + seed * 2.3, seed, 4);
    const n2 = fbm(u * 5 + seed * 1.1, v * 5 + seed * 0.7, seed + 7, 3);
    const rr = r + (n1 - 0.5) * 1.05;
    let a = Math.pow(ss(0.98, 0.1, rr), 0.9);
    a *= 0.7 + 0.5 * n2;
    const heat = ss(0.95, 0.0, rr);
    const c = 0.3 + 0.7 * heat * (0.65 + 0.7 * n2);
    return px(c, c * 0.97, c * 0.92, clamp01(a) * ss(1.0, 0.88, r));
  };
}

function debrisPolyCell(seed) {
  const n = 7;
  const radii = [];
  for (let i = 0; i < n; i++) radii.push(0.5 + hash2(i, 3, seed) * 0.4);
  const facets = [];
  for (let i = 0; i < n; i++) facets.push((hash2(i, 9, seed) - 0.5) * 0.4);
  return (u, v) => {
    const r = Math.hypot(u, v);
    let th = Math.atan2(v, u);
    if (th < 0) th += Math.PI * 2;
    const f = (th / (Math.PI * 2)) * n;
    const i0 = Math.floor(f) % n, i1 = (i0 + 1) % n;
    const R = radii[i0] + (radii[i1] - radii[i0]) * (f - Math.floor(f));
    const edge = R - r;
    if (edge < -0.03) return px(0, 0, 0, 0);
    const a = ss(-0.03, 0.03, edge);
    let shade = 0.68 + (-u * 0.5 + v * 0.5) * 0.35 + facets[i0] + (fbm(u * 6, v * 6, seed) - 0.5) * 0.25;
    shade = Math.max(0.3, Math.min(1, shade));
    return px(shade, shade, shade, a);
  };
}

function debrisShardCell(seed) {
  const A = [-0.72, -0.5], B = [0.78, -0.18], C = [-0.12, 0.8];
  const edgeFn = (p, q, u, v) => (q[0] - p[0]) * (v - p[1]) - (q[1] - p[1]) * (u - p[0]);
  return (u, v) => {
    const e0 = edgeFn(A, B, u, v), e1 = edgeFn(B, C, u, v), e2 = edgeFn(C, A, u, v);
    const m = Math.min(e0, e1, e2);
    if (m < -0.03) return px(0, 0, 0, 0);
    const a = ss(-0.03, 0.03, m);
    let shade = 0.62 + (-u * 0.4 + v * 0.55) * 0.4 + (fbm(u * 5 + seed, v * 5, seed) - 0.5) * 0.3;
    if (e1 < 0.12) shade += 0.2;
    shade = Math.max(0.3, Math.min(1, shade));
    return px(shade, shade, shade, a);
  };
}

function splinterCell(seed) {
  return (u, v) => {
    const av = Math.abs(v);
    if (av > 0.96) return px(0, 0, 0, 0);
    const w = 0.13 * (1 - Math.pow(av / 0.96, 2.6)) + (fbm(v * 5, seed, seed) - 0.5) * 0.06;
    const edge = w - Math.abs(u - (fbm(v * 2.5, seed + 4, seed) - 0.5) * 0.12);
    if (edge < -0.02) return px(0, 0, 0, 0);
    const a = ss(-0.02, 0.02, edge);
    const shade = 0.55 + 0.45 * fbm(u * 26, v * 3, seed + 2);
    return px(shade, shade, shade, a);
  };
}

function buildParticleData() {
  const W = CELL * 4;
  const data = new Uint8Array(W * W * 4);
  const cols = 4;
  paint(data, W, cols, F.GLOW, (u, v) => {
    const r = Math.hypot(u, v);
    const g = Math.exp(-r * r * 4.4);
    const core = Math.pow(clamp01(1 - r), 2.4);
    return px(1, 1, 1, clamp01(g * 0.85 + core * 0.45) * ss(1.0, 0.78, r));
  });
  paint(data, W, cols, F.DISC, (u, v) => {
    const r = Math.hypot(u, v);
    return px(1, 1, 1, Math.pow(ss(1.0, 0.3, r), 1.4));
  });
  paint(data, W, cols, F.STREAK, (u, v) => {
    const t = (v + 1) / 2; // 0 tail .. 1 head
    const sig = (0.025 + 0.16 * t) * (1 - 0.8 * ss(0.8, 1.0, t));
    const across = Math.exp(-(u * u) / sig);
    const along = Math.pow(t, 1.15) * ss(1.0, 0.9, t);
    const core = Math.exp(-(u * u) / (sig * 0.25)) * along;
    return px(1, 1, 1, clamp01(across * along * 0.9 + core * 0.6));
  });
  for (let i = 0; i < 4; i++) paint(data, W, cols, F.SMOKE0 + i, smokeCell(i * 11 + 1));
  for (let i = 0; i < 2; i++) paint(data, W, cols, F.FIRE0 + i, fireCell(i * 13 + 5));
  paint(data, W, cols, F.DEBRIS0, debrisPolyCell(21));
  paint(data, W, cols, F.DEBRIS1, debrisShardCell(33));
  paint(data, W, cols, F.SPLINTER, splinterCell(7));
  paint(data, W, cols, F.STAR, (u, v) => {
    const r = Math.hypot(u, v);
    let a = Math.exp(-r * r * 13) * 1.0;
    const spikes = 6;
    for (let k = 0; k < spikes; k++) {
      const th = (k / spikes) * Math.PI + 0.26 * hash2(k, 1, 4);
      const c = Math.cos(th), s = Math.sin(th);
      const along = u * c + v * s, perp = Math.abs(-u * s + v * c);
      const len = 0.62 + 0.36 * hash2(k, 2, 4);
      a += Math.exp(-(perp * perp) / (0.0028 + 0.02 * Math.abs(along))) * ss(len, 0.05, Math.abs(along)) * 0.95;
    }
    a += Math.exp(-r * r * 3.2) * 0.22;
    return px(1, 1, 1, clamp01(a) * ss(1.0, 0.8, r));
  });
  paint(data, W, cols, F.RING, (u, v) => {
    const r = Math.hypot(u, v);
    const ring = Math.exp(-Math.pow((r - 0.86) / 0.06, 2));
    const inner = 0.12 * ss(0.2, 0.86, r) * ss(0.92, 0.86, r);
    return px(1, 1, 1, clamp01(ring + inner) * ss(1.0, 0.94, r));
  });
  paint(data, W, cols, F.DOT, (u, v) => {
    const r = Math.hypot(u, v);
    return px(1, 1, 1, ss(0.9, 0.62, r));
  });
  // ZAP: jagged bolt from the bottom to the top of the cell
  const bolt = [];
  {
    let x = 0;
    for (let i = 0; i <= 12; i++) {
      x += (hash2(i, 5, 99) - 0.5) * 0.36;
      x *= 0.86;
      bolt.push([x, -0.95 + (i / 12) * 1.9]);
    }
  }
  paint(data, W, cols, F.ZAP, (u, v) => {
    let d = 9;
    for (let i = 0; i < bolt.length - 1; i++) {
      const a = bolt[i], b = bolt[i + 1];
      const abx = b[0] - a[0], aby = b[1] - a[1];
      const t = clamp01(((u - a[0]) * abx + (v - a[1]) * aby) / (abx * abx + aby * aby));
      const dx = u - (a[0] + abx * t), dy = v - (a[1] + aby * t);
      d = Math.min(d, dx * dx + dy * dy);
    }
    const a = Math.exp(-d / 0.0012) + 0.32 * Math.exp(-d / 0.02);
    return px(1, 1, 1, clamp01(a) * ss(1.0, 0.8, Math.abs(v)) * ss(1.0, 0.7, Math.abs(u)));
  });
  return data;
}

// ------------------------------------------------------------------ decal cells

function holeCell(kind, seed) {
  return (u, v) => {
    const r = Math.hypot(u, v);
    const th = Math.atan2(v, u);
    const n = fbm(u * 4 + seed, v * 4, seed) - 0.5;
    let rr = r;
    if (kind !== 0) rr = r + n * 0.32;
    const hole = ss(0.22, 0.16, rr);
    let rgb = 0.04, a = hole * 0.96;
    const soot = ss(0.92, 0.1, r) * 0.42;
    if (soot > a) { a = soot; rgb = 0.05; }
    if (kind === 0) {
      // metal: bright bevel ring + radial scratches
      const bevel = ss(0.3, 0.22, r) * ss(0.19, 0.24, r) * (0.55 + 0.45 * fbm(u * 6 + seed, v * 6, seed));
      if (bevel * 0.6 > a) { a = bevel * 0.6; rgb = 0.55; }
      const ang = Math.abs(Math.sin(th * 3.5 + seed * 3 + n * 4));
      const scratch = Math.pow(ang, 70) * ss(0.6, 0.25, r) * ss(0.2, 0.28, r) * 0.28;
      if (scratch > a * 0.6) { a = Math.max(a, scratch); rgb = 0.7; }
    } else if (kind === 1) {
      // concrete: chipped light halo + hairline cracks
      const halo = ss(0.7 + n * 0.5, 0.25, r) * ss(0.16, 0.3, r) * 0.34;
      if (halo > a) { a = halo; rgb = 0.8; }
      const crack = Math.pow(Math.abs(Math.sin(th * 4.5 + n * 3 + seed)), 60) * ss(0.85, 0.2, r) * 0.4;
      if (crack > a) { a = crack; rgb = 0.05; }
    } else if (kind === 2) {
      // wood: splinter ticks
      const tick = Math.pow(Math.abs(Math.sin(th * 9 + seed + n * 2)), 30) * ss(0.7, 0.2, r) * ss(0.16, 0.3, r) * 0.8;
      if (tick > a) { a = tick; rgb = 0.78; }
    }
    return px(rgb, rgb * (kind === 2 ? 0.8 : 1), rgb * (kind === 2 ? 0.55 : 1), a * ss(1.0, 0.86, r));
  };
}

function dirtCell(seed) {
  return (u, v) => {
    const r = Math.hypot(u, v);
    const n = fbm(u * 5 + seed, v * 5, seed);
    let a = Math.pow(ss(0.85, 0.05, r + (n - 0.5) * 0.4), 1.4) * 0.6;
    const clump = ss(0.62, 0.55, Math.abs(hash2(Math.floor(u * 9), Math.floor(v * 9), seed) - 0.5) * 2 + r * 0.4) * ss(0.9, 0.3, r) * 0.25;
    a = Math.max(a, clump);
    return px(0.1, 0.08, 0.05, a * ss(1.0, 0.86, r));
  };
}

function glassCell(seed) {
  return (u, v) => {
    const r = Math.hypot(u, v);
    const th = Math.atan2(v, u);
    const n = fbm(u * 3, v * 3, seed) - 0.5;
    let a = 0;
    // radial cracks
    const rays = 10;
    const ang = th * rays / (Math.PI * 2) + n * 0.7;
    const f = Math.abs(ang - Math.round(ang));
    const rayW = 0.05 + 0.5 * (1 - ss(0.0, 0.9, r)) * 0.2;
    a = Math.max(a, ss(rayW, 0.0, f) * ss(0.95, 0.15, r) * (0.55 + 0.4 * hash2(Math.round(ang), 1, seed)));
    // concentric fracture arcs
    for (const rad of [0.28, 0.5, 0.74]) {
      const d = Math.abs(r - rad - n * 0.1);
      const seg = hash2(Math.floor(th * 3.5), Math.round(rad * 10), seed) > 0.42 ? 1 : 0;
      a = Math.max(a, ss(0.02, 0.0, d) * seg * 0.55);
    }
    a = Math.max(a, ss(0.11, 0.05, r) * 0.9);
    return px(0.9, 0.96, 1.0, clamp01(a) * ss(1.0, 0.88, r));
  };
}

function scorchCell(kind, seed) {
  return (u, v) => {
    const r = Math.hypot(u, v);
    const th = Math.atan2(v, u);
    const n = fbm(u * 2.4 + seed, v * 2.4, seed) - 0.5;
    if (kind === 5) {
      const a = ss(0.85, 0.2, r + n * 0.45) * 0.9;
      const glow = Math.exp(-Math.pow((r - 0.3) / 0.08, 2)) * 0.18;
      return px(0.05 + glow, 0.05 + glow * 1.4, 0.06 + glow * 2.4, clamp01(a) * ss(1.0, 0.85, r));
    }
    const streaks = fbm(th * 2.2 + seed, r * 1.5, seed + 4);
    let a = ss(1.0, 0.08, r + n * 0.6 - 0.15 + (streaks - 0.5) * 0.35);
    a = clamp01(a * (0.72 + 0.4 * streaks));
    const c = 0.03 + 0.09 * fbm(u * 5, v * 5, seed + 8);
    return px(c * 1.15, c, c * 0.9, a * 0.92 * ss(1.0, 0.86, r));
  };
}

function buildDecalData() {
  const W = CELL * 4, H = CELL * 2;
  const data = new Uint8Array(W * H * 4);
  const cols = 4;
  paint(data, W, cols, D.HOLE_METAL, holeCell(0, 3));
  paint(data, W, cols, D.HOLE_CONCRETE, holeCell(1, 5));
  paint(data, W, cols, D.HOLE_WOOD, holeCell(2, 8));
  paint(data, W, cols, D.HOLE_DIRT, dirtCell(2));
  paint(data, W, cols, D.GLASS, glassCell(6));
  paint(data, W, cols, D.SCORCH_ENERGY, scorchCell(5, 1));
  paint(data, W, cols, D.SCORCH_BLAST, scorchCell(6, 4));
  paint(data, W, cols, D.SCORCH_BLAST2, scorchCell(7, 9));
  return data;
}

function makeTexture(data, w, h) {
  const tex = new THREE.DataTexture(data, w, h, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.colorSpace = THREE.NoColorSpace;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.flipY = false;
  tex.premultiplyAlpha = false;
  tex.needsUpdate = true;
  return tex;
}

/** Build the particle atlas texture (512x512). */
export function createParticleAtlas() {
  return makeTexture(buildParticleData(), CELL * 4, CELL * 4);
}

/** Build the decal atlas texture (512x256). */
export function createDecalAtlas() {
  return makeTexture(buildDecalData(), CELL * 4, CELL * 2);
}
