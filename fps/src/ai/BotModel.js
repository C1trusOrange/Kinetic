/**
 * KINETIC - BotModel: the procedural low-poly combat robot (ARCHITECTURE.md section 6.7).
 *
 * Visuals
 *   - 13 skinned-by-hierarchy meshes (pelvis, torso, head, 2x upper arm / forearm / thigh / shin, 2x foot),
 *     all sharing ONE painted-metal texture atlas (albedo / normal / roughness / metalness / emissive)
 *     generated in code with procgen.js: panel seams, rivets, vents, hazard stripes, edge wear, grime,
 *     scratches, stencilled unit numbers, a glowing visor and reactor core.
 *   - The atlas is built once; the albedo is re-tinted per accent colour (cached). Geometry is built once
 *     and shared by every instance. Per instance there are only 13 Mesh objects and a few Object3Ds.
 *
 * Animation (fully procedural, driven only by the `state` object passed to update())
 *   - phase-based gait with analytic two-bone IK legs (feet stay planted, lift, roll heel-to-toe),
 *     hip bob / sway / twist, lean into motion, strafe + backpedal, crouch squat, airborne tuck, landing dip,
 *   - torso twist + pitch toward the aim, head tracking, weapon held two-handed (IK arms) along the aim
 *     direction with ready / shoulder-aim / sprint-carry poses, recoil kicks, reload gesture, hit flinch,
 *     hit flash, collapse pose when dead. All states blend with exponential smoothing (no pops).
 */
import * as THREE from 'three';
import { Field, noiseField, makeCanvas, canvasTexture, hexToRgb } from '../core/procgen.js';
import { clamp, lerp, smoothstep, mulberry32 } from '../core/utils.js';

// ====================================================================== dimensions (meters)

const HIP_Y = 0.95;               // hips origin height when standing
const HIP_X = 0.115;              // hip joint half spacing
const HIP_DY = -0.03;             // hip joint below hips origin
const THIGH = 0.43;
const SHIN = 0.43;
const ANKLE = 0.085;              // ankle joint height above the sole
const WAIST_DY = 0.12;            // torso pivot above hips origin
const SHOULDER_X = 0.29;
const SHOULDER_Y = 0.37;          // in torso space
const ARM_U = 0.30;
const ARM_L = 0.38;               // forearm + half hand (IK end effector = fist centre)
const NECK_Y = 0.46;              // head pivot in torso space
const PIVOT_Y = 0.24;             // aim pivot (chest) in torso space
const CROUCH_HIPS = 0.37;
const EMISSIVE_INTENSITY = 2.6;

// ====================================================================== texture atlas

const ATLAS = 512;
const DENSITY = 480;              // texels per meter for cropped (non-fitted) faces

/** name -> [x, y, w, h] in atlas pixels (top-left origin). */
const TILES = {
  paint: [0, 0, 256, 256],
  dark: [256, 0, 128, 128],
  edge: [384, 0, 64, 64],
  glow: [448, 0, 64, 32],
  glowDim: [448, 32, 64, 32],
  visor: [384, 64, 128, 48],
  core: [384, 112, 64, 64],
  accent: [256, 128, 128, 128],
  accent2: [384, 176, 128, 80],
  chest: [0, 256, 256, 128],
  back: [0, 384, 128, 128],
  hazard: [128, 384, 64, 64],
  shoulderL: [256, 256, 128, 96],
  shoulderR: [384, 256, 128, 96],
};

const M_PAINT = 0, M_DARK = 1, M_BARE = 2, M_ACCENT = 3, M_GLOW = 4, M_INK = 5;

const C_PAINT = [0.68, 0.71, 0.76];
const C_DARK = [0.11, 0.115, 0.13];
const C_BARE = [0.56, 0.58, 0.62];
const C_STEEL = [0.42, 0.44, 0.48];
const C_INK = [0.045, 0.045, 0.055];
const C_ACC = [0.85, 0.35, 0.25];

const NUMBER_RECTS = [
  { tile: 'shoulderL', x: 12, y: 10, w: 104, h: 52, font: 50 },
  { tile: 'back', x: 24, y: 94, w: 80, h: 26, font: 26 },
];

let _atlas = null;

/** Build (once) the shared texture atlas and return the per-colour albedo factory. */
function getAtlas() {
  if (_atlas) return _atlas;
  const t0 = performance.now();
  const S = ATLAS, N = S * S;
  const rng = mulberry32(90211);
  const H = new Field(S, S, 0.5);
  const hd = H.data;
  const mat = new Uint8Array(N);
  const tone = new Float32Array(N).fill(1);
  const em = new Float32Array(N);

  // ---------------------------------------------------------------- paint primitives
  const inb = (x, y) => x >= 0 && y >= 0 && x < S && y < S;
  const setMat = (x, y, w, h, m, t) => {
    for (let yy = y; yy < y + h; yy++) {
      for (let xx = x; xx < x + w; xx++) {
        if (!inb(xx, yy)) continue;
        const i = yy * S + xx;
        mat[i] = m;
        if (t !== undefined) tone[i] = t;
      }
    }
  };
  const setEm = (x, y, w, h, v) => {
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) if (inb(xx, yy)) em[yy * S + xx] = v;
  };
  const base = (name, m, height) => {
    const [x, y, w, h] = TILES[name];
    H.rect(x, y, w, h, height, { mode: 'set' });
    setMat(x, y, w, h, m, 1);
  };
  const rivet = (cx, cy, r = 1.8, amt = 0.2) => H.circle(cx, cy, r, amt, { soft: 0.6, mode: 'add', shape: 'dome' });
  const slots = (x, y, w, h, count, m = M_DARK) => {
    const pitch = h / count;
    for (let k = 0; k < count; k++) {
      const sy = Math.round(y + k * pitch + pitch * 0.25);
      const sh = Math.max(2, Math.round(pitch * 0.5));
      H.rect(x, sy, w, sh, 0.2, { mode: 'set' });
      setMat(x, sy, w, sh, m);
    }
  };
  const tcv = makeCanvas(128, 48);
  const stamp = (str, x, y, size, m = M_INK) => {
    const { ctx } = tcv;
    ctx.clearRect(0, 0, 128, 48);
    ctx.font = `bold ${size}px Consolas, "Courier New", monospace`;
    ctx.fillStyle = '#fff';
    ctx.textBaseline = 'top';
    ctx.fillText(str, 1, 1);
    const w = Math.min(128, Math.ceil(ctx.measureText(str).width) + 2), h = Math.min(48, size + 4);
    const d = ctx.getImageData(0, 0, w, h).data;
    for (let yy = 0; yy < h; yy++) {
      for (let xx = 0; xx < w; xx++) {
        if (d[(yy * w + xx) * 4 + 3] > 120 && inb(x + xx, y + yy)) mat[(y + yy) * S + x + xx] = m;
      }
    }
  };
  const LABELS = ['A-07', 'RX', 'K9', 'VLT', 'HOT', 'EXO', '04', 'SAFE', 'MK3', 'GX-1'];

  const drawPanel = (x, y, w, h, m, plain = false) => {
    H.rect(x + 1, y + 1, w - 2, h - 2, 0.62 + rng() * 0.06, { bevel: 2.5, base: 0.36, mode: 'set' });
    setMat(x + 1, y + 1, w - 2, h - 2, m, 0.9 + rng() * 0.14);
    if (plain) return;
    if (w > 26 && h > 26 && rng() < 0.75) {
      rivet(x + 5, y + 5); rivet(x + w - 5, y + 5); rivet(x + 5, y + h - 5); rivet(x + w - 5, y + h - 5);
    }
    const r = rng();
    if (r < 0.2 && w > 30 && h > 24) {
      slots(x + 6, y + Math.round(h * 0.28), w - 12, Math.round(h * 0.44), 4);
    } else if (r < 0.34 && w > 34 && h > 34) {
      H.rect(x + 8, y + 8, w - 16, h - 16, 0.5, { bevel: 2, base: 0.36, mode: 'set' });
      rivet(x + 12, y + 12, 1.4, 0.15); rivet(x + w - 12, y + h - 12, 1.4, 0.15);
    } else if (r < 0.48 && w > 24) {
      setMat(x + 2, y + Math.round(h * 0.5) - 2, w - 4, 3, m === M_PAINT ? M_ACCENT : M_DARK);
    } else if (r < 0.58 && w > 44 && h > 26) {
      stamp(LABELS[Math.floor(rng() * LABELS.length)], x + 6, y + h - 16, 11);
    }
  };
  const panelize = (name, m, minSize, region) => {
    const [tx, ty, tw, th] = region || TILES[name];
    const inset = 3;
    const rec = (x, y, w, h, depth) => {
      const canSplit = w > minSize * 2 || h > minSize * 2;
      if (!canSplit || (depth >= 2 && rng() < 0.35)) { drawPanel(x, y, w, h, m); return; }
      if (w >= h * (0.8 + rng() * 0.5) && w > minSize * 2) {
        const c = Math.round(w * (0.35 + rng() * 0.3));
        rec(x, y, c, h, depth + 1); rec(x + c, y, w - c, h, depth + 1);
      } else if (h > minSize * 2) {
        const c = Math.round(h * (0.35 + rng() * 0.3));
        rec(x, y, w, c, depth + 1); rec(x, y + c, w, h - c, depth + 1);
      } else drawPanel(x, y, w, h, m);
    };
    rec(tx + inset, ty + inset, tw - inset * 2, th - inset * 2, 0);
  };
  const stripes = (x, y, w, h, period = 16) => {
    for (let yy = y; yy < y + h; yy++) {
      for (let xx = x; xx < x + w; xx++) {
        const a = (((xx + yy) % period) + period) % period < period / 2;
        const i = yy * S + xx;
        mat[i] = a ? M_ACCENT : M_DARK;
        hd[i] = a ? 0.6 : 0.46;
        tone[i] = 1;
      }
    }
  };
  const mirrorX = (tile, x0, w) => {
    const [tx, ty, tw, th] = TILES[tile];
    for (let y = 0; y < th; y++) {
      for (let x = 0; x < w; x++) {
        const a = (ty + y) * S + tx + x0 + x, b = (ty + y) * S + tx + tw - 1 - (x0 + x);
        hd[b] = hd[a]; mat[b] = mat[a]; tone[b] = tone[a]; em[b] = em[a];
      }
    }
  };

  // ---------------------------------------------------------------- tiles
  // generic light armour: random panel layout, rivets, vents, hatches, pinstripes, labels
  base('paint', M_DARK, 0.34);
  panelize('paint', M_PAINT, 46);

  // dark gunmetal: staggered rows of small plates + cables
  {
    const [tx, ty, tw, th] = TILES.dark;
    base('dark', M_DARK, 0.34);
    const rowH = 14;
    for (let r = 0; (r + 1) * rowH <= th - 4; r++) {
      const y0 = ty + 3 + r * rowH;
      let xc = tx + 3 - (r % 2 ? 12 : 0);
      while (xc < tx + tw - 3) {
        const pw = 22 + Math.floor(rng() * 22);
        const x0 = Math.max(xc, tx + 3), x1 = Math.min(xc + pw, tx + tw - 3);
        if (x1 - x0 > 8) {
          drawPanel(x0, y0, x1 - x0, rowH - 1, M_DARK, true);
          if (rng() < 0.6) rivet(x0 + 4, y0 + rowH / 2, 1.3, 0.16);
        }
        xc += pw;
      }
    }
    for (let c = 0; c < 2; c++) {
      const cy = ty + 34 + c * 60, ph = rng() * 6;
      for (let x = tx + 4; x < tx + tw - 8; x += 4) {
        const y1 = cy + Math.sin((x - tx) * 0.09 + ph) * 6, y2 = cy + Math.sin((x + 4 - tx) * 0.09 + ph) * 6;
        H.line(x, y1, x + 4, y2, 3, 0.8, { mode: 'max', soft: 1 });
      }
    }
  }

  // bare brushed steel (bevel highlights)
  {
    const [tx, ty, tw, th] = TILES.edge;
    base('edge', M_BARE, 0.5);
    const n = noiseField(128, 8, 3, 55);
    for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) hd[(ty + y) * S + tx + x] = 0.5 + 0.14 * (n.sample(x * 0.004, y * 0.09) - 0.5);
  }

  // glow strips
  base('glow', M_GLOW, 0.5);
  setEm(TILES.glow[0], TILES.glow[1], TILES.glow[2], TILES.glow[3], 1);
  base('glowDim', M_GLOW, 0.5);
  setEm(TILES.glowDim[0], TILES.glowDim[1], TILES.glowDim[2], TILES.glowDim[3], 0.42);

  // visor: dark frame, recessed emissive lens with LED segments
  {
    const [tx, ty, tw, th] = TILES.visor;
    base('visor', M_DARK, 0.55);
    const ix = tx + 3, iy = ty + 7, iw = tw - 6, ih = th - 14;
    H.rect(ix, iy, iw, ih, 0.42, { mode: 'set', bevel: 3, base: 0.6 });
    setMat(ix, iy, iw, ih, M_GLOW);
    for (let y = 0; y < ih; y++) {
      const c = 1 - Math.abs((y + 0.5) / ih - 0.5) * 2;
      for (let x = 0; x < iw; x++) {
        const seg = (x % 10) === 0 ? 0.5 : 1;
        em[(iy + y) * S + ix + x] = (0.78 + 0.22 * c) * seg;
      }
    }
  }

  // reactor core: glowing disc with spokes inside a dark ring
  {
    const [tx, ty, tw, th] = TILES.core;
    base('core', M_DARK, 0.45);
    const cx = tx + tw / 2, cy = ty + th / 2;
    for (let y = 0; y < th; y++) {
      for (let x = 0; x < tw; x++) {
        const dx = tx + x + 0.5 - cx, dy = ty + y + 0.5 - cy;
        const r = Math.hypot(dx, dy);
        const i = (ty + y) * S + tx + x;
        if (r < 25) {
          mat[i] = M_GLOW;
          let e = r < 5 ? 1 : 0.55 + 0.45 * (1 - r / 25);
          const a = Math.atan2(dy, dx);
          const spoke = Math.abs(((a / (Math.PI / 3)) % 1 + 1) % 1 - 0.5);
          if (spoke > 0.44 && r > 6) { e *= 0.25; hd[i] = 0.4; } else hd[i] = 0.5;
          if (r > 13 && r < 15.5) { e *= 0.3; hd[i] = 0.62; }
          em[i] = e;
        } else if (r < 30) { hd[i] = 0.72; } else hd[i] = 0.45;
      }
    }
  }

  // accent plates
  base('accent', M_DARK, 0.34);
  panelize('accent', M_ACCENT, 40);
  {
    const [tx, ty, tw, th] = TILES.accent2;
    base('accent2', M_DARK, 0.34);
    drawPanel(tx + 3, ty + 3, tw - 6, th - 6, M_ACCENT, true);
    for (let y = 8; y < th - 8; y++) {
      for (let x = 10; x < tw - 10; x++) {
        const q = ((Math.abs(x - tw / 2) * 0.9 + y) % 22 + 22) % 22;
        if (q < 6) { const i = (ty + y) * S + tx + x; mat[i] = M_INK; hd[i] = 0.58; }
      }
    }
    rivet(tx + 8, ty + 8); rivet(tx + tw - 8, ty + 8); rivet(tx + 8, ty + th - 8); rivet(tx + tw - 8, ty + th - 8);
  }

  // chest: paint panels + accent V chevrons + centre vents, mirrored left/right
  {
    const [tx, ty, tw, th] = TILES.chest;
    const half = tw / 2;
    base('chest', M_DARK, 0.34);
    panelize('chest', M_PAINT, 44, [tx, ty, half, th]);
    for (let y = 0; y < th; y++) {
      for (let x = 0; x < half; x++) {
        const yc = 84 - (half - 1 - x) * 0.36;
        const dy = y - yc;
        const i = (ty + y) * S + tx + x;
        if (Math.abs(dy) < 8 && x > 4) { mat[i] = M_ACCENT; hd[i] = 0.68; tone[i] = 1; }
        else if (Math.abs(dy - 19) < 2.5 && x > 10) { mat[i] = M_ACCENT; hd[i] = 0.64; tone[i] = 1; }
      }
    }
    slots(tx + half - 34, ty + 96, 30, 24, 4);
    rivet(tx + 14, ty + 14, 2, 0.24);
    rivet(tx + half - 10, ty + 20, 2.4, 0.28);
    setMat(tx + half - 12, ty + 18, 5, 5, M_BARE);
    mirrorX('chest', 0, half);
  }

  // reactor pack rear plate: grilles, socket ring, hazard header, number plate
  {
    const [tx, ty, tw, th] = TILES.back;
    base('back', M_DARK, 0.34);
    drawPanel(tx + 3, ty + 3, tw - 6, th - 6, M_PAINT, true);
    slots(tx + 8, ty + 26, 18, 62, 8);
    slots(tx + tw - 26, ty + 26, 18, 62, 8);
    stripes(tx + 10, ty + 8, tw - 20, 9, 12);
    const cx = tx + 64, cy = ty + 56;
    for (let y = -40; y <= 40; y++) {
      for (let x = -40; x <= 40; x++) {
        const r = Math.hypot(x, y), i = (cy + y) * S + cx + x;
        if (r < 37) { mat[i] = M_DARK; hd[i] = r < 33 ? 0.4 : 0.66; }
      }
    }
    drawPanel(tx + 20, ty + 92, 88, 30, M_ACCENT, true);
  }

  // hazard swatch
  {
    const [tx, ty, tw, th] = TILES.hazard;
    base('hazard', M_DARK, 0.34);
    stripes(tx + 3, ty + 3, tw - 6, th - 6, 16);
  }

  // shoulders: number plate (left) and chevron plate (right)
  for (const name of ['shoulderL', 'shoulderR']) {
    const [tx, ty, tw, th] = TILES[name];
    base(name, M_DARK, 0.34);
    drawPanel(tx + 3, ty + 3, tw - 6, th - 6, M_ACCENT, true);
    stripes(tx + 8, ty + th - 26, tw - 16, 14, 14);
    rivet(tx + 8, ty + 8); rivet(tx + tw - 8, ty + 8);
    if (name === 'shoulderR') {
      for (let y = 8; y < th - 32; y++) {
        for (let x = 6; x < tw - 6; x++) {
          const d = Math.abs(x - tw / 2) * 0.85;
          for (let k = 0; k < 3; k++) {
            if (Math.abs(y - (14 + d * 0.5 + k * 16)) < 3.2) { const i = (ty + y) * S + tx + x; mat[i] = M_INK; hd[i] = 0.58; }
          }
        }
      }
    } else {
      H.rect(tx + 10, ty + 8, tw - 20, 56, 0.55, { bevel: 1.5, base: 0.4, mode: 'set' });
    }
  }

  // ---------------------------------------------------------------- derived maps
  const Hb = H.clone().blur(2, 2);
  const hb = Hb.data;
  const nWear = noiseField(128, 6, 3, 101);
  const nStain = noiseField(128, 3, 3, 102);
  const nStreak = noiseField(128, 5, 3, 103);
  const scratch = new Field(S, S, 0);
  for (let k = 0; k < 260; k++) {
    const x = rng() * S, y = rng() * S, a = rng() * Math.PI, len = 5 + rng() * 32;
    scratch.line(x, y, x + Math.cos(a) * len, y + Math.sin(a) * len, 0.6 + rng() * 0.6, 0.5 + rng() * 0.5, { mode: 'max', soft: 0.6 });
  }
  // micro scratches also dent the normal map slightly
  for (let i = 0; i < N; i++) if (scratch.data[i] > 0.4) hd[i] = Math.max(0.05, hd[i] - 0.05 * scratch.data[i]);

  const albedo = new Uint8ClampedArray(N * 4);
  const rough = new Uint8ClampedArray(N);
  const metal = new Uint8ClampedArray(N);
  const emis = new Uint8ClampedArray(N);
  const shadeAll = new Float32Array(N);
  const wearAll = new Float32Array(N);
  const bareAll = new Float32Array(N);
  const accList = [];
  for (let y = 0; y < S; y++) {
    const v = (y + 0.5) / S;
    for (let x = 0; x < S; x++) {
      const i = y * S + x, u = (x + 0.5) / S;
      const curv = hd[i] - hb[i];
      const convex = clamp(curv * 15, 0, 1);
      const cavity = clamp(-curv * 15, 0, 1);
      const nw = nWear.sample(u, v);
      const ns = nStain.sample(u, v);
      const st = nStreak.sample(u * 4, v * 0.5);
      const grain = rng();
      const sc = scratch.data[i];
      const m = mat[i];
      const wear = smoothstep(0.24, 0.75, convex * (0.3 + 1.4 * nw) + sc * 0.55);
      const grime = clamp(cavity * 0.85 + (ns - 0.5) * 0.8 + (st - 0.5) * 0.6 + 0.14, 0, 1);
      const bareL = (0.85 + 0.3 * grain) * (1 - 0.35 * grime);
      let r, g, b, ro, me, shade = 1;
      switch (m) {
        case M_PAINT:
        case M_ACCENT: {
          shade = tone[i] * (1 - 0.42 * grime) * (0.95 + 0.1 * grain);
          const c = m === M_PAINT ? C_PAINT : C_ACC;
          r = lerp(c[0] * shade, C_BARE[0] * bareL, wear);
          g = lerp(c[1] * shade, C_BARE[1] * bareL, wear);
          b = lerp(c[2] * shade, C_BARE[2] * bareL, wear);
          ro = 0.52 + 0.22 * grime - 0.3 * wear + (grain - 0.5) * 0.1;
          me = lerp(0.28, 0.92, wear) - 0.12 * grime;
          break;
        }
        case M_DARK: {
          shade = tone[i] * (1 - 0.3 * grime) * (0.85 + 0.3 * grain);
          const w2 = wear * 0.5;
          r = lerp(C_DARK[0] * shade, C_BARE[0] * 0.42 * bareL, w2);
          g = lerp(C_DARK[1] * shade, C_BARE[1] * 0.42 * bareL, w2);
          b = lerp(C_DARK[2] * shade, C_BARE[2] * 0.42 * bareL, w2);
          ro = 0.4 + 0.25 * grime - 0.16 * wear;
          me = 0.85;
          break;
        }
        case M_BARE: {
          const k = bareL * (0.9 + 0.2 * (1 - sc));
          r = C_STEEL[0] * k; g = C_STEEL[1] * k; b = C_STEEL[2] * k;
          ro = 0.3 + 0.3 * grime - 0.1 * sc;
          me = 0.95;
          break;
        }
        case M_GLOW:
          r = 0.9; g = 0.9; b = 0.9; ro = 0.3; me = 0.05;
          break;
        default: { // ink
          const w2 = clamp(wear * 1.4, 0, 1);
          r = lerp(C_INK[0], C_PAINT[0] * 0.85, w2);
          g = lerp(C_INK[1], C_PAINT[1] * 0.85, w2);
          b = lerp(C_INK[2], C_PAINT[2] * 0.85, w2);
          ro = 0.65; me = 0.1;
        }
      }
      const o = i * 4;
      albedo[o] = r * 255; albedo[o + 1] = g * 255; albedo[o + 2] = b * 255; albedo[o + 3] = 255;
      rough[i] = clamp(ro, 0.05, 1) * 255;
      metal[i] = clamp(me, 0, 1) * 255;
      emis[i] = em[i] * 255;
      if (m === M_ACCENT || m === M_GLOW) {
        accList.push(i);
        shadeAll[i] = shade; wearAll[i] = m === M_ACCENT ? wear : 0; bareAll[i] = bareL;
      }
    }
  }
  const accIdx = Uint32Array.from(accList);

  const grayCanvas = data => {
    const { canvas, ctx } = makeCanvas(S, S);
    const img = ctx.createImageData(S, S);
    const px = img.data;
    for (let i = 0; i < N; i++) { const o = i * 4; px[o] = px[o + 1] = px[o + 2] = data[i]; px[o + 3] = 255; }
    ctx.putImageData(img, 0, 0);
    return canvas;
  };
  const tex = (canvas, srgb) => canvasTexture(canvas, { srgb, repeat: false, anisotropy: 4 });
  const normalMap = tex(H.toNormalCanvas(2.4), false);
  const roughnessMap = tex(grayCanvas(rough), false);
  const metalnessMap = tex(grayCanvas(metal), false);
  const emissiveMap = tex(grayCanvas(emis), true);
  const white = makeCanvas(4, 4);
  white.ctx.fillStyle = '#fff';
  white.ctx.fillRect(0, 0, 4, 4);
  const whiteMap = canvasTexture(white.canvas, { srgb: true, repeat: false, anisotropy: 1 });

  // stencil scratch canvas
  const scv = makeCanvas(128, 64);

  /** Per-accent albedo texture: neutral atlas + accent-painted pixels + stencilled unit numbers. */
  const makeAlbedo = (rgb, number) => {
    const img = new ImageData(new Uint8ClampedArray(albedo), S, S);
    const d = img.data;
    for (let k = 0; k < accIdx.length; k++) {
      const i = accIdx[k], o = i * 4;
      if (mat[i] === M_GLOW) {
        d[o] = rgb[0] * 0.9 * 255; d[o + 1] = rgb[1] * 0.9 * 255; d[o + 2] = rgb[2] * 0.9 * 255;
        continue;
      }
      const w = wearAll[i], sh = shadeAll[i], bl = bareAll[i];
      d[o] = lerp(rgb[0] * sh, C_BARE[0] * bl, w) * 255;
      d[o + 1] = lerp(rgb[1] * sh, C_BARE[1] * bl, w) * 255;
      d[o + 2] = lerp(rgb[2] * sh, C_BARE[2] * bl, w) * 255;
    }
    const str = String(number).padStart(2, '0');
    for (const nr of NUMBER_RECTS) {
      const { ctx } = scv;
      ctx.clearRect(0, 0, 128, 64);
      let size = nr.font;
      ctx.font = `900 ${size}px Impact, "Arial Black", Bahnschrift, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const tw = ctx.measureText(str).width;
      if (tw > nr.w - 6) { size *= (nr.w - 6) / tw; ctx.font = `900 ${size}px Impact, "Arial Black", Bahnschrift, sans-serif`; }
      ctx.fillStyle = '#fff';
      ctx.fillText(str, nr.w / 2, nr.h / 2 + size * 0.04);
      ctx.clearRect(0, Math.floor(nr.h * 0.5) - 1, nr.w, 2); // stencil bridge
      ctx.clearRect(Math.floor(nr.w * 0.5) - 1, 0, 2, nr.h);
      const td = ctx.getImageData(0, 0, nr.w, nr.h).data;
      const [tx, ty] = TILES[nr.tile];
      for (let y = 0; y < nr.h; y++) {
        for (let x = 0; x < nr.w; x++) {
          const a = td[(y * nr.w + x) * 4 + 3] / 255;
          if (a < 0.03) continue;
          const i = (ty + nr.y + y) * S + tx + nr.x + x, o = i * 4;
          const k = a * (0.93 - 0.55 * wearAll[i]);
          d[o] = lerp(d[o], C_INK[0] * 255, k);
          d[o + 1] = lerp(d[o + 1], C_INK[1] * 255, k);
          d[o + 2] = lerp(d[o + 2], C_INK[2] * 255, k);
        }
      }
    }
    const { canvas, ctx } = makeCanvas(S, S);
    ctx.putImageData(img, 0, 0);
    return tex(canvas, true);
  };

  _atlas = { normalMap, roughnessMap, metalnessMap, emissiveMap, whiteMap, makeAlbedo, buildMs: performance.now() - t0, height: H };
  return _atlas;
}

// ====================================================================== per-colour material sets

const _sets = new Map();

/** Shared { mat, flash1, flash2 } for an accent colour (textures shared, albedo cached per colour). */
function getMaterialSet(color, number) {
  const hex = color.getHex();
  const num = number != null ? number : 1 + ((Math.imul(hex, 2654435761) >>> 0) % 98);
  const key = hex + ':' + num;
  let set = _sets.get(key);
  if (set) return set;
  const at = getAtlas();
  const rgb = hexToRgb(color);
  const map = at.makeAlbedo(rgb, num);
  const common = {
    map, normalMap: at.normalMap, roughnessMap: at.roughnessMap, metalnessMap: at.metalnessMap,
    roughness: 1, metalness: 1, envMapIntensity: 1.0,
  };
  const mat = new THREE.MeshStandardMaterial({
    ...common, emissive: color.clone(), emissiveMap: at.emissiveMap, emissiveIntensity: EMISSIVE_INTENSITY,
  });
  const hot = color.clone().lerp(new THREE.Color(0xffffff), 0.7);
  const flash1 = new THREE.MeshStandardMaterial({
    ...common, emissive: hot, emissiveMap: at.whiteMap, emissiveIntensity: 0.62,
  });
  const flash2 = new THREE.MeshStandardMaterial({
    ...common, emissive: hot, emissiveMap: at.whiteMap, emissiveIntensity: 0.24,
  });
  mat.name = 'bot_' + hex.toString(16);
  flash1.name = mat.name + '_hit1';
  flash2.name = mat.name + '_hit2';
  set = { mat, flash1, flash2, number: num };
  _sets.set(key, set);
  return set;
}

// ====================================================================== geometry builder

const fit = (tile, sub) => ({ tile, fit: true, sub: sub || null });

const _n = new THREE.Vector3();
const _ev = new THREE.Vector3();
const _eu = new THREE.Vector3();
const _upY = new THREE.Vector3(0, 1, 0);
const _upZ = new THREE.Vector3(0, 0, -1);
const _c = new THREE.Vector3();
const _e3 = new THREE.Euler();
const _q3 = new THREE.Quaternion();
const _ONE = new THREE.Vector3(1, 1, 1);

/** Ring of a chamfered rectangle (octagon), clockwise seen from above. Side 0 = front (-Z). */
const oct = (y, hx, hz, c, zc = 0, xc = 0) => ({
  y,
  pts: [
    [xc - hx + c, zc - hz], [xc + hx - c, zc - hz], [xc + hx, zc - hz + c], [xc + hx, zc + hz - c],
    [xc + hx - c, zc + hz], [xc - hx + c, zc + hz], [xc - hx, zc + hz - c], [xc - hx, zc - hz + c],
  ],
});

/** Octagon with a ridge vertex at the front centre (9 points): sides 0 and 8 are the two front faces. */
const ridged = (y, hx, hz, c, ridge, zc = 0) => ({
  y,
  pts: [
    [0, zc - hz - ridge], [hx - c, zc - hz], [hx, zc - hz + c], [hx, zc + hz - c], [hx - c, zc + hz],
    [-hx + c, zc + hz], [-hx, zc + hz - c], [-hx, zc - hz + c], [-hx + c, zc - hz],
  ],
});

class GeoBuilder {
  constructor(seed) {
    this.pos = [];
    this.nor = [];
    this.uv = [];
    this.rng = mulberry32(seed);
    this.m = new THREE.Matrix4();
    this.hasM = false;
    this.tris = 0;
  }

  begin(px, py, pz, rx = 0, ry = 0, rz = 0) {
    _q3.setFromEuler(_e3.set(rx, ry, rz, 'XYZ'));
    this.m.compose(_c.set(px, py, pz), _q3, _ONE);
    this.hasM = true;
  }

  end() { this.hasM = false; }

  _xf(p) {
    const v = new THREE.Vector3(p[0], p[1], p[2]);
    if (this.hasM) v.applyMatrix4(this.m);
    return v;
  }

  /** Add a convex planar polygon. `ref` is a point inside the solid used to orient the winding outward. */
  face(pts, spec, ref) {
    if (!spec || pts.length < 3) return;
    const V = pts.map(p => this._xf(p));
    // Newell normal
    let nx = 0, ny = 0, nz = 0;
    for (let i = 0; i < V.length; i++) {
      const a = V[i], b = V[(i + 1) % V.length];
      nx += (a.y - b.y) * (a.z + b.z);
      ny += (a.z - b.z) * (a.x + b.x);
      nz += (a.x - b.x) * (a.y + b.y);
    }
    _n.set(nx, ny, nz);
    if (_n.lengthSq() < 1e-14) return;
    _n.normalize();
    if (ref) {
      const R = this._xf(ref);
      _c.set(0, 0, 0);
      for (const v of V) _c.add(v);
      _c.multiplyScalar(1 / V.length).sub(R);
      if (_n.dot(_c) < 0) { V.reverse(); _n.negate(); }
    }
    const uvs = this._uvs(V, _n, spec);
    for (let i = 1; i < V.length - 1; i++) {
      for (const k of [0, i, i + 1]) {
        this.pos.push(V[k].x, V[k].y, V[k].z);
        this.nor.push(_n.x, _n.y, _n.z);
        this.uv.push(uvs[k * 2], uvs[k * 2 + 1]);
      }
      this.tris++;
    }
  }

  _uvs(V, n, spec) {
    const o = typeof spec === 'string' ? { tile: spec } : spec;
    const [tx, ty, tw, th] = TILES[o.tile];
    const up = Math.abs(n.y) > 0.82 ? _upZ : _upY;
    _ev.copy(up).addScaledVector(n, -up.dot(n)).normalize();
    _eu.crossVectors(_ev, n);
    const A = [], B = [];
    let amin = Infinity, amax = -Infinity, bmin = Infinity, bmax = -Infinity;
    for (const v of V) {
      const a = v.dot(_eu), b = v.dot(_ev);
      A.push(a); B.push(b);
      if (a < amin) amin = a;
      if (a > amax) amax = a;
      if (b < bmin) bmin = b;
      if (b > bmax) bmax = b;
    }
    const wa = Math.max(amax - amin, 1e-4), wb = Math.max(bmax - bmin, 1e-4);
    const m = o.margin != null ? o.margin : 3;
    const iw = tw - 2 * m, ih = th - 2 * m;
    const out = [];
    if (o.fit) {
      const sub = o.sub || [0, 0, 1, 1];
      for (let i = 0; i < V.length; i++) {
        const su = sub[0] + ((A[i] - amin) / wa) * (sub[2] - sub[0]);
        const sv = sub[1] + ((B[i] - bmin) / wb) * (sub[3] - sub[1]);
        out.push((tx + m + su * iw) / ATLAS, 1 - (ty + m + (1 - sv) * ih) / ATLAS);
      }
    } else {
      const s = Math.min(o.dens || DENSITY, iw / wa, ih / wb);
      const ox = (iw - wa * s) * this.rng(), oy = (ih - wb * s) * this.rng();
      for (let i = 0; i < V.length; i++) {
        out.push((tx + m + ox + (A[i] - amin) * s) / ATLAS, 1 - (ty + m + oy + (bmax - B[i]) * s) / ATLAS);
      }
    }
    return out;
  }

  /** Loft between rings (same point count). faceFn(seg, side) -> spec|null. */
  loft(rings, faceFn, caps = {}) {
    const n = rings[0].pts.length;
    const P = (r, i) => [r.pts[i][0], r.y, r.pts[i][1]];
    let cx = 0, cy = 0, cz = 0, cnt = 0;
    for (const r of rings) for (const p of r.pts) { cx += p[0]; cy += r.y; cz += p[1]; cnt++; }
    const center = [cx / cnt, cy / cnt, cz / cnt];
    for (let s = 0; s < rings.length - 1; s++) {
      const A = rings[s], B = rings[s + 1];
      let sx = 0, sz = 0;
      for (let i = 0; i < n; i++) { sx += A.pts[i][0] + B.pts[i][0]; sz += A.pts[i][1] + B.pts[i][1]; }
      const ref = [sx / (2 * n), (A.y + B.y) / 2, sz / (2 * n)];
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        this.face([P(A, i), P(A, j), P(B, j), P(B, i)], faceFn(s, i), ref);
      }
    }
    if (caps.bottom) this.face(rings[0].pts.map((_, i) => P(rings[0], i)), caps.bottom, center);
    if (caps.top) { const r = rings[rings.length - 1]; this.face(r.pts.map((_, i) => P(r, i)), caps.top, center); }
  }

  /** Axis-aligned box. spec: string | { front, back, left, right, top, bottom, all }. */
  box(cx, cy, cz, sx, sy, sz, spec) {
    const hx = sx / 2, hz = sz / 2;
    const pts = [[cx - hx, cz - hz], [cx + hx, cz - hz], [cx + hx, cz + hz], [cx - hx, cz + hz]];
    const S = typeof spec === 'string' ? { all: spec } : spec;
    const pick = k => (S[k] !== undefined ? S[k] : S.all);
    const side = [pick('front'), pick('right'), pick('back'), pick('left')];
    this.loft([{ y: cy - sy / 2, pts }, { y: cy + sy / 2, pts }], (s, i) => side[i], { top: pick('top'), bottom: pick('bottom') });
  }

  /** n-gon prism along y (default), x or z. */
  prism(cx, cy, cz, r, h, n, side, cap, axis = 'y') {
    const rx = axis === 'z' ? Math.PI / 2 : 0, rz = axis === 'x' ? Math.PI / 2 : 0;
    this.begin(cx, cy, cz, rx, 0, rz);
    const ring = y => ({
      y,
      pts: Array.from({ length: n }, (_, k) => {
        const a = (k + 0.5) * Math.PI * 2 / n;
        return [Math.cos(a) * r, Math.sin(a) * r];
      }),
    });
    this.loft([ring(-h / 2), ring(h / 2)], () => side, { top: cap, bottom: cap });
    this.end();
  }

  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

let _geos = null;

/** Build (once) the shared bone geometries. */
function getGeometries() {
  if (_geos) return _geos;
  const P = 'paint', D = 'dark', E = 'edge', A = 'accent';
  const geos = {};

  // ---------------------------------------------------------------- pelvis
  {
    const g = new GeoBuilder(11);
    g.loft(
      [oct(-0.115, 0.108, 0.085, 0.028), oct(-0.075, 0.165, 0.118, 0.036), oct(0.045, 0.172, 0.122, 0.036), oct(0.075, 0.142, 0.104, 0.032)],
      (s, i) => (i & 1 ? E : s === 1 ? P : D), { top: D, bottom: D });
    for (const sx of [-1, 1]) g.prism(sx * HIP_X, HIP_DY, 0, 0.060, 0.115, 6, D, D, 'x');
    g.box(0, 0.0, -0.136, 0.10, 0.09, 0.03, { front: fit('accent2'), all: A });
    g.prism(-0.19, 0.0, 0.03, 0.036, 0.10, 6, D, A, 'y');
    // flexible spine column (fills the waist gap while the torso twists / pitches)
    g.loft([oct(0.04, 0.095, 0.072, 0.03), oct(0.115, 0.105, 0.078, 0.032), oct(0.185, 0.095, 0.072, 0.03)], (s, i) => (i & 1 ? E : D), { top: D });
    geos.pelvis = g.build();
  }

  // ---------------------------------------------------------------- torso
  {
    const g = new GeoBuilder(12);
    const rings = [
      ridged(0.000, 0.140, 0.104, 0.028, 0.000), ridged(0.042, 0.146, 0.108, 0.028, 0.000),
      ridged(0.048, 0.132, 0.098, 0.024, 0.000), ridged(0.090, 0.140, 0.102, 0.026, 0.000),
      ridged(0.096, 0.128, 0.094, 0.024, 0.000), ridged(0.140, 0.144, 0.106, 0.028, 0.000),
      ridged(0.170, 0.180, 0.122, 0.038, 0.018), ridged(0.340, 0.232, 0.142, 0.050, 0.042),
      ridged(0.425, 0.220, 0.132, 0.058, 0.028), ridged(0.470, 0.118, 0.090, 0.040, 0.000),
    ];
    g.loft(rings, (s, i) => {
      if (s <= 5) return D;
      if (s === 6) {
        if (i === 0) return fit('chest', [0, 0, 0.5, 1]);
        if (i === 8) return fit('chest', [0.5, 0, 1, 1]);
        return i & 1 ? E : P;
      }
      if (s === 7) return i & 1 ? E : (i === 0 || i === 8 ? A : P);
      return D;
    }, { top: D, bottom: D });
    // gorget around the neck
    g.prism(0, 0.478, 0, 0.088, 0.05, 8, D, D, 'y');
    // pauldrons: accent shells tilted outward, number plate left, chevrons right
    for (const sx of [-1, 1]) {
      g.begin(sx * 0.295, 0.405, 0, 0, 0, -0.30 * sx);
      const outer = sx > 0 ? 2 : 6;
      const tile = sx > 0 ? 'shoulderR' : 'shoulderL';
      g.loft(
        [oct(-0.05, 0.070, 0.105, 0.028), oct(0.005, 0.082, 0.113, 0.034), oct(0.06, 0.056, 0.088, 0.028)],
        (s, i) => {
          if (i === outer) return fit(tile, s === 0 ? [0, 0, 1, 0.5] : [0, 0.5, 1, 1]);
          return i & 1 ? E : A;
        }, { top: A, bottom: D });
      g.end();
    }
    // reactor pack with rear plate, glowing core, exhaust stacks
    g.loft([oct(0.095, 0.145, 0.085, 0.025, 0.226), oct(0.415, 0.145, 0.085, 0.025, 0.226)],
      (s, i) => (i === 4 ? fit('back') : i === 0 ? null : i & 1 ? E : P), { top: D, bottom: D });
    g.prism(0, 0.27, 0.331, 0.072, 0.04, 8, D, fit('core'), 'z');
    for (const sx of [-1, 1]) g.prism(sx * 0.10, 0.50, 0.25, 0.028, 0.15, 6, D, A, 'y');
    geos.torso = g.build();
  }

  // ---------------------------------------------------------------- head
  {
    const g = new GeoBuilder(13);
    g.prism(0, -0.01, 0, 0.05, 0.08, 6, D, D, 'y');
    const rings = [
      oct(0.010, 0.068, 0.080, 0.020, 0), oct(0.050, 0.096, 0.110, 0.032, -0.002),
      oct(0.092, 0.116, 0.124, 0.040, 0), oct(0.152, 0.120, 0.128, 0.044, 0),
      oct(0.205, 0.112, 0.130, 0.050, 0.014), oct(0.250, 0.078, 0.106, 0.048, 0.026),
      oct(0.272, 0.040, 0.070, 0.030, 0.032),
    ];
    g.loft(rings, (s, i) => {
      if (i & 1) return E;
      if (s === 0 && i === 0) return D;
      if (s === 4) return A;
      return P;
    }, { top: A, bottom: D });
    // visor band: slightly proud of the shell; front + chamfers glow
    g.loft([oct(0.098, 0.124, 0.130, 0.046, -0.006), oct(0.150, 0.126, 0.134, 0.048, -0.006)], (s, i) => {
      if (i === 1) return fit('visor', [0, 0, 0.21, 1]);
      if (i === 0) return fit('visor', [0.21, 0, 0.79, 1]);
      if (i === 7) return fit('visor', [0.79, 0, 1, 1]);
      if (i === 2 || i === 6) return D;
      return null;
    });
    // brow chevron
    for (const sx of [-1, 1]) {
      g.begin(sx * 0.052, 0.166, -0.136, 0.15, -sx * 0.5, -sx * 0.16);
      g.box(0, 0, 0, 0.11, 0.016, 0.026, { all: A, bottom: D });
      g.end();
    }
    // respirator
    g.loft([oct(0.020, 0.048, 0.030, 0.014, -0.102), oct(0.074, 0.058, 0.030, 0.014, -0.106)],
      (s, i) => (i & 1 ? E : D), { top: D, bottom: D });
    // crest fin
    g.begin(0, 0.262, 0);
    g.loft([oct(0, 0.014, 0.095, 0.006, 0.03), oct(0.03, 0.009, 0.06, 0.005, 0.05)], (s, i) => (i & 1 ? E : A), { top: A, bottom: A });
    g.end();
    // ear pods
    for (const sx of [-1, 1]) {
      g.prism(sx * 0.132, 0.105, 0.010, 0.044, 0.05, 6, D, D, 'x');
      g.prism(sx * 0.158, 0.105, 0.010, 0.030, 0.012, 6, A, A, 'x');
    }
    // antenna
    g.begin(0.078, 0.235, 0.085, 0.28, 0, 0);
    g.box(0, 0.035, 0, 0.012, 0.07, 0.012, D);
    g.box(0, 0.08, 0, 0.022, 0.022, 0.022, 'glow');
    g.end();
    geos.head = g.build();
  }

  // ---------------------------------------------------------------- arms
  const armGeos = sx => {
    const ua = new GeoBuilder(sx > 0 ? 21 : 22);
    ua.prism(0, 0, 0, 0.050, 0.10, 6, D, D, 'x');
    ua.loft([oct(-0.03, 0.045, 0.050, 0.012), oct(-0.11, 0.052, 0.058, 0.014), oct(-0.20, 0.047, 0.050, 0.012),
      oct(-0.235, 0.047, 0.050, 0.012), oct(-0.285, 0.040, 0.043, 0.011)],
    (s, i) => (i & 1 ? E : s === 2 ? A : P), { top: D, bottom: D });
    ua.prism(0, -0.30, 0, 0.042, 0.09, 6, D, D, 'x');
    const fa = new GeoBuilder(sx > 0 ? 23 : 24);
    fa.loft([oct(-0.015, 0.041, 0.045, 0.011), oct(-0.09, 0.050, 0.052, 0.013), oct(-0.22, 0.045, 0.045, 0.011), oct(-0.285, 0.036, 0.036, 0.010)],
      (s, i) => (i & 1 ? E : s === 2 ? D : P), { top: D, bottom: D });
    fa.box(0, -0.045, 0.052, 0.046, 0.07, 0.035, A);
    fa.box(sx * 0.052, -0.15, 0, 0.007, 0.12, 0.014, 'glowDim');
    fa.loft([oct(-0.29, 0.036, 0.038, 0.011), oct(-0.34, 0.047, 0.050, 0.013), oct(-0.395, 0.034, 0.043, 0.011)],
      (s, i) => (i & 1 ? E : D), { top: D, bottom: D });
    fa.box(0, -0.30, -0.044, 0.056, 0.03, 0.028, P);
    return [ua.build(), fa.build()];
  };
  [geos.upperArmL, geos.foreArmL] = armGeos(-1);
  [geos.upperArmR, geos.foreArmR] = armGeos(1);

  // ---------------------------------------------------------------- legs
  const legGeos = sx => {
    const th = new GeoBuilder(sx > 0 ? 31 : 32);
    th.loft([oct(-0.03, 0.070, 0.076, 0.018), oct(-0.13, 0.080, 0.086, 0.022), oct(-0.32, 0.063, 0.070, 0.018), oct(-0.415, 0.054, 0.058, 0.015)],
      (s, i) => (i & 1 ? E : P), { top: D, bottom: D });
    th.box(0, -0.21, -0.084, 0.078, 0.16, 0.014, { front: fit('accent2'), all: A });
    th.box(sx * 0.073, -0.23, -0.005, 0.008, 0.15, 0.02, 'glowDim');
    th.prism(0, -0.43, 0, 0.048, 0.105, 6, D, D, 'x');
    const sh = new GeoBuilder(sx > 0 ? 33 : 34);
    sh.loft([oct(-0.055, 0.055, 0.060, 0.014, 0.005), oct(-0.16, 0.064, 0.080, 0.017, 0.018), oct(-0.34, 0.048, 0.057, 0.013, 0.008), oct(-0.415, 0.038, 0.042, 0.011, 0.004)],
      (s, i) => (i & 1 ? E : P), { top: D, bottom: D });
    sh.loft([oct(-0.075, 0.046, 0.043, 0.013, -0.052), oct(0.02, 0.046, 0.043, 0.013, -0.052)],
      (s, i) => (i & 1 ? E : i === 0 ? fit('accent2') : A), { top: A, bottom: A });
    sh.box(0, -0.21, -0.072, 0.064, 0.19, 0.016, P);
    sh.prism(0, -0.43, 0, 0.038, 0.09, 6, D, D, 'x');
    return [th.build(), sh.build()];
  };
  [geos.thighL, geos.shinL] = legGeos(-1);
  [geos.thighR, geos.shinR] = legGeos(1);

  // ---------------------------------------------------------------- foot (symmetric, shared)
  {
    const g = new GeoBuilder(41);
    g.loft(
      [oct(-0.085, 0.048, 0.135, 0.026, -0.07), oct(-0.055, 0.058, 0.145, 0.030, -0.07), oct(-0.035, 0.052, 0.132, 0.028, -0.07), oct(0.012, 0.046, 0.078, 0.020, -0.008)],
      (s, i) => (s < 2 ? D : i & 1 ? E : P), { top: D, bottom: D });
    g.box(0, -0.043, -0.19, 0.070, 0.03, 0.05, A);
    geos.foot = g.build();
  }

  _geos = geos;
  return geos;
}

// ====================================================================== animation helpers

const _u = new THREE.Vector3();
const _pp = new THREE.Vector3();
const _ee = new THREE.Vector3();
const _ww = new THREE.Vector3();
const _by = new THREE.Vector3();
const _bz = new THREE.Vector3();
const _bx = new THREE.Vector3();
const _zh = new THREE.Vector3();
const _bm = new THREE.Matrix4();

/** Quaternion whose local +Y is `yAxis` and whose +Z is as close as possible to `zHint`. */
function boneQuat(q, yAxis, zHint) {
  _bz.copy(zHint).addScaledVector(yAxis, -zHint.dot(yAxis));
  if (_bz.lengthSq() < 1e-8) {
    _bz.set(0, 0, 1).addScaledVector(yAxis, -yAxis.z);
    if (_bz.lengthSq() < 1e-8) _bz.set(1, 0, 0);
  }
  _bz.normalize();
  _bx.crossVectors(yAxis, _bz);
  _bm.makeBasis(_bx, yAxis, _bz);
  return q.setFromRotationMatrix(_bm);
}

/**
 * Analytic two-bone IK in the parent's space. Bones hang along local -Y; the joint (elbow / knee) bends
 * toward `pole`. Local +Z of the resulting bones points toward the pole side times zSign.
 * Writes q1 (upper, in parent space) and q2 (lower, in parent space).
 */
function solveLimb(S, T, L1, L2, pole, zSign, q1, q2) {
  _u.subVectors(T, S);
  let d = _u.length();
  const dmax = L1 + L2 - 0.003, dmin = Math.abs(L1 - L2) + 0.03;
  if (d < 1e-5) { _u.set(0, -1, 0); d = dmin; } else _u.multiplyScalar(1 / d);
  d = clamp(d, dmin, dmax);
  const a = (L1 * L1 - L2 * L2 + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(L1 * L1 - a * a, 0));
  _pp.copy(pole).addScaledVector(_u, -pole.dot(_u));
  if (_pp.lengthSq() < 1e-8) _pp.set(0, 0, 1).addScaledVector(_u, -_u.z);
  _pp.normalize();
  _ee.copy(S).addScaledVector(_u, a).addScaledVector(_pp, h);
  _ww.copy(S).addScaledVector(_u, d);
  _zh.copy(_pp).multiplyScalar(zSign);
  _by.subVectors(S, _ee).multiplyScalar(1 / L1);
  boneQuat(q1, _by, _zh);
  _by.subVectors(_ee, _ww).multiplyScalar(1 / L2);
  boneQuat(q2, _by, _zh);
}

const sm = (a, b, k, dt, first) => (first ? b : a + (b - a) * (1 - Math.exp(-k * dt)));

// scratch
const _qa = new THREE.Quaternion();
const _qb = new THREE.Quaternion();
const _qc = new THREE.Quaternion();
const _qd = new THREE.Quaternion();
const _qe = new THREE.Quaternion();
const _qh = new THREE.Quaternion();
const _qhi = new THREE.Quaternion();
const _qtr = new THREE.Quaternion();
const _qtri = new THREE.Quaternion();
const _qaim = new THREE.Quaternion();
const _qw = new THREE.Quaternion();
const _qx = new THREE.Quaternion();
const _eu2 = new THREE.Euler(0, 0, 0, 'YXZ');
const _vS = new THREE.Vector3();
const _vT = new THREE.Vector3();
const _vP = new THREE.Vector3();
const _vA = new THREE.Vector3();
const _vB = new THREE.Vector3();
const _vC = new THREE.Vector3();
const _vG = new THREE.Vector3();
const _vL = new THREE.Vector3();
const _hipsPos = new THREE.Vector3();
const _foot = [new THREE.Vector3(), new THREE.Vector3()];

const OFF_AIM = new THREE.Vector3(0.09, 0.13, -0.22);
const OFF_READY = new THREE.Vector3(0.11, -0.09, -0.19);
const OFF_CARRY = new THREE.Vector3(0.23, -0.27, -0.12);
const OFF_RELOAD = new THREE.Vector3(0.11, -0.15, -0.17);
const POLE_R_AIM = new THREE.Vector3(0.55, -1, 0.4);
const POLE_R_CARRY = new THREE.Vector3(0.4, -0.5, 1);
const POLE_L_AIM = new THREE.Vector3(-0.55, -1, 0.3);
const POLE_L_FREE = new THREE.Vector3(-0.3, -0.3, 1);
const DEFAULT_STATE = { forwardSpeed: 0, strafeSpeed: 0, speed: 0, onGround: true, crouch: 0, aimPitch: 0, aimYawOffset: 0, firing: false, reloading: false, alive: true };
const FLASH_TIME = 0.16;
let _instances = 1;

// centred copies of the bone geometries for death gibs (so they tumble about their own centre)
const _gibGeos = new Map();
function gibGeometry(src) {
  let e = _gibGeos.get(src);
  if (!e) {
    if (!src.boundingBox) src.computeBoundingBox();
    const center = src.boundingBox.getCenter(new THREE.Vector3());
    const geo = src.clone().translate(-center.x, -center.y, -center.z);
    geo.computeBoundingSphere();
    e = { geo, center };
    _gibGeos.set(src, e);
  }
  return e;
}

// ====================================================================== BotModel

/**
 * Procedural robot model. Add `root` to the scene, position it at the bot's feet, rotate root.rotation.y to the body
 * yaw and call update(dt, state) every frame.
 */
export class BotModel {
  /**
   * @param {{color?: number|string|THREE.Color, team?: number, number?: number, phase?: number}} [opts] accent colour
   *   (visor, plates, lights), team id, optional unit number (defaults to a number derived from the colour) and optional
   *   gait / idle phase offset 0..1 (defaults to a per-instance value so a group of bots never moves in lockstep)
   */
  constructor({ color = 0xff4a3d, team = 0, number = null, phase = null } = {}) {
    this.color = new THREE.Color(color);
    this.team = team;
    const set = getMaterialSet(this.color, number);
    const geo = getGeometries();
    this._set = set;
    this._matLevel = 0;

    /** Group at the feet centre, facing -Z. */
    this.root = new THREE.Group();
    this.root.name = 'BotModel';

    const mk = (g, name) => {
      const m = new THREE.Mesh(g, set.mat);
      m.name = name;
      m.castShadow = true;
      m.receiveShadow = true;
      return m;
    };
    const hips = this.hips = mk(geo.pelvis, 'pelvis');
    const torso = this.torso = mk(geo.torso, 'torso');
    const head = this.head = mk(geo.head, 'head');
    this.armU = [mk(geo.upperArmL, 'upperArmL'), mk(geo.upperArmR, 'upperArmR')];
    this.armL = [mk(geo.foreArmL, 'foreArmL'), mk(geo.foreArmR, 'foreArmR')];
    this.legU = [mk(geo.thighL, 'thighL'), mk(geo.thighR, 'thighR')];
    this.legL = [mk(geo.shinL, 'shinL'), mk(geo.shinR, 'shinR')];
    this.feet = [mk(geo.foot, 'footL'), mk(geo.foot, 'footR')];
    this._meshes = [hips, torso, head, ...this.armU, ...this.armL, ...this.legU, ...this.legL, ...this.feet];

    this.root.add(hips);
    hips.position.set(0, HIP_Y, 0);
    hips.add(torso);
    torso.position.set(0, WAIST_DY, 0);
    torso.add(head);
    head.position.set(0, NECK_Y, 0);
    for (let i = 0; i < 2; i++) {
      const sx = i === 0 ? -1 : 1;
      torso.add(this.armU[i]);
      this.armU[i].position.set(sx * SHOULDER_X, SHOULDER_Y, 0);
      this.armU[i].add(this.armL[i]);
      this.armL[i].position.set(0, -ARM_U, 0);
      hips.add(this.legU[i]);
      this.legU[i].position.set(sx * HIP_X, HIP_DY, 0);
      this.legU[i].add(this.legL[i]);
      this.legL[i].position.set(0, -THIGH, 0);
      this.legL[i].add(this.feet[i]);
      this.feet[i].position.set(0, -SHIN, 0);
    }

    /** Object3D at eye height (root space). */
    this.eye = new THREE.Object3D();
    this.eye.name = 'eye';
    this.eye.position.set(0, 1.66, -0.06);
    this.root.add(this.eye);

    /** Weapon attachment (grip point in the right hand, -Z along the aim). Driven every update(). */
    this.weaponSocket = new THREE.Object3D();
    this.weaponSocket.name = 'weaponSocket';
    torso.add(this.weaponSocket);
    this.weaponSocket.position.set(0.1, PIVOT_Y + 0.05, -0.23);

    /** The held weapon model ({root, muzzle, ...}) or null. */
    this.weapon = null;
    /** True while a BotShadowCaster draws this model's shadow (the meshes themselves then cast none). */
    this._shadowBatched = false;
    /** The held weapon's shadow-casting mesh (its biggest opaque mesh) or null. */
    this._shadowWeapon = null;
    this._leftOff = new THREE.Vector3(0, -0.035, -0.22);
    this._wLen = 0.6;

    // animation state
    this._ready = false;
    const ph = phase != null ? phase : ((_instances++ * 0.61803398875) % 1);
    this._time = ph * 9.7;
    this._phase = ph;
    this._k = {
      fwd: 0, str: 0, spd: 0, air: 0, crouch: 0, aim: 0, reload: 0, carry: 0, gait: 0, dead: 0, run: 0,
    };
    this._aimHold = 0;
    this._wasFiring = false;
    this._kickCd = 0;
    this._rec = 0;
    this._reloadT = 0;
    this._wasGround = true;
    this._airT = 0;
    this._land = 0;
    this._flash = 0;
    this._flinch = 0;
    this._flinchSide = 1;

    this.update(0, DEFAULT_STATE);
  }

  /** Force the next update() to snap every blend to its target (e.g. after a teleport / respawn). */
  reset() {
    this._ready = false;
    this._flash = 0;
    this._flinch = 0;
    this._rec = 0;
    this._aimHold = 0;
    this._reloadT = 0;
    this._land = 0;
    this._applyMaterial(0);
  }

  /**
   * Put a weapon model (createWeaponModel(id, {view:false})) into the right hand; replaces the previous one.
   * @param {{root: THREE.Object3D, muzzle?: THREE.Object3D}|null} weaponModel
   */
  setWeapon(weaponModel) {
    if (this.weapon && this.weapon.root && this.weapon.root.parent === this.weaponSocket) this.weaponSocket.remove(this.weapon.root);
    this.weapon = weaponModel || null;
    this._shadowWeapon = null;
    if (!weaponModel || !weaponModel.root) { this.weapon = null; this._wLen = 0.5; this._leftOff.set(0, -0.035, -0.2); return; }
    const r = weaponModel.root;
    r.position.set(0, 0, 0);
    r.rotation.set(0, 0, 0);
    this.weaponSocket.add(r);
    // only the biggest opaque mesh casts a shadow: the rest would each cost another draw call in the shadow pass
    // (inside a match the BotShadowCaster draws it instanced instead; see shadowBatched)
    const big = weaponShadowMesh(r);
    r.traverse(o => {
      if (!o.isMesh) return;
      o.castShadow = false;
      o.receiveShadow = true;
    });
    this._shadowWeapon = big;
    if (big) big.castShadow = !this._shadowBatched;
    let len = 0.6;
    if (weaponModel.muzzle) {
      r.updateWorldMatrix(true, true);
      weaponModel.muzzle.getWorldPosition(_vA);
      r.worldToLocal(_vA);
      len = clamp(-_vA.z, 0.12, 1.6);
    }
    this._wLen = len;
    const lz = clamp(len * 0.42, 0.04, 0.26);
    this._leftOff.set(len < 0.34 ? -0.012 : 0, len < 0.34 ? -0.05 : -0.035, -lz);
  }

  /**
   * World position of the held weapon's muzzle (fallback: in front of the chest).
   * @param {THREE.Vector3} out
   * @returns {THREE.Vector3}
   */
  getMuzzleWorldPosition(out) {
    if (this.weapon && this.weapon.muzzle) {
      this.weapon.muzzle.updateWorldMatrix(true, false);
      return this.weapon.muzzle.getWorldPosition(out);
    }
    this.weaponSocket.updateWorldMatrix(true, false);
    return this.weaponSocket.localToWorld(out.set(0, 0, -0.4));
  }

  /** Brief bright emissive flash + a small flinch (call when damaged). */
  flashHit() {
    this._flash = FLASH_TIME;
    this._flinch = 1;
    this._flinchSide = -this._flinchSide;
    this._applyMaterial(2);
  }

  /** @param {boolean} visible */
  setVisible(visible) { this.root.visible = !!visible; }

  _applyMaterial(level) {
    if (level === this._matLevel) return;
    this._matLevel = level;
    const m = level === 2 ? this._set.flash1 : level === 1 ? this._set.flash2 : this._set.mat;
    for (const mesh of this._meshes) mesh.material = m;
  }

  /**
   * World-transformed meshes for the body pieces (death gibs; not parented). Material is the shared bot material;
   * geometry is a shared, centre-pivoted copy of the bone geometry (cached, never disposed), so gibs tumble about their
   * own centre. Head, torso, pelvis, 4 arm pieces, 4 leg pieces and the biggest weapon part.
   * @returns {THREE.Mesh[]}
   */
  breakApart() {
    this.root.updateWorldMatrix(true, true);
    const out = [];
    const clone = src => {
      const e = gibGeometry(src.geometry);
      const c = new THREE.Mesh(e.geo, this._set.mat);
      src.matrixWorld.decompose(c.position, c.quaternion, c.scale);
      c.position.copy(e.center).applyMatrix4(src.matrixWorld);
      c.castShadow = false;   // ~12 short-lived pieces per death: not worth a shadow draw call each
      c.receiveShadow = true;
      c.name = 'gib_' + src.name;
      out.push(c);
    };
    for (const m of [this.head, this.torso, this.hips, ...this.armU, ...this.armL, ...this.legU, ...this.legL]) clone(m);
    if (this.weapon && this.weapon.root) {
      let best = null, bestN = -1;
      this.weapon.root.traverse(o => {
        if (!o.isMesh || !o.geometry) return;
        const n = o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count;
        if (n > bestN) { bestN = n; best = o; }
      });
      if (best) {
        const c = new THREE.Mesh(best.geometry, best.material);
        best.updateWorldMatrix(true, false);
        best.matrixWorld.decompose(c.position, c.quaternion, c.scale);
        c.castShadow = false;
        c.name = 'gib_weapon';
        out.push(c);
      }
    }
    return out;
  }

  /** Detach children; shared geometry / materials / textures are never disposed. */
  dispose() {
    if (this.weapon && this.weapon.root && this.weapon.root.parent === this.weaponSocket) this.weaponSocket.remove(this.weapon.root);
    this.weapon = null;
    if (this.root.parent) this.root.parent.remove(this.root);
    this.root.clear();
  }

  /**
   * Advance the procedural animation.
   * @param {number} dt seconds
   * @param {{forwardSpeed:number, strafeSpeed:number, speed:number, onGround:boolean, crouch:number, aimPitch:number,
   *   aimYawOffset:number, firing:boolean, reloading:boolean, alive:boolean, aiming?:boolean}} state
   *   forward/strafe speeds are relative to root's facing; aimYawOffset = aim yaw minus body yaw (CCW positive);
   *   `aiming` is optional (default: raise the weapon to the shoulder while `firing` and for ~1.4 s afterwards).
   */
  update(dt, state) {
    const s = state || DEFAULT_STATE;
    if (!(dt > 0)) dt = 0;
    if (dt > 0.1) dt = 0.1;
    const first = !this._ready;
    this._ready = true;
    const K = this._k;
    this._time += dt;
    const time = this._time;

    // ------------------------------------------------------------ inputs
    let fwd = +s.forwardSpeed || 0;
    const str = +s.strafeSpeed || 0;
    const spd = s.speed !== undefined ? (+s.speed || 0) : Math.hypot(fwd, str);
    if (Math.hypot(fwd, str) < 0.05 && spd > 0.2) fwd = spd;
    const alive = s.alive !== false;
    const onGround = s.onGround !== false;
    const yawOff = clamp(+s.aimYawOffset || 0, -2.2, 2.2);
    const pitchIn = clamp(+s.aimPitch || 0, -1.3, 1.3);
    const firing = !!s.firing;

    K.fwd = sm(K.fwd, fwd, 10, dt, first);
    K.str = sm(K.str, str, 10, dt, first);
    K.spd = Math.hypot(K.fwd, K.str);
    K.crouch = sm(K.crouch, alive ? clamp(+s.crouch || 0, 0, 1) : 0, 13, dt, first);
    K.dead = sm(K.dead, alive ? 0 : 1, 7, dt, first);

    // airborne (ignore tiny hops / stair steps)
    if (onGround && !this._wasGround && !first) this._land = Math.min(0.16, 0.04 + this._airT * 0.09);
    this._airT = onGround ? 0 : this._airT + dt;
    this._wasGround = onGround;
    this._land *= Math.exp(-8 * dt);
    const airWant = !onGround && this._airT > 0.1 ? 1 : 0;
    K.air = sm(K.air, airWant, airWant ? 16 : 11, dt, first);

    // weapon readiness: aim (shoulder) when firing, else ready / sprint carry
    let wantAim;
    if (s.aiming !== undefined) wantAim = s.aiming ? 1 : 0;
    else {
      if (firing) this._aimHold = 1.4; else this._aimHold = Math.max(0, this._aimHold - dt);
      wantAim = this._aimHold > 0 ? 1 : 0;
    }
    if (!alive || s.reloading) wantAim = 0;
    K.aim = sm(K.aim, wantAim, wantAim > K.aim ? 22 : 7, dt, first);
    K.reload = sm(K.reload, s.reloading && alive ? 1 : 0, 10, dt, first);
    if (s.reloading) this._reloadT += dt; else this._reloadT = 0;
    K.carry = sm(K.carry, smoothstep(4.5, 6.5, K.fwd), 8, dt, first);

    // recoil kicks (rising edge + repeat while held)
    if (firing && !this._wasFiring) { this._kick(); } else if (firing) {
      this._kickCd -= dt;
      if (this._kickCd <= 0) this._kick();
    }
    this._wasFiring = firing;
    this._rec *= Math.exp(-15 * dt);
    this._flinch *= Math.exp(-9 * dt);
    if (this._flash > 0) this._flash = Math.max(0, this._flash - dt);
    this._applyMaterial(this._flash > 0.09 ? 2 : this._flash > 0 ? 1 : 0);

    const A = K.aim, crouch = K.crouch, dead = K.dead, air = K.air, rel = K.reload;
    const run = K.run = smoothstep(2.5, 6.5, K.spd);
    const gait = K.gait = sm(K.gait, smoothstep(0.15, 1.3, K.spd), 9, dt, first);
    const cad = Math.min(1.0 + 0.18 * K.spd, 2.3) * (1 - 0.2 * crouch);
    if (K.spd > 0.12) this._phase = (this._phase + dt * cad) % 1;
    const phase = this._phase;
    const sinP = Math.sin(phase * Math.PI * 2), cosP = Math.cos(phase * Math.PI * 2);

    // direction of travel in root space
    const sp2 = Math.hypot(K.fwd, K.str);
    let dx = 0, dz = -1;
    if (sp2 > 0.05) { dx = K.str / sp2; dz = -K.fwd / sp2; }
    const stance = lerp(0.6, 0.3, run);
    const ex = clamp(0.5 * stance * K.spd / cad, 0, 0.5) * (1 - 0.4 * crouch);
    const lift = (0.05 + 0.02 * Math.min(K.spd, 8)) * (1 - 0.5 * crouch);
    const leanF = clamp(K.fwd / 9, -0.6, 1);

    // ------------------------------------------------------------ hips
    const crouchE = Math.max(crouch, dead * 0.9);
    const bobAmp = (0.010 + 0.030 * run) * gait;
    const bob = -bobAmp * Math.cos(4 * Math.PI * (phase - stance * 0.5));
    const breath = Math.sin(time * 1.9);
    let hipY = lerp(HIP_Y, CROUCH_HIPS, crouchE) - 0.12 * run * gait - this._land + bob + 0.004 * breath * (1 - gait);
    hipY -= 0.06 * air;
    const hipX = 0.022 * sinP * gait + 0.006 * Math.sin(time * 0.6) * (1 - gait);
    const hipZ = 0.20 * crouchE + 0.02 * A - 0.02 * leanF;
    _hipsPos.set(hipX, hipY, hipZ);
    const pelvisYaw = clamp(0.2 * yawOff, -0.4, 0.4) + 0.16 * A + 0.10 * sinP * gait * (1 - 0.5 * A);
    const hipsRoll = -0.025 * sinP * gait - 0.05 * clamp(K.str / 6, -1, 1);
    const hipsPitch = 0.5 * 0.16 * leanF;
    this.hips.position.copy(_hipsPos);
    _qh.setFromEuler(_eu2.set(hipsPitch * -1, pelvisYaw, hipsRoll));
    this.hips.quaternion.copy(_qh);
    _qhi.copy(_qh).conjugate();

    // ------------------------------------------------------------ legs (IK to gait foot targets)
    const standX = 0.13 + 0.03 * A + 0.05 * crouchE;
    for (let i = 0; i < 2; i++) {
      const sx = i === 0 ? -1 : 1;
      const ph = (phase + i * 0.5) % 1;
      let p, h, pitch;
      if (ph < stance) {
        const u = ph / stance;
        p = 1 - 2 * u; h = 0;
        pitch = lerp(0.28, -0.45, u * u);
      } else {
        const u = (ph - stance) / (1 - stance);
        const e = u * u * (3 - 2 * u);
        p = -1 + 2 * e; h = Math.sin(Math.PI * u);
        pitch = lerp(-0.45, 0.30, smoothstep(0, 0.75, u));
      }
      const gx = sx * standX + dx * 0.6 * ex * p;
      const gz = dz * ex * p;
      const gy = ANKLE + lift * h;
      const stx = sx * standX;
      const stz = (i === 0 ? -0.13 : 0.09) * A - 0.08 * crouchE;
      let fx = lerp(stx, gx, gait), fz = lerp(stz, gz + stz * 0.3, gait), fy = lerp(ANKLE, gy, gait);
      const fp0 = pitch * gait * (0.6 + 0.4 * run);
      let fp = fp0;
      // roll over the heel / ball of the foot without sinking into the ground
      fy += 0.16 * Math.sin(Math.max(0, -fp0)) + 0.07 * Math.sin(Math.max(0, fp0));
      if (air > 0.001) {
        const wob = Math.sin(this._airT * 5 + i * Math.PI);
        const ax = sx * 0.12, ay = ANKLE + (i === 0 ? 0.31 : 0.21) + 0.03 * wob, az = (i === 0 ? -0.20 : 0.10) + 0.05 * wob;
        fx = lerp(fx, ax, air); fy = lerp(fy, ay, air); fz = lerp(fz, az, air);
        fp = lerp(fp, -0.35, air);
      }
      // to hips space
      _vT.set(fx, fy, fz).sub(_hipsPos).applyQuaternion(_qhi);
      _vS.set(sx * HIP_X, HIP_DY, 0);
      _vP.set(sx * 0.06, 0, -1);
      solveLimb(_vS, _vT, THIGH, SHIN, _vP, -1, _qa, _qb);
      this.legU[i].quaternion.copy(_qa);
      this.legL[i].quaternion.copy(_qc.copy(_qa).conjugate().multiply(_qb));
      // foot: flat in root space with heel-toe roll
      _qd.setFromEuler(_eu2.set(fp, -sx * 0.12, 0));
      _qe.copy(_qhi).multiply(_qd);
      this.feet[i].quaternion.copy(_qc.copy(_qb).conjugate().multiply(_qe));
      _foot[i].set(fx, fy, fz);
    }

    // ------------------------------------------------------------ torso
    const flinch = this._flinch;
    const rec = this._rec;
    let tPitch = -0.16 * leanF * 0.5 - 0.45 * crouchE + 0.012 * breath * (1 - gait) + 0.045 * rec + 0.3 * pitchIn * (0.4 + 0.6 * A)
      + 0.10 * flinch - 0.85 * dead - 0.05 * rel;
    tPitch = clamp(tPitch, -1.4, 0.7);
    const tYaw = clamp(0.5 * yawOff, -0.9, 0.9) + 0.22 * A - 0.12 * sinP * gait * (1 - 0.7 * A);
    const tRoll = -0.05 * clamp(K.str / 6, -1, 1) + 0.04 * sinP * gait + 0.06 * flinch * this._flinchSide + 0.02 * Math.sin(time * 0.7) * (1 - gait);
    _qa.setFromEuler(_eu2.set(tPitch, tYaw, tRoll));
    this.torso.quaternion.copy(_qa);
    _qtr.copy(_qh).multiply(_qa);        // torso rotation in root space
    _qtri.copy(_qtr).conjugate();
    // chest breathing
    this.torso.position.y = WAIST_DY + 0.004 * breath * (1 - gait);

    // ------------------------------------------------------------ aim frame + weapon
    const carry = K.carry * (1 - A);
    const ready = (1 - A) * (1 - K.carry);
    const wRel = rel;
    // aim direction in root space
    _qaim.setFromEuler(_eu2.set(pitchIn, yawOff, 0));
    // offset in aim frame, blended between poses
    _vA.set(0, 0, 0)
      .addScaledVector(OFF_AIM, A)
      .addScaledVector(OFF_READY, ready)
      .addScaledVector(OFF_CARRY, carry);
    _vA.lerp(OFF_RELOAD, wRel);
    // breathing / gait sway on the weapon
    _vA.x += 0.004 * Math.sin(time * 1.7) * (1 - gait);
    _vA.y += 0.005 * Math.sin(time * 1.3 + 1) * (1 - gait) + 0.018 * Math.sin(4 * Math.PI * phase) * gait * (1 - A * 0.7);
    // recoil (aim frame: back and up)
    _vA.z += 0.055 * rec;
    _vA.y += 0.008 * rec;
    _vG.copy(_vA).applyQuaternion(_qaim).applyQuaternion(_qtri);
    _vG.y += PIVOT_Y;
    // weapon orientation: aim frame + pose offsets
    const reloadTau = (this._reloadT % 1.15) / 1.15;
    const reloadDip = wRel * (0.25 + 0.06 * Math.sin(reloadTau * Math.PI * 2));
    const pitchOff = -0.10 * ready - 0.35 * carry - reloadDip + 0.055 * rec;
    const rollOff = 0.32 * wRel + 0.03 * Math.sin(time * 1.4) * (1 - gait);
    _qw.setFromEuler(_eu2.set(pitchOff, 0, rollOff));
    _qx.copy(_qaim).multiply(_qw);
    _qx.premultiply(_qtri);
    if (dead > 0.001) {
      // drop the weapon toward the right hand hanging low
      _vL.set(SHOULDER_X + 0.05, SHOULDER_Y - 0.62, 0.05);
      _vG.lerp(_vL, dead);
      _qw.setFromEuler(_eu2.set(-1.2, 0, 0.2));
      _qx.slerp(_qw, dead);
    }
    this.weaponSocket.position.copy(_vG);
    this.weaponSocket.quaternion.copy(_qx);

    // ------------------------------------------------------------ arms (IK to the weapon)
    // right hand on the grip
    _vT.copy(_vG);
    _vS.set(SHOULDER_X, SHOULDER_Y, 0);
    _vP.copy(POLE_R_AIM).lerp(POLE_R_CARRY, carry);
    solveLimb(_vS, _vT, ARM_U, ARM_L, _vP, 1, _qa, _qb);
    this.armU[1].quaternion.copy(_qa);
    this.armL[1].quaternion.copy(_qc.copy(_qa).conjugate().multiply(_qb));

    // left hand: support point / reload hand / free swing
    _vB.copy(this._leftOff);
    if (wRel > 0.001) {
      // mag hand path in weapon space over the reload timeline
      const tau = reloadTau;
      let hx = 0, hy = -0.11, hz = -0.08;
      if (tau < 0.2) { const k = smoothstep(0, 0.2, tau); hx = lerp(this._leftOff.x, 0, k); hy = lerp(this._leftOff.y, -0.11, k); hz = lerp(this._leftOff.z, -0.08, k); }
      else if (tau < 0.42) { const k = smoothstep(0.2, 0.42, tau); hx = lerp(0, 0.03, k); hy = lerp(-0.11, -0.27, k); hz = lerp(-0.08, -0.05, k); }
      else if (tau < 0.6) { const k = smoothstep(0.42, 0.6, tau); hx = lerp(0.03, -0.05, k); hy = lerp(-0.27, -0.30, k); hz = lerp(-0.05, 0.0, k); }
      else if (tau < 0.8) { const k = smoothstep(0.6, 0.8, tau); hx = lerp(-0.05, 0, k); hy = lerp(-0.30, -0.10, k); hz = lerp(0.0, -0.08, k); }
      else { const k = smoothstep(0.8, 1, tau); hx = lerp(0, this._leftOff.x, k); hy = lerp(-0.10, this._leftOff.y, k); hz = lerp(-0.08, this._leftOff.z, k); }
      _vB.lerp(_vC.set(hx, hy, hz), wRel);
    }
    _vT.copy(_vB).applyQuaternion(_qx).add(_vG);
    const freeW = carry * (1 - wRel);
    if (freeW > 0.001) {
      const swing = -(0.35 + 0.35 * run) * cosP * gait - 0.1;
      _vL.set(-SHOULDER_X - 0.03, SHOULDER_Y - 0.5 * Math.cos(swing), -0.5 * Math.sin(swing) - 0.10);
      _vT.lerp(_vL, freeW);
    }
    if (dead > 0.001) { _vL.set(-SHOULDER_X - 0.05, SHOULDER_Y - 0.6, 0.06); _vT.lerp(_vL, dead); }
    _vS.set(-SHOULDER_X, SHOULDER_Y, 0);
    _vP.copy(POLE_L_AIM).lerp(POLE_L_FREE, freeW);
    solveLimb(_vS, _vT, ARM_U, ARM_L, _vP, 1, _qa, _qb);
    this.armU[0].quaternion.copy(_qa);
    this.armL[0].quaternion.copy(_qc.copy(_qa).conjugate().multiply(_qb));

    // ------------------------------------------------------------ head: follows the aim, stabilised against body motion
    const headPitch = clamp(pitchIn * 0.9, -0.75, 0.75) - 0.22 * rel * (1 - 0.5 * A) - 0.04 * rec + 0.10 * flinch - 0.5 * dead;
    _qa.setFromEuler(_eu2.set(headPitch + 0.02 * Math.sin(time * 1.1), yawOff + 0.05 * Math.sin(time * 0.7) * (1 - A) * (1 - gait), 0.03 * Math.sin(time * 0.9) * (1 - gait)));
    this.head.quaternion.copy(_qtri).multiply(_qa);

    // ------------------------------------------------------------ eye + misc
    this.eye.position.set(0, lerp(1.66, 1.03, crouchE) - this._land * 0.4, lerp(-0.06, -0.16, crouchE));
  }

  _kick() {
    this._rec = Math.min(1.25, this._rec + 0.8);
    this._kickCd = 0.095;
  }

  /**
   * Meshes for Game.warmup to draw once while loading (never kept in a scene): one per hit-flash material of this
   * model's colour set (they are only swapped in when the bot is hit) and, with `gibs`, a set of death gibs (builds
   * the shared centred gib geometries now instead of at the first kill).
   * @param {boolean} [gibs=false]
   * @returns {THREE.Mesh[]}
   */
  prewarmMeshes(gibs = false) {
    const g = this.torso.geometry;
    const out = [new THREE.Mesh(g, this._set.flash1), new THREE.Mesh(g, this._set.flash2)];
    if (gibs) out.push(...this.breakApart());
    return out;
  }
}

// ====================================================================== batched shadows

const SHADOW_SLOT_CAP = 32;
const _updateMatrixWorld = THREE.Object3D.prototype.updateMatrixWorld;
let _shadowMat = null;

/** The mesh of a held weapon model that casts its shadow: its biggest opaque mesh (null when it has none). */
function weaponShadowMesh(root) {
  let big = null, bigN = -1;
  root.traverse(o => {
    if (!o.isMesh || (o.material && o.material.transparent)) return;
    const n = o.geometry && o.geometry.attributes.position ? o.geometry.attributes.position.count : 0;
    if (n > bigN) { bigN = n; big = o; }
  });
  return big;
}

/**
 * Bot shadows for a whole match in about a dozen draw calls. Every body-part geometry (and every held-weapon
 * geometry) gets one shadow-only InstancedMesh whose instances copy the world matrices of that part on every bot, so
 * the shadow map draws 12 + (weapon kinds in use) meshes instead of 13 parts + a gun per bot, with exactly the same
 * silhouettes and animation. Models added here stop casting shadows themselves; a standalone BotModel (the asset
 * viewer) keeps casting its own.
 *
 * Add `root` to the scene AFTER the bot models: its matrix update copies the parts' world matrices, which the scene
 * graph update has refreshed by then (a model added later lags one frame, nothing worse).
 */
export class BotShadowCaster {
  /** @param {{renderer?: THREE.WebGLRenderer}} [opts] renderer: the copy is skipped while its shadow map is off */
  constructor({ renderer = null } = {}) {
    this.renderer = renderer;
    this.root = new THREE.Group();
    this.root.name = 'bot-shadows';
    this.root.matrixAutoUpdate = false;
    this._entries = [];            // { model, slots: slot per body mesh }
    this._slots = [];              // { mesh: InstancedMesh, n, cap }
    this._slotByGeo = new Map();   // source geometry -> slot
    const self = this;
    this.root.updateMatrixWorld = function (force) {
      self._sync();
      _updateMatrixWorld.call(this, force);
    };
  }

  /** Draw this model's shadow from the batch (its own meshes stop casting). @param {BotModel} model */
  add(model) {
    if (!model || model._shadowBatched) return;
    model._shadowBatched = true;
    for (const m of model._meshes) m.castShadow = false;
    if (model._shadowWeapon) model._shadowWeapon.castShadow = false;
    this._entries.push({ model, slots: model._meshes.map(m => this._slot(m.geometry)) });
  }

  /** Stop batching a model (its meshes cast their own shadows again). @param {BotModel} model */
  remove(model) {
    const i = this._entries.findIndex(e => e.model === model);
    if (i < 0) return;
    this._entries.splice(i, 1);
    model._shadowBatched = false;
    for (const m of model._meshes) m.castShadow = true;
    if (model._shadowWeapon) model._shadowWeapon.castShadow = true;
  }

  /** Forget every model (match end); the instanced meshes stay for the next match. */
  clear() {
    for (const e of this._entries.slice()) this.remove(e.model);
    for (const s of this._slots) { s.n = 0; s.mesh.count = 0; s.mesh.visible = false; }
  }

  /**
   * Make sure a (weapon) geometry has its instanced shadow mesh before play, so none is created mid-match.
   * @param {THREE.Object3D} weaponRoot a createWeaponModel(...).root
   */
  prepareWeapon(weaponRoot) {
    const m = weaponRoot && weaponShadowMesh(weaponRoot);
    if (m) this._slot(m.geometry);
  }

  _slot(geometry) {
    let s = this._slotByGeo.get(geometry);
    if (!s) {
      s = { mesh: null, n: 0, cap: 0, geometry: null };
      // position (+ index) only, sharing the source buffers: every slot uses the same depth program
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', geometry.getAttribute('position'));
      if (geometry.index) g.setIndex(geometry.index);
      s.geometry = g;
      this._grow(s, SHADOW_SLOT_CAP);
      this._slotByGeo.set(geometry, s);
      this._slots.push(s);
    }
    return s;
  }

  _grow(s, cap) {
    if (!_shadowMat) {
      // never drawn in the colour pass (see isLOD below); no colour / depth writes in case a future three.js does
      _shadowMat = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false });
      _shadowMat.name = 'bot_shadow_proxy';
    }
    const mesh = new THREE.InstancedMesh(s.geometry, _shadowMat, cap);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.name = 'bot-shadow';
    mesh.castShadow = true;
    mesh.receiveShadow = false;
    mesh.frustumCulled = false;
    mesh.matrixAutoUpdate = false;
    // three.js r169: WebGLRenderer.projectObject() checks isLOD before isMesh and never draws an LOD object itself,
    // while WebGLShadowMap.renderObject() only checks isMesh - so this mesh is drawn into the shadow map only.
    mesh.isLOD = true;
    mesh.autoUpdate = false;
    mesh.count = 0;
    mesh.visible = false;
    if (s.mesh) {
      mesh.instanceMatrix.array.set(s.mesh.instanceMatrix.array.subarray(0, Math.min(s.cap, cap) * 16));
      this.root.remove(s.mesh);
      s.mesh.dispose();
    }
    this.root.add(mesh);
    s.mesh = mesh;
    s.cap = cap;
  }

  _push(s, matrix) {
    if (s.n >= s.cap) this._grow(s, s.cap * 2);
    matrix.toArray(s.mesh.instanceMatrix.array, s.n * 16);
    s.n++;
  }

  /** Copy this frame's part matrices into the instances (runs inside the scene's matrix update). */
  _sync() {
    const slots = this._slots;
    for (let i = 0; i < slots.length; i++) slots[i].n = 0;
    const on = !this.renderer || this.renderer.shadowMap.enabled;
    if (on) {
      const entries = this._entries;
      for (let i = 0; i < entries.length; i++) {
        const e = entries[i];
        const model = e.model;
        if (!model.root.visible || !model.root.parent) continue;
        const meshes = model._meshes;
        for (let k = 0; k < meshes.length; k++) this._push(e.slots[k], meshes[k].matrixWorld);
        const w = model._shadowWeapon;
        if (w && model.weapon && model.weapon.root.visible && w.visible && w.parent) this._push(this._slot(w.geometry), w.matrixWorld);
      }
    }
    for (let i = 0; i < slots.length; i++) {
      const s = slots[i];
      const mesh = s.mesh;
      mesh.count = s.n;
      mesh.visible = s.n > 0;
      if (s.n > 0) {
        const im = mesh.instanceMatrix;
        im.clearUpdateRanges();
        im.addUpdateRange(0, s.n * 16);
        im.needsUpdate = true;
      }
    }
  }
}

/** Build the shared texture atlas + geometry ahead of time (optional; avoids a hitch on the first spawn). */
export function warmup(color = 0xffffff) {
  getGeometries();
  getMaterialSet(new THREE.Color(color));
  return _atlas ? _atlas.buildMs : 0;
}

/** Debug helper for tools: atlas build time and the shared normal/roughness/metalness/emissive textures. */
export function debugAtlas() {
  const at = getAtlas();
  return { buildMs: at.buildMs, normalMap: at.normalMap, roughnessMap: at.roughnessMap, metalnessMap: at.metalnessMap, emissiveMap: at.emissiveMap, sets: _sets };
}
