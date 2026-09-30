// "Skyline": a cluster of rooftops in a neon-lit city at dusk.
//
//   x: west(-) .. east(+)   z: north(-) .. south(+)   y: up.   Arena is 88 x 88 m inside a 6 m ring alley.
//
//   Street level (y 0)   central plaza with a fountain and the 22 m Spire (giant neon billboard crown), a # of 8 m
//                        streets around eight 20 x 20 m buildings, and a 6 m ring alley along the perimeter walls.
//   Rooftops             low 6.4 (N, S) . mid 9.6 (NE, E, SW) . high 12.8 (W, SE) . top 16 (NW: the sniper roost).
//   Access for bots      two external fire escapes (N and S) lead onto the low roofs, and six neon skybridges chain the
//                        roofs together:  N > NE > E > SE   and   S > SW > W > NW.   Four jump pads ring the plaza.
//   Access for players   everything above plus wall-runs along every facade, gap jumps between roofs, mantles and
//                        the grapple (Spire crown, roof billboards, masts, cornices).
//
//   Layout grid: streets are x/z in [-18,-10] and [10,18]; lots are [-38,-18], [-10,10], [18,38].
//   Rocket launcher on the flat skybridge NE-E, sniper on the NW roost, armor in the fountain.

const solids = [];
const MARKS = [];
const add = s => { solids.push(s); return s; };
const lo = Math.min;
const hi = Math.max;
const PI = Math.PI;

const box = (x0, y0, z0, x1, y1, z1, o = {}) => add({
  type: 'box', min: [lo(x0, x1), lo(y0, y1), lo(z0, z1)], max: [hi(x0, x1), hi(y0, y1), hi(z0, z1)], ...o,
});
/** Visual-only box (never collides). */
const deco = (x0, y0, z0, x1, y1, z1, o = {}) => box(x0, y0, z0, x1, y1, z1, { collide: false, ...o });
/** Vertical cylinder standing on y. */
const cyl = (x, y, z, r, h, o = {}) => add({ type: 'cylinder', pos: [x, y + h / 2, z], radius: r, height: h, ...o });
const panel = (x, y, z, w, h, rot, mat, o = {}) => add({ type: 'panel', pos: [x, y, z], size: [w, h], rot, mat, ...o });
const rail = (a, b, o = {}) => add({ type: 'railing', from: a, to: b, ...o });
const wallSeg = (x0, z0, x1, z1, y0, h, o = {}) => add({ type: 'wall', from: [x0, z0], to: [x1, z1], y0, height: h, ...o });

/** World offset of a local (dx, dz) rotated by yaw `rot` (same convention as solid.rot). */
const rel = (x, z, rot, dx, dz) => [x + dx * Math.cos(rot) + dz * Math.sin(rot), z - dx * Math.sin(rot) + dz * Math.cos(rot)];

// small deterministic PRNG for the distant skyline
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ------------------------------------------------------------------------------------------------ neon lettering
// 3x5 pixel font; every glyph is merged into a few rectangles so a word costs about 4 panels per letter.
const FONT = {
  A: ['.#.', '#.#', '###', '#.#', '#.#'], B: ['##.', '#.#', '##.', '#.#', '##.'], C: ['.##', '#..', '#..', '#..', '.##'],
  D: ['##.', '#.#', '#.#', '#.#', '##.'], E: ['###', '#..', '##.', '#..', '###'], F: ['###', '#..', '##.', '#..', '#..'],
  G: ['.##', '#..', '#.#', '#.#', '.##'], H: ['#.#', '#.#', '###', '#.#', '#.#'], I: ['###', '.#.', '.#.', '.#.', '###'],
  K: ['#.#', '#.#', '##.', '#.#', '#.#'], L: ['#..', '#..', '#..', '#..', '###'],
  M: ['#...#', '##.##', '#.#.#', '#...#', '#...#'], N: ['#..#', '##.#', '#.##', '#..#', '#..#'],
  O: ['.#.', '#.#', '#.#', '#.#', '.#.'], P: ['##.', '#.#', '##.', '#..', '#..'], R: ['##.', '#.#', '##.', '#.#', '#.#'],
  S: ['.##', '#..', '.#.', '..#', '##.'], T: ['###', '.#.', '.#.', '.#.', '.#.'], U: ['#.#', '#.#', '#.#', '#.#', '###'],
  V: ['#.#', '#.#', '#.#', '#.#', '.#.'], X: ['#.#', '#.#', '.#.', '#.#', '#.#'], Y: ['#.#', '#.#', '.#.', '.#.', '.#.'],
  W: ['#...#', '#...#', '#.#.#', '##.##', '#...#'],
  0: ['###', '#.#', '#.#', '#.#', '###'], 1: ['.#.', '##.', '.#.', '.#.', '###'], 2: ['##.', '..#', '.#.', '#..', '###'],
  4: ['#.#', '#.#', '###', '..#', '..#'], '-': ['...', '...', '###', '...', '...'],
};

function glyphRects(g) {
  const rects = [];
  let open = {};
  for (let y = 0; y <= g.length; y++) {
    const runs = {};
    if (y < g.length) {
      const row = g[y];
      for (let x = 0; x < row.length; x++) {
        if (row[x] !== '#') continue;
        let x1 = x;
        while (x1 + 1 < row.length && row[x1 + 1] === '#') x1++;
        runs[x + '-' + x1] = [x, x1];
        x = x1;
      }
    }
    const next = {};
    for (const k of Object.keys(open)) {
      if (runs[k]) { open[k].h++; next[k] = open[k]; delete runs[k]; } else rects.push(open[k]);
    }
    for (const k of Object.keys(runs)) next[k] = { x: runs[k][0], y, w: runs[k][1] - runs[k][0] + 1, h: 1 };
    open = next;
  }
  return rects;
}

/** Neon word made of emissive panels, centred on (x, y, z), facing the direction of yaw `rot`. Returns its width. */
function neonText(str, x, y, z, rot, unit, mat) {
  const c = Math.cos(rot), s = Math.sin(rot);
  const rects = [];
  let cursor = 0;
  for (const ch of str) {
    if (ch === ' ') { cursor += 3; continue; }
    const g = FONT[ch];
    if (!g) continue;
    for (const r of glyphRects(g)) rects.push({ x: cursor + r.x, y: r.y, w: r.w, h: r.h });
    cursor += g[0].length + 1;
  }
  const total = cursor - 1;
  for (const r of rects) {
    const u = (r.x + r.w / 2 - total / 2) * unit;
    const v = (2.5 - (r.y + r.h / 2)) * unit;
    panel(x + c * u + s * 0.03, y + v, z - s * u + c * 0.03, r.w * unit, r.h * unit, rot, mat);
  }
  return total * unit;
}

// ------------------------------------------------------------------------------------------------ layout data
const FL = 3.2;   // one storey; glass_window rows repeat every 3.2 m so every roof height is a multiple of it
const BLD = {
  NW: { x0: -38, x1: -18, z0: -38, z1: -18, h: 16 },
  N: { x0: -10, x1: 10, z0: -38, z1: -18, h: 6.4 },
  NE: { x0: 18, x1: 38, z0: -38, z1: -18, h: 9.6 },
  W: { x0: -38, x1: -18, z0: -10, z1: 10, h: 12.8 },
  E: { x0: 18, x1: 38, z0: -10, z1: 10, h: 9.6 },
  SW: { x0: -38, x1: -18, z0: 18, z1: 38, h: 9.6 },
  S: { x0: -10, x1: 10, z0: 18, z1: 38, h: 6.4 },
  SE: { x0: 18, x1: 38, z0: 18, z1: 38, h: 12.8 },
};
const PERIM = 44;      // inner face of the perimeter walls
const PERIM_H = 15;
const TOP_Y = 42;      // top of the invisible boundary volume (bounds.max.y)

// ------------------------------------------------------------------------------------------------ ground
const G = { mat: 'concrete_floor' };
box(-47, -3, -47, 47, 0, 47, { ...G });

// asphalt roads: the # streets, and the ring alley
const ROADS = [
  [-16.5, -43, -11.5, 43], [11.5, -43, 16.5, 43], [-43, -16.5, 43, -11.5], [-43, 11.5, 43, 16.5],
  [-43, -43, 43, -39], [-43, 39, 43, 43], [-43, -39, -39, 39], [39, -39, 43, 39],
];
for (const [x0, z0, x1, z1] of ROADS) box(x0, -0.2, z0, x1, 0.03, z1, { mat: 'asphalt' });
// lane lines (yellow) on the # streets, and edge dashes on the ring
for (const c of [-14, 14]) {
  for (const [a, b] of [[-38, -18], [-10, 10], [18, 38]]) {
    deco(c - 0.1, 0.03, a, c + 0.1, 0.045, b, { mat: 'metal_painted_yellow', shadow: false });
    deco(a, 0.03, c - 0.1, b, 0.045, c + 0.1, { mat: 'metal_painted_yellow', shadow: false });
  }
}

MARKS.push(['plaza: stone tiles', solids.length]);
// plaza: stone tiles, a marble medallion with a neon ring, the fountain and the Spire
box(-10, -0.2, -10, 10, 0.07, 10, { mat: 'stone_tiles' });
cyl(0, 0.02, 0, 8.55, 0.06, { mat: 'neon_blue', sides: 40, collide: false });
cyl(0, 0.02, 0, 8.25, 0.09, { mat: 'marble', sides: 40 });
cyl(0, 0.02, 0, 5.9, 0.4, { mat: 'marble', sides: 32 });                     // fountain lower tier
cyl(0, 0.02, 0, 5.0, 0.47, { mat: 'water', sides: 32 });                     // water surface (top 0.49)
cyl(0, 0.02, 0, 2.9, 1.1, { mat: 'marble', sides: 24 });                     // central plinth (top 1.12)
for (let k = 0; k < 8; k++) {                                                  // glowing jets around the basin
  const a = (k / 8) * PI * 2 + PI / 8;
  cyl(Math.cos(a) * 3.9, 0.4, Math.sin(a) * 3.9, 0.09, 1.5, { mat: k % 2 ? 'neon_pink' : 'neon_blue', sides: 6, collide: false });
}
// plaza seat walls and planters at the diagonals, trees, lamps
for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
  const cx = sx * 6.6, cz = sz * 6.6;
  const tx = -sz * 0.707, tz = sx * 0.707;       // tangent direction
  wallSeg(cx - tx * 2.3, cz - tz * 2.3, cx + tx * 2.3, cz + tz * 2.3, 0.07, 1.2, { mat: 'concrete_dark', top: 'concrete', thickness: 0.55 });
  wallSeg(cx - tx * 2.3, cz - tz * 2.3, cx + tx * 2.3, cz + tz * 2.3, 1.27, 0.06, { mat: 'neon_blue', thickness: 0.4, collide: false });
  // planter + tree behind the wall
  const px = sx * 8.6, pz = sz * 8.6;
  box(px - 1.1, 0.07, pz - 1.1, px + 1.1, 0.75, pz + 1.1, { mat: 'concrete', top: 'grass' });
  cyl(px, 0.75, pz, 0.14, 2.3, { mat: 'wood_planks', sides: 6 });
  cyl(px, 2.3, pz, 1.35, 1.7, { mat: 'grass', radiusTop: 0.3, sides: 7, collide: false });
  cyl(px, 3.5, pz, 1.0, 1.4, { mat: 'grass', radiusTop: 0.0, sides: 7, collide: false });
}

MARKS.push(['the Spire', solids.length]);
// ------------------------------------------------------------------------------------------------ the Spire
// shaft, base collar, neon bands, billboard crown, mast
box(-2.2, 1.1, -2.2, 2.2, 1.9, 2.2, { mat: 'concrete_dark', top: 'metal_dark', bevel: 0.05 });
box(-1.8, 1.9, -1.8, 1.8, 22.0, 1.8, { mat: 'concrete_dark' });
box(-2.15, 21.4, -2.15, 2.15, 22.4, 2.15, { mat: 'metal_dark', top: 'metal_panel', bevel: 0.05 });
[[3.4, 'neon_blue'], [6.6, 'neon_pink'], [9.8, 'neon_blue'], [12.2, 'neon_pink']].forEach(([y, m]) => {
  deco(-1.92, y, -1.92, 1.92, y + 0.22, 1.92, { mat: m });
});
for (const sx of [-1, 1]) for (const sz of [-1, 1]) deco(sx * 1.83 - 0.06, 1.9, sz * 1.83 - 0.06, sx * 1.83 + 0.06, 13.4, sz * 1.83 + 0.06, { mat: 'neon_blue' });
cyl(0, 22.4, 0, 0.2, 7.2, { mat: 'metal_dark', sides: 6, radiusTop: 0.09 });
for (const y of [24.6, 26.8, 29.2]) cyl(0, y, 0, 0.26, 0.22, { mat: 'neon_orange', sides: 6, collide: false });
// the crown: two crossing slabs, 15 x 6.6 m
const CY0 = 13.5, CY1 = 20.1, CYM = (CY0 + CY1) / 2;
box(-7.5, CY0, -0.45, 7.5, CY1, 0.45, { mat: 'metal_dark', top: 'metal_painted_yellow', bottom: 'metal_dark' });
box(-0.45, CY0, -7.5, 0.45, CY1, 7.5, { mat: 'metal_dark', top: 'metal_painted_yellow', bottom: 'metal_dark' });
MARKS.push(['crown faces', solids.length]);
// crown faces: S = KINETIC, N = SKYLINE, E = target rings, W = bars
function crownFrame(rot, off, m1, m2) {
  const c = Math.cos(rot), s = Math.sin(rot);
  const P = (u, v, w, h, m) => panel(c * u + s * off, v, -s * u + c * off, w, h, rot, m);
  P(0, CY1 - 0.4, 14.2, 0.22, m1);
  P(0, CY0 + 0.4, 14.2, 0.22, m1);
  P(-7.0, CYM, 0.22, CY1 - CY0 - 0.6, m1);
  P(7.0, CYM, 0.22, CY1 - CY0 - 0.6, m1);
  P(0, CY0 + 1.15, 9.5, 0.14, m2);
  P(0, CY1 - 1.15, 9.5, 0.14, m2);
}
crownFrame(0, 0.46, 'neon_pink', 'neon_blue');
crownFrame(PI, 0.46, 'neon_blue', 'neon_pink');
neonText('KINETIC', 0, CYM, 0.46, 0, 0.44, 'neon_pink');
neonText('SKYLINE', 0, CYM, -0.46, PI, 0.44, 'neon_blue');
MARKS.push(['east face: concentric', solids.length]);
// east face: concentric rings; west face: bars
for (const sx of [1]) {
  const fx = 0.46 * sx;
  const ring = (r, m, d) => add({ type: 'cylinder', pos: [fx + sx * d, CYM, 0], radius: r, height: 0.06, sides: 28, axis: 'x', mat: m, collide: false, shadow: false });
  ring(2.7, 'neon_blue', 0.03);
  ring(2.4, 'metal_dark', 0.05);
  ring(1.7, 'neon_pink', 0.07);
  ring(1.4, 'metal_dark', 0.09);
  ring(0.7, 'neon_blue', 0.11);
}
for (let k = -5; k <= 5; k++) panel(-0.46, CYM, k * 1.15, 0.55, CY1 - CY0 - 1.0, -PI / 2, k % 2 ? 'neon_pink' : 'neon_blue');

// ------------------------------------------------------------------------------------------------ perimeter
MARKS.push(['const PW = [', solids.length]);
const PW = [
  // side, lower mat, upper mat
  ['n', 'brick_dark', 'concrete'], ['s', 'brick_dark', 'concrete_dark'], ['e', 'brick_dark', 'glass_window'], ['w', 'brick_dark', 'plaster'],
];
for (const [side, lowM, upM] of PW) {
  let a;
  if (side === 'n') a = [-46, -45, 46, -PERIM];
  if (side === 's') a = [-46, PERIM, 46, 45];
  if (side === 'e') a = [PERIM, -PERIM, 45, PERIM];
  if (side === 'w') a = [-45, -PERIM, -PERIM, PERIM];
  const [x0, z0, x1, z1] = a;
  box(x0, -1, z0, x1, 5.6, z1, { mat: lowM });
  box(x0, 5.6, z0, x1, PERIM_H, z1, { mat: upM, top: 'concrete_dark' });
}
MARKS.push(['invisible boundary vol', solids.length]);
// invisible boundary volume above and outside
box(-49, PERIM_H - 0.5, -49, 49, TOP_Y, -PERIM, { visible: false });
box(-49, PERIM_H - 0.5, PERIM, 49, TOP_Y, 49, { visible: false });
box(-49, PERIM_H - 0.5, -PERIM, -PERIM, TOP_Y, PERIM, { visible: false });
box(PERIM, PERIM_H - 0.5, -PERIM, 49, TOP_Y, PERIM, { visible: false });
MARKS.push(['perimeter trims', solids.length]);
// perimeter trims (no collision): neon line, pilasters, coping, banners
for (const [c, m] of [[-PERIM, 'neon_blue'], [PERIM, 'neon_pink']]) {
  deco(-PERIM, 5.6, c - (c < 0 ? 0.06 : -0.06) - 0.03, PERIM, 5.8, c - (c < 0 ? 0.06 : -0.06) + 0.03, { mat: m });
  deco(c - (c < 0 ? 0.06 : -0.06) - 0.03, 5.6, -PERIM, c - (c < 0 ? 0.06 : -0.06) + 0.03, 5.8, PERIM, { mat: c < 0 ? 'neon_pink' : 'neon_blue' });
}
for (let k = -3; k <= 3; k++) {
  const t = k * 12.5;
  deco(t - 0.5, 0, -PERIM - 0.001, t + 0.5, PERIM_H, -PERIM + 0.25, { mat: 'concrete_dark' });
  deco(t - 0.5, 0, PERIM - 0.25, t + 0.5, PERIM_H, PERIM + 0.001, { mat: 'concrete_dark' });
  deco(-PERIM - 0.001, 0, t - 0.5, -PERIM + 0.25, PERIM_H, t + 0.5, { mat: 'concrete_dark' });
  deco(PERIM - 0.25, 0, t - 0.5, PERIM + 0.001, PERIM_H, t + 0.5, { mat: 'concrete_dark' });
}
deco(-PERIM - 0.4, PERIM_H - 0.5, -PERIM - 1.4, PERIM + 0.4, PERIM_H, -PERIM + 0.2, { mat: 'concrete' });
deco(-PERIM - 0.4, PERIM_H - 0.5, PERIM - 0.2, PERIM + 0.4, PERIM_H, PERIM + 1.4, { mat: 'concrete' });
deco(-PERIM - 1.4, PERIM_H - 0.5, -PERIM, -PERIM + 0.2, PERIM_H, PERIM, { mat: 'concrete' });
deco(PERIM - 0.2, PERIM_H - 0.5, -PERIM, PERIM + 1.4, PERIM_H, PERIM, { mat: 'concrete' });
// hanging billboards on the perimeter, facing the arena
function perimeterSign(side, t, str, m, y = 9.6) {
  const u = 0.36;
  if (side === 'n') { panel(t, y, -PERIM + 0.08, 12, 3.4, 0, 'metal_dark'); neonText(str, t, y, -PERIM + 0.1, 0, u, m); }
  if (side === 's') { panel(t, y, PERIM - 0.08, 12, 3.4, PI, 'metal_dark'); neonText(str, t, y, PERIM - 0.1, PI, u, m); }
  if (side === 'w') { panel(-PERIM + 0.08, y, t, 12, 3.4, PI / 2, 'metal_dark'); neonText(str, -PERIM + 0.1, y, t, PI / 2, u, m); }
  if (side === 'e') { panel(PERIM - 0.08, y, t, 12, 3.4, -PI / 2, 'metal_dark'); neonText(str, PERIM - 0.1, y, t, -PI / 2, u, m); }
}
perimeterSign('n', -25, 'OPEN', 'neon_green');
perimeterSign('n', 25, 'BAR', 'neon_pink');
perimeterSign('s', -25, 'HOTEL', 'neon_blue');
perimeterSign('s', 25, '24', 'neon_orange');
perimeterSign('e', -20, 'CLUB', 'neon_pink');
perimeterSign('w', 20, 'MAX', 'neon_blue');

// ------------------------------------------------------------------------------------------------ building helpers
/**
 * Building shell: a base band (0 .. FL) and the upper body.
 * o: { base, mat, roof, baseH }
 */
function shell(b, o) {
  const baseH = o.baseH ?? FL;
  box(b.x0, -1, b.z0, b.x1, baseH, b.z1, { mat: o.base });
  box(b.x0, baseH, b.z0, b.x1, b.h, b.z1, { mat: o.mat, top: o.roof ?? 'roof_gravel', bottom: o.base });
}

/** Parapet around the roof. gaps: { n:[[a,b]], s:[[a,b]], w:[[a,b]], e:[[a,b]] } along the edge (x for n/s, z for w/e). */
function parapet(b, gaps = {}, o = {}) {
  const t = o.t ?? 0.4, h = o.h ?? 1.0, mat = o.mat ?? 'concrete', cap = o.cap ?? 'concrete_dark';
  const cut = (a0, a1, list) => {
    let segs = [[a0, a1]];
    for (const [g0, g1] of (list || [])) {
      const next = [];
      for (const [s0, s1] of segs) {
        if (g1 <= s0 || g0 >= s1) { next.push([s0, s1]); continue; }
        if (g0 > s0) next.push([s0, g0]);
        if (g1 < s1) next.push([g1, s1]);
      }
      segs = next;
    }
    return segs.filter(([s0, s1]) => s1 - s0 > 0.3);
  };
  const y0 = b.h, y1 = b.h + h;
  const F = { mat, top: cap, nav: false };
  for (const [s0, s1] of cut(b.x0, b.x1, gaps.n)) box(s0, y0, b.z0, s1, y1, b.z0 + t, F);
  for (const [s0, s1] of cut(b.x0, b.x1, gaps.s)) box(s0, y0, b.z1 - t, s1, y1, b.z1, F);
  for (const [s0, s1] of cut(b.z0 + t, b.z1 - t, gaps.w)) box(b.x0, y0, s0, b.x0 + t, y1, s1, F);
  for (const [s0, s1] of cut(b.z0 + t, b.z1 - t, gaps.e)) box(b.x1 - t, y0, s0, b.x1, y1, s1, F);
}

/** Decorative cornice under the roof line and a plinth at the street. */
function trim(b, mat = 'concrete', plinth = null) {
  const o = 0.22;
  deco(b.x0 - o, b.h - 0.55, b.z0 - o, b.x1 + o, b.h - 0.05, b.z0, { mat });
  deco(b.x0 - o, b.h - 0.55, b.z1, b.x1 + o, b.h - 0.05, b.z1 + o, { mat });
  deco(b.x0 - o, b.h - 0.55, b.z0, b.x0, b.h - 0.05, b.z1, { mat });
  deco(b.x1, b.h - 0.55, b.z0, b.x1 + o, b.h - 0.05, b.z1, { mat });
  if (plinth) {
    const p = 0.12;
    deco(b.x0 - p, 0, b.z0 - p, b.x1 + p, 0.7, b.z0, { mat: plinth });
    deco(b.x0 - p, 0, b.z1, b.x1 + p, 0.7, b.z1 + p, { mat: plinth });
    deco(b.x0 - p, 0, b.z0, b.x0, 0.7, b.z1, { mat: plinth });
    deco(b.x1, 0, b.z0, b.x1 + p, 0.7, b.z1, { mat: plinth });
  }
}

/** Ribbon windows (glass_window strips) on brick / plaster / concrete facades. floors: 1-based storeys to glaze. */
function bands(b, floors, sides = 'nsew') {
  const pad = 1.0;
  for (let f = 1; f < b.h / FL - 0.01; f++) {
    if (!floors.includes(f)) continue;
    const y = FL * f + 1.6;
    if (sides.includes('n')) panel((b.x0 + b.x1) / 2, y, b.z0 - 0.03, b.x1 - b.x0 - pad * 2, 2.3, PI, 'glass_window');
    if (sides.includes('s')) panel((b.x0 + b.x1) / 2, y, b.z1 + 0.03, b.x1 - b.x0 - pad * 2, 2.3, 0, 'glass_window');
    if (sides.includes('w')) panel(b.x0 - 0.03, y, (b.z0 + b.z1) / 2, b.z1 - b.z0 - pad * 2, 2.3, -PI / 2, 'glass_window');
    if (sides.includes('e')) panel(b.x1 + 0.03, y, (b.z0 + b.z1) / 2, b.z1 - b.z0 - pad * 2, 2.3, PI / 2, 'glass_window');
  }
}

/** Vertical neon edge strips on a building corner. corner: 'nw','ne','sw','se'. */
function cornerStrip(b, corner, mat, h0 = 0.5, h1 = null) {
  const x = corner.includes('w') ? b.x0 : b.x1;
  const z = corner.includes('n') ? b.z0 : b.z1;
  const sx = corner.includes('w') ? -1 : 1, sz = corner.includes('n') ? -1 : 1;
  deco(x + (sx > 0 ? -0.02 : -0.16) + (sx > 0 ? 0 : 0), h0, z + (sz > 0 ? -0.02 : -0.16), x + (sx > 0 ? 0.16 : 0.02), h1 ?? b.h - 0.6, z + (sz > 0 ? 0.16 : 0.02), { mat });
}

/** Awning over a shopfront (visual + walkable slab). */
function awning(b, side, t0, t1, y, depth, mat = 'metal_dark', glow = 'neon_pink') {
  const d = depth;
  if (side === 's') { box(t0, y, b.z1, t1, y + 0.22, b.z1 + d, { mat, top: 'metal_grate' }); deco(t0, y - 0.1, b.z1 + d - 0.06, t1, y, b.z1 + d, { mat: glow }); }
  if (side === 'n') { box(t0, y, b.z0 - d, t1, y + 0.22, b.z0, { mat, top: 'metal_grate' }); deco(t0, y - 0.1, b.z0 - d, t1, y, b.z0 - d + 0.06, { mat: glow }); }
  if (side === 'e') { box(b.x1, y, t0, b.x1 + d, y + 0.22, t1, { mat, top: 'metal_grate' }); deco(b.x1 + d - 0.06, y - 0.1, t0, b.x1 + d, y, t1, { mat: glow }); }
  if (side === 'w') { box(b.x0 - d, y, t0, b.x0, y + 0.22, t1, { mat, top: 'metal_grate' }); deco(b.x0 - d, y - 0.1, t0, b.x0 - d + 0.06, y, t1, { mat: glow }); }
}

/** Sign on a facade: dark backing + neon text. side n/s/e/w of building b, t = lateral centre, y = centre height. */
function facadeSign(b, side, t, y, str, mat, unit = 0.3) {
  const w = (str.length * 4) * unit + 0.8, hh = 5 * unit + 0.7;
  const off = 0.06;
  if (side === 's') { panel(t, y, b.z1 + off, w, hh, 0, 'metal_dark'); neonText(str, t, y, b.z1 + off, 0, unit, mat); }
  if (side === 'n') { panel(t, y, b.z0 - off, w, hh, PI, 'metal_dark'); neonText(str, t, y, b.z0 - off, PI, unit, mat); }
  if (side === 'e') { panel(b.x1 + off, y, t, w, hh, PI / 2, 'metal_dark'); neonText(str, b.x1 + off, y, t, PI / 2, unit, mat); }
  if (side === 'w') { panel(b.x0 - off, y, t, w, hh, -PI / 2, 'metal_dark'); neonText(str, b.x0 - off, y, t, -PI / 2, unit, mat); }
}

// ---- rooftop props
function ac(x, y, z, rot = 0, w = 2.2, d = 1.5) {
  add({ type: 'box', pos: [x, y + 0.6, z], size: [w, 1.2, d], rot, mat: 'metal_panel', top: 'metal_dark', bevel: 0.05 });
  const [fx, fz] = rel(x, z, rot, w * 0.22, 0);
  add({ type: 'cylinder', pos: [fx, y + 1.23, fz], radius: 0.52, height: 0.06, sides: 12, mat: 'metal_dark', collide: false });
  const [gx, gz] = rel(x, z, rot, -w * 0.3, 0);
  add({ type: 'box', pos: [gx, y + 1.3, gz], size: [0.5, 0.2, d - 0.3], rot, mat: 'metal_dark', collide: false });
}
function vent(x, y, z, h = 1.4, r = 0.34) {
  cyl(x, y, z, r, h, { mat: 'metal_panel', sides: 10 });
  cyl(x, y + h, z, r * 1.5, 0.14, { mat: 'metal_dark', sides: 10, collide: false });
}
function skylight(x0, z0, x1, z1, y, m = 'light_panel') {
  box(x0, y, z0, x1, y + 0.5, z1, { mat: 'metal_dark', top: m });
}
function bulkhead(x0, z0, x1, z1, y, h, doorSide, mat = 'concrete') {
  box(x0, y, z0, x1, y + h, z1, { mat, top: 'metal_dark' });
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  if (doorSide === 's') panel(cx, y + 1.1, z1 + 0.03, 1.4, 2.2, 0, 'metal_corrugated');
  if (doorSide === 'n') panel(cx, y + 1.1, z0 - 0.03, 1.4, 2.2, PI, 'metal_corrugated');
  if (doorSide === 'e') panel(x1 + 0.03, y + 1.1, cz, 1.4, 2.2, PI / 2, 'metal_corrugated');
  if (doorSide === 'w') panel(x0 - 0.03, y + 1.1, cz, 1.4, 2.2, -PI / 2, 'metal_corrugated');
  deco(x0 - 0.05, y + h - 0.35, z0 - 0.05, x1 + 0.05, y + h, z1 + 0.05, { mat: 'metal_dark' });
}
function tank(x, y, z) {
  const legH = 2.9;
  for (const [dx, dz] of [[-1.35, -1.35], [1.35, -1.35], [1.35, 1.35], [-1.35, 1.35]]) box(x + dx - 0.13, y, z + dz - 0.13, x + dx + 0.13, y + legH, z + dz + 0.13, { mat: 'metal_dark' });
  deco(x - 1.5, y + 1.4, z - 1.4, x + 1.5, y + 1.55, z - 1.3, { mat: 'metal_dark' });
  deco(x - 1.5, y + 1.4, z + 1.3, x + 1.5, y + 1.55, z + 1.4, { mat: 'metal_dark' });
  box(x - 1.6, y + legH, z - 1.6, x + 1.6, y + legH + 0.2, z + 1.6, { mat: 'metal_dark', top: 'metal_panel' });
  cyl(x, y + legH + 0.2, z, 1.85, 2.7, { mat: 'metal_rust', sides: 14, top: 'metal_dark' });
  cyl(x, y + legH + 2.9, z, 1.95, 1.0, { mat: 'metal_dark', radiusTop: 0, sides: 14 });
  deco(x + 1.85, y, z - 0.2, x + 2.0, y + legH + 2.6, z + 0.2, { mat: 'metal_dark' });
}
function antenna(x, y, z, h = 6, lit = true) {
  box(x - 0.5, y, z - 0.5, x + 0.5, y + 0.5, z + 0.5, { mat: 'metal_dark', top: 'metal_panel' });
  cyl(x, y + 0.5, z, 0.11, h, { mat: 'metal_dark', sides: 6, radiusTop: 0.05 });
  deco(x - 0.9, y + h * 0.62, z - 0.03, x + 0.9, y + h * 0.62 + 0.07, z + 0.03, { mat: 'metal_dark' });
  deco(x - 0.6, y + h * 0.78, z - 0.03, x + 0.6, y + h * 0.78 + 0.07, z + 0.03, { mat: 'metal_dark' });
  if (lit) cyl(x, y + h + 0.5, z, 0.16, 0.3, { mat: 'neon_orange', sides: 6, collide: false });
}
/** Freestanding rooftop billboard facing yaw `rot` (0 faces +Z). */
function billboard(x, y, z, rot, w, h, str, textMat, frameMat = 'neon_blue') {
  const c = Math.cos(rot), s = Math.sin(rot);
  const legH = 1.4;
  for (const u of [-w * 0.32, w * 0.32]) {
    const [lx, lz] = rel(x, z, rot, u, -0.2);
    add({ type: 'box', pos: [lx, y + legH / 2, lz], size: [0.3, legH, 0.3], rot, mat: 'metal_dark' });
  }
  add({ type: 'box', pos: [x, y + legH + h / 2, z], size: [w, h, 0.4], rot, mat: 'metal_dark', top: 'metal_panel' });
  const P = (u, v, pw, ph, m, d = 0.23) => panel(x + c * u + s * d, y + legH + v, z - s * u + c * d, pw, ph, rot, m);
  P(0, h - 0.25, w - 0.5, 0.14, frameMat);
  P(0, 0.25, w - 0.5, 0.14, frameMat);
  P(-w / 2 + 0.25, h / 2, 0.14, h - 0.3, frameMat);
  P(w / 2 - 0.25, h / 2, 0.14, h - 0.3, frameMat);
  if (str) neonText(str, x + s * 0.2, y + legH + h / 2, z + c * 0.2, rot, Math.min(0.42, (w - 1.6) / (str.length * 4 + 1)), textMat);
  // back braces
  for (const u of [-w * 0.32, w * 0.32]) {
    const [lx, lz] = rel(x, z, rot, u, -0.9);
    add({ type: 'box', pos: [lx, y + 0.6, lz], size: [0.15, 1.2, 0.15], rot, mat: 'metal_dark', collide: false });
  }
}
function planter(x, y, z, w = 2.4, d = 1.2, tree = true) {
  box(x - w / 2, y, z - d / 2, x + w / 2, y + 0.65, z + d / 2, { mat: 'concrete', top: 'grass' });
  if (tree) {
    cyl(x, y + 0.65, z, 0.12, 1.7, { mat: 'wood_planks', sides: 6 });
    cyl(x, y + 1.8, z, 1.15, 1.5, { mat: 'grass', radiusTop: 0.25, sides: 7, collide: false });
    cyl(x, y + 2.9, z, 0.85, 1.2, { mat: 'grass', radiusTop: 0, sides: 7, collide: false });
  }
}
function crateStack(x, y, z, rot = 0) {
  add({ type: 'crate', pos: [x, y + 0.6, z], size: 1.2, rot });
  const [ax, az] = rel(x, z, rot, 1.25, 0.1);
  add({ type: 'crate', pos: [ax, y + 0.6, az], size: 1.2, rot: rot + 0.2 });
  add({ type: 'crate', pos: [x + 0.2, y + 1.8, z + 0.05], size: 1.2, rot: rot + 0.1 });
}
function helipad(x, y, z, r = 4.6) {
  cyl(x, y, z, r + 0.35, 0.06, { mat: 'metal_painted_yellow', sides: 28 });
  cyl(x, y, z, r, 0.09, { mat: 'concrete_dark', sides: 28 });
  deco(x - 1.0, y + 0.09, z - 1.7, x - 0.55, y + 0.11, z + 1.7, { mat: 'light_panel' });
  deco(x + 0.55, y + 0.09, z - 1.7, x + 1.0, y + 0.11, z + 1.7, { mat: 'light_panel' });
  deco(x - 0.6, y + 0.09, z - 0.22, x + 0.6, y + 0.11, z + 0.22, { mat: 'light_panel' });
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * PI * 2;
    cyl(x + Math.cos(a) * (r + 0.1), y + 0.06, z + Math.sin(a) * (r + 0.1), 0.12, 0.08, { mat: 'neon_orange', sides: 6, collide: false });
  }
}

// ---- vehicles and street furniture
function car(x, z, rot, body = 'metal_painted_yellow', kind = 'car') {
  const long = kind === 'van' ? 5.0 : 4.4, hgt = kind === 'van' ? 1.5 : 0.75;
  add({ type: 'box', pos: [x, 0.2 + hgt / 2 + 0.15, z], size: [1.95, hgt, long], rot, mat: body, bevel: 0.14 });
  if (kind === 'van') {
    const [cx, cz] = rel(x, z, rot, 0, -long * 0.32);
    add({ type: 'box', pos: [cx, 1.95, cz], size: [1.85, 0.62, long * 0.34], rot, mat: 'metal_dark', bevel: 0.1 });
  } else {
    const [cx, cz] = rel(x, z, rot, 0, 0.1);
    add({ type: 'box', pos: [cx, 1.2, cz], size: [1.7, 0.6, 2.3], rot, mat: 'metal_dark', bevel: 0.12 });
  }
  add({ type: 'box', pos: [x, 0.25, z], size: [1.9, 0.3, long - 0.5], rot, mat: 'rubber', collide: false });
  for (const dx of [-0.6, 0.6]) {
    const [hx, hz] = rel(x, z, rot, dx, -long / 2 - 0.02);
    panel(hx, 0.62, hz, 0.5, 0.16, rot + PI, 'light_panel');
    const [tx, tz] = rel(x, z, rot, dx, long / 2 + 0.02);
    panel(tx, 0.62, tz, 0.5, 0.14, rot, 'neon_pink');
  }
}
function streetlight(x, z, dx, dz, color = 'neon_orange') {
  cyl(x, 0, z, 0.1, 6.4, { mat: 'metal_dark', sides: 6 });
  cyl(x, 0, z, 0.22, 0.5, { mat: 'metal_dark', sides: 6 });
  const len = 1.5;
  const ax = x + dx * len, az = z + dz * len;
  deco(lo(x, ax) - 0.05, 6.3, lo(z, az) - 0.05, hi(x, ax) + 0.05, 6.45, hi(z, az) + 0.05, { mat: 'metal_dark' });
  deco(ax - 0.25 - Math.abs(dz) * 0.1, 6.12, az - 0.25 - Math.abs(dx) * 0.1, ax + 0.25 + Math.abs(dz) * 0.1, 6.3, az + 0.25 + Math.abs(dx) * 0.1, { mat: color });
}
function barrier(x, z, rot = 0, len = 2.6) {
  add({ type: 'box', pos: [x, 0.5, z], size: [0.55, 1.0, len], rot, mat: 'concrete', top: 'concrete_dark', bevel: 0.07 });
  const [ax, az] = rel(x, z, rot, 0.29, 0);
  panel(ax, 0.62, az, len - 0.4, 0.22, rot + PI / 2, 'hazard');
  const [bx, bz] = rel(x, z, rot, -0.29, 0);
  panel(bx, 0.62, bz, len - 0.4, 0.22, rot - PI / 2, 'hazard');
}
function dumpster(x, z, rot = 0, mat = 'container_green') {
  add({ type: 'box', pos: [x, 0.62, z], size: [1.3, 1.24, 2.2], rot, mat, bevel: 0.05 });
  add({ type: 'box', pos: [x, 1.3, z], size: [1.36, 0.14, 2.26], rot, mat: 'metal_dark', collide: false });
}
function busShelter(x, z, rot) {
  const P = (dx, dz, w, h, d, y0, m, o = {}) => { const [px, pz] = rel(x, z, rot, dx, dz); add({ type: 'box', pos: [px, y0 + h / 2, pz], size: [w, h, d], rot, mat: m, ...o }); };
  P(-1.6, 0, 0.12, 2.6, 0.12, 0, 'metal_dark');
  P(1.6, 0, 0.12, 2.6, 0.12, 0, 'metal_dark');
  P(0, 0, 3.6, 0.14, 1.5, 2.6, 'metal_dark', { top: 'light_panel' });
  P(0, 0.62, 3.2, 0.1, 0.5, 0.45, 'wood_planks');
  P(0, 0.62, 3.2, 1.9, 0.06, 0.7, 'glass_window', { collide: false });
}
function kiosk(x, z, rot, glow = 'neon_blue') {
  add({ type: 'box', pos: [x, 1.15, z], size: [3.0, 2.3, 2.2], rot, mat: 'metal_panel', top: 'metal_dark', bevel: 0.06 });
  const [ax, az] = rel(x, z, rot, 0, 1.75);
  add({ type: 'box', pos: [ax, 2.4, az], size: [3.4, 0.12, 1.5], rot, mat: 'metal_dark', collide: false });
  const [sx, sz] = rel(x, z, rot, 0, 1.12);
  panel(sx, 1.35, sz, 2.4, 0.9, rot, 'glass_window');
  const [gx, gz] = rel(x, z, rot, 0, 2.5);
  add({ type: 'box', pos: [gx, 2.32, gz], size: [3.4, 0.1, 0.1], rot, mat: glow, collide: false });
}

// ---- bridges and escapes
function catRail(x0, y0, z0, x1, y1, z1, w, mat, collide = false) {
  const dx = x1 - x0, dz = z1 - z0, len = Math.hypot(dx, dz);
  const lx = -dz / len, lz = dx / len;
  const off = w / 2 - 0.05;
  for (const s of [-1, 1]) rail([x0 + lx * s * off, y0, z0 + lz * s * off], [x1 + lx * s * off, y1, z1 + lz * s * off], { collide, mat });
}
/** Skybridge across a street. Flat ones use the catwalk's own colliding rails, sloped ones get visual rails + invisible side walls. */
function bridge(axis, c, a, b, yA, yB, glow, w = 3) {
  const from = axis === 'x' ? [a, yA, c] : [c, yA, a];
  const to = axis === 'x' ? [b, yB, c] : [c, yB, b];
  if (Math.abs(yA - yB) < 0.01) {
    add({ type: 'catwalk', from, to, width: w, railings: 'both', railMat: glow, thickness: 0.24 });
  } else {
    add({ type: 'catwalk', from, to, width: w, railings: 'none', thickness: 0.24 });
    catRail(from[0], from[1], from[2], to[0], to[1], to[2], w, glow, false);
    const off = w / 2 - 0.02;
    const yLo = lo(yA, yB) - 0.3, hgt = Math.abs(yA - yB) + 1.5;
    for (const s of [-1, 1]) {
      if (axis === 'x') wallSeg(a, c + s * off, b, c + s * off, yLo, hgt, { visible: false, thickness: 0.16 });
      else wallSeg(c + s * off, a, c + s * off, b, yLo, hgt, { visible: false, thickness: 0.16 });
    }
  }
  // support brackets under each end, hidden in the facades
  const bw = w + 0.3;
  if (axis === 'x') {
    deco(lo(a, b) - 0.1, lo(yA, yB) - 0.9, c - bw / 2, lo(a, b) + 0.9, lo(yA, yB) - 0.3, c + bw / 2, { mat: 'metal_dark' });
    deco(hi(a, b) - 0.9, hi(yA, yB) - 0.9, c - bw / 2, hi(a, b) + 0.1, hi(yA, yB) - 0.3, c + bw / 2, { mat: 'metal_dark' });
  } else {
    deco(c - bw / 2, lo(yA, yB) - 0.9, lo(a, b) - 0.1, c + bw / 2, lo(yA, yB) - 0.3, lo(a, b) + 0.9, { mat: 'metal_dark' });
    deco(c - bw / 2, hi(yA, yB) - 0.9, hi(a, b) - 0.9, c + bw / 2, hi(yA, yB) - 0.3, hi(a, b) + 0.1, { mat: 'metal_dark' });
  }
}

/**
 * External fire escape along a facade at x = xc (deck centre), heading in +/-Z from zStart, `floors` storeys high.
 * outer = -1/+1: which side of the deck is open air (rails on that side). Returns the z range of the top platform.
 */
function escapeZ(xc, zStart, dz, floors, outer, w = 2.7) {
  const run = 6.4, land = 2.6;
  let z = zStart, y = 0;
  const xo = xc + outer * (w / 2 - 0.05);
  let top = null;
  for (let i = 0; i < floors; i++) {
    const z1 = z + dz * run;
    add({ type: 'catwalk', from: [xc, y, z], to: [xc, y + FL, z1], width: w, railings: 'none', thickness: 0.22 });
    catRail(xc, y, z, xc, y + FL, z1, w, 'metal_painted_yellow', false);
    y += FL;
    const z2 = z1 + dz * land;
    box(xc - w / 2, y - 0.25, lo(z1, z2), xc + w / 2, y, hi(z1, z2), { mat: 'metal_dark', top: 'metal_grate' });
    rail([xo, y, z1], [xo, y, z2], { mat: 'metal_painted_yellow' });
    deco(xo - 0.1, 0, lo(z1, z2) + 0.1, xo + 0.1, y - 0.25, lo(z1, z2) + 0.3, { mat: 'metal_dark' });
    deco(xo - 0.1, 0, hi(z1, z2) - 0.3, xo + 0.1, y - 0.25, hi(z1, z2) - 0.1, { mat: 'metal_dark' });
    if (i === floors - 1) {
      rail([xo, y, z2], [xc - outer * (w / 2), y, z2], { mat: 'metal_painted_yellow' });
      top = [lo(z1, z2), hi(z1, z2)];
    }
    z = z2;
  }
  return top;
}

// ------------------------------------------------------------------------------------------------ the eight buildings
const gapC = (c, half = 1.6) => [[c - half, c + half]];   // gap for a 3 m skybridge / stair mouth

MARKS.push(['NW: "Vantage"', solids.length]);
// NW: "Vantage" glass tower, 16 m: the sniper roost
{
  const b = BLD.NW;
  shell(b, { base: 'concrete_dark', mat: 'glass_window' });
  trim(b, 'metal_dark', 'concrete_dark');
  parapet(b, { s: gapC(-28), e: [[-34, -29]] }, { mat: 'metal_dark' });
  cornerStrip(b, 'se', 'neon_blue');
  cornerStrip(b, 'ne', 'neon_pink');
  cornerStrip(b, 'sw', 'neon_pink');
  facadeSign(b, 'e', -28, 5.4, 'MAX', 'neon_blue', 0.36);
  billboard(-22, 16, -36.4, 0, 8, 3.4, 'SKY', 'neon_pink', 'neon_pink');
  helipad(-27, 16, -27, 4.4);
  bulkhead(-37.2, -22.6, -33.9, -19.4, 16, 3.1, 's');
  antenna(-19.6, 16, -19.6, 9);
  ac(-22, 16, -33, 0);
  ac(-22, 16, -30.6, 0);
  vent(-31.5, 16, -21.2, 1.5);
  vent(-33.0, 16, -21.2, 1.2);
  skylight(-26, -23, -21.5, -20.5, 16);
  // sniper nook: two low walls form a corner shelter around the pad
  wallSeg(-37.6, -32.2, -34.4, -32.2, 16, 1.3, { mat: 'concrete_dark', top: 'concrete', thickness: 0.5 });
  wallSeg(-32.2, -37.6, -32.2, -34.4, 16, 1.3, { mat: 'concrete_dark', top: 'concrete', thickness: 0.5 });
  crateStack(-36.2, 16, -35.9, 0.4);
}

MARKS.push(['N: "Foundry', solids.length]);
// N: "Foundry Lofts" brick block with a roof garden, 6.4 m; fire escape on its west face
{
  const b = BLD.N;
  shell(b, { base: 'brick_dark', mat: 'brick' });
  trim(b, 'concrete', 'concrete_dark');
  bands(b, [1]);
  parapet(b, { s: [[-3.5, 3.5]], w: [[-32.7, -29.7]], e: gapC(-28) }, { mat: 'brick_dark', cap: 'concrete' });
  facadeSign(b, 's', -4.5, 4.9, 'BAR', 'neon_pink', 0.34);
  awning(b, 's', 2, 8.5, 3.2, 2.0);
  facadeSign(b, 'w', -24, 4.8, 'LOFT', 'neon_blue', 0.24);
  cornerStrip(b, 'se', 'neon_pink', 0.5, 6.0);
  // roof garden
  box(-5.5, 6.4, -34.5, 5.5, 6.62, -29.5, { mat: 'wood_planks', top: 'wood_planks' });
  planter(-8, 6.4, -34, 2.2, 1.6);
  planter(8, 6.4, -34, 2.2, 1.6);
  planter(-8, 6.4, -22, 2.2, 1.6);
  planter(8, 6.4, -21.6, 2.2, 1.6);
  planter(0, 6.4, -25.5, 3.4, 1.2, false);
  // pergola
  for (const [px, pz] of [[-5, -34.2], [5, -34.2], [-5, -29.8], [5, -29.8]]) box(px - 0.12, 6.62, pz - 0.12, px + 0.12, 9.2, pz + 0.12, { mat: 'metal_dark' });
  box(-5.4, 9.2, -34.6, 5.4, 9.42, -29.4, { mat: 'metal_dark', top: 'metal_painted_yellow' });
  for (let k = 0; k < 6; k++) deco(-5.2 + k * 2.08, 9.42, -34.6, -5.0 + k * 2.08, 9.55, -29.4, { mat: 'wood_planks' });
  deco(-5.4, 9.05, -34.6, 5.4, 9.2, -34.5, { mat: 'neon_orange' });
  ac(-2.5, 6.4, -20.8, 0);
  vent(3.5, 6.4, -20.9, 1.3);
  billboard(0, 6.4, -37.1, 0, 7, 2.6, 'LOFT', 'neon_orange', 'neon_orange');
}

MARKS.push(['NE: "Exchange"', solids.length]);
// NE: "Exchange" plaster block, 9.6 m; rocket bridge leaves its south face
{
  const b = BLD.NE;
  shell(b, { base: 'concrete', mat: 'plaster' });
  trim(b, 'concrete_dark', 'concrete_dark');
  bands(b, [1, 2]);
  parapet(b, { w: gapC(-28), s: gapC(28), e: [[-30, -26]] }, { mat: 'concrete_dark', cap: 'concrete' });
  facadeSign(b, 'w', -33, 5.4, 'CLUB', 'neon_pink', 0.34);
  facadeSign(b, 's', 34.8, 8.6, '24', 'neon_blue', 0.28);
  cornerStrip(b, 'sw', 'neon_orange', 0.5, 9.0);
  tank(33, 9.6, -33);
  billboard(26, 9.6, -36.6, 0, 7.4, 3.0, 'BAR', 'neon_green', 'neon_green');
  ac(22, 9.6, -33, 0);
  ac(22, 9.6, -30.4, 0);
  ac(36, 9.6, -24, PI / 2);
  vent(24, 9.6, -21.4, 1.2);
  skylight(30, -23, 35, -20, 9.6);
  crateStack(21.5, 9.6, -25);
}

MARKS.push(['W: "Tannery', solids.length]);
// W: "Tannery Court" dark brick, 12.8 m; sniper-side stepping stone. Skybridges N and S, jump pad lands on its east edge
{
  const b = BLD.W;
  shell(b, { base: 'brick_dark', mat: 'brick_dark' });
  trim(b, 'concrete_dark', 'concrete_dark');
  bands(b, [1, 2, 3]);
  parapet(b, { s: gapC(-28), n: gapC(-28), e: [[-7.4, -0.6]] }, { mat: 'brick', cap: 'concrete_dark' });
  facadeSign(b, 'e', 5.5, 5.2, 'GAME', 'neon_green', 0.3);
  cornerStrip(b, 'ne', 'neon_blue', 0.5, 12.2);
  cornerStrip(b, 'se', 'neon_pink', 0.5, 12.2);
  // central penthouse the two bridges walk around
  box(-31.5, 12.8, -2.5, -24.5, 15.8, 2.5, { mat: 'concrete', top: 'metal_dark' });
  deco(-31.6, 14.9, -2.6, -24.4, 15.1, 2.6, { mat: 'neon_blue' });
  panel(-28, 14.0, 2.53, 1.6, 2.2, 0, 'metal_corrugated');
  tank(-34.6, 12.8, 6.4);
  ac(-21, 12.8, 5.5, 0);
  ac(-21, 12.8, 3.2, 0);
  vent(-21.5, 12.8, -5.5, 1.3);
  crateStack(-35, 12.8, -6.5, 0.2);
  skylight(-22.5, -3, -20, 0.4, 12.8);
}

MARKS.push(['E: "Meridian"', solids.length]);
// E: "Meridian" glass block, 9.6 m; the pavilion roof
{
  const b = BLD.E;
  shell(b, { base: 'metal_panel', mat: 'glass_window' });
  trim(b, 'metal_dark', 'metal_dark');
  parapet(b, { n: gapC(28), s: gapC(28), w: [[0.6, 7.4]] }, { mat: 'metal_dark', cap: 'metal_panel' });
  cornerStrip(b, 'nw', 'neon_blue', 0.5, 9.0);
  cornerStrip(b, 'sw', 'neon_pink', 0.5, 9.0);
  facadeSign(b, 'w', 0, 3.9, 'BAR', 'neon_blue', 0.3);
  // pavilion: four posts, glowing roof
  for (const [px, pz] of [[31, -5], [37, -5], [31, 5], [37, 5]]) box(px - 0.2, 9.6, pz - 0.2, px + 0.2, 13.0, pz + 0.2, { mat: 'metal_dark' });
  box(30.4, 13.0, -5.6, 37.6, 13.3, 5.6, { mat: 'metal_dark', top: 'metal_panel', bottom: 'light_panel' });
  deco(30.3, 12.85, -5.7, 37.7, 13.0, -5.55, { mat: 'neon_pink' });
  deco(30.3, 12.85, 5.55, 37.7, 13.0, 5.7, { mat: 'neon_pink' });
  box(33.2, 9.6, -1.1, 34.8, 10.6, 1.1, { mat: 'metal_dark', top: 'wood_planks' });   // bar counter
  ac(21.5, 9.6, -7, 0);
  ac(21.5, 9.6, 7, 0);
  vent(25, 9.6, -7.5, 1.3);
  vent(25, 9.6, 7.5, 1.3);
  planter(24, 9.6, 0, 1.2, 3.0, true);
}

MARKS.push(['SW: "Kessler', solids.length]);
// SW: "Kessler Works" concrete, 9.6 m
{
  const b = BLD.SW;
  shell(b, { base: 'concrete_dark', mat: 'concrete' });
  trim(b, 'metal_dark', 'metal_dark');
  bands(b, [1, 2]);
  parapet(b, { e: gapC(28), n: gapC(-28), s: [[-33, -29]] }, { mat: 'concrete_dark', cap: 'metal_dark' });
  facadeSign(b, 'e', 34, 5.6, 'HOTEL', 'neon_orange', 0.26);
  facadeSign(b, 'n', -33, 8.0, '24', 'neon_pink', 0.3);
  cornerStrip(b, 'ne', 'neon_orange', 0.5, 9.0);
  skylight(-36, 30, -31, 33, 9.6);
  skylight(-36, 22, -31, 24.5, 9.6);
  ac(-21.5, 9.6, 34, 0);
  ac(-21.5, 9.6, 31.5, 0);
  ac(-24, 9.6, 22.6, PI / 2);
  vent(-33, 9.6, 27.5, 1.6, 0.4);
  vent(-35, 9.6, 27.5, 1.2, 0.34);
  billboard(-28, 9.6, 36.6, PI, 7.4, 2.8, 'HOTEL', 'neon_blue', 'neon_blue');
  crateStack(-36, 9.6, 20.5, 0.3);
  tank(-22.5, 9.6, 34.2);
}

MARKS.push(['S: "Market', solids.length]);
// S: "Market Hall" plaster block, 6.4 m; fire escape on its east face
{
  const b = BLD.S;
  shell(b, { base: 'brick', mat: 'plaster' });
  trim(b, 'concrete', 'concrete_dark');
  bands(b, [1]);
  parapet(b, { n: [[-3.5, 3.5]], e: [[29.7, 32.7]], w: gapC(28) }, { mat: 'concrete', cap: 'concrete_dark' });
  facadeSign(b, 'n', 4.5, 4.9, 'BAR', 'neon_blue', 0.34);
  awning(b, 'n', -8.5, -2, 3.2, 2.0, 'metal_dark', 'neon_blue');
  facadeSign(b, 'w', 22, 4.6, 'OPEN', 'neon_green', 0.22);
  cornerStrip(b, 'nw', 'neon_blue', 0.5, 6.0);
  // beer garden: containers, tables, planters
  add({ type: 'container', pos: [-3.2, 7.7, 25], rot: PI / 2, color: 'orange' });
  add({ type: 'container', pos: [5.2, 7.7, 34.8], rot: 0, color: 'blue' });
  box(-6.5, 6.4, 32, -1.5, 7.3, 33.5, { mat: 'metal_dark', top: 'wood_planks' });
  box(0.5, 6.4, 21.6, 4.5, 6.85, 23.2, { mat: 'wood_planks' });
  planter(-8, 6.4, 22, 2.2, 1.6);
  planter(8, 6.4, 22, 2.2, 1.6);
  planter(-8.2, 6.4, 35.4, 1.8, 1.4);
  ac(-3.5, 6.4, 35.4, 0);
  vent(2.5, 6.4, 27.6, 1.3);
  billboard(0, 6.4, 37.1, PI, 7, 2.6, 'OPEN', 'neon_green', 'neon_green');
}

MARKS.push(['SE: "Halcyon"', solids.length]);
// SE: "Halcyon" glass tower, 12.8 m
{
  const b = BLD.SE;
  shell(b, { base: 'concrete_dark', mat: 'glass_window' });
  trim(b, 'metal_dark', 'concrete_dark');
  parapet(b, { n: gapC(28), w: [[25.5, 30.5]] }, { mat: 'metal_dark', cap: 'metal_panel' });
  cornerStrip(b, 'nw', 'neon_pink');
  cornerStrip(b, 'ne', 'neon_blue');
  cornerStrip(b, 'sw', 'neon_blue');
  facadeSign(b, 'n', 33, 6.0, 'CLUB', 'neon_pink', 0.32);
  facadeSign(b, 'w', 33, 8.6, '24', 'neon_orange', 0.3);
  // lounge: sunken-look bar with a glowing counter, planters, mast
  box(30.5, 12.8, 31, 36.5, 13.9, 33, { mat: 'metal_dark', top: 'wood_planks' });
  deco(30.5, 13.9, 31, 36.5, 14.0, 31.1, { mat: 'neon_pink' });
  box(30.5, 12.8, 22, 36.5, 13.15, 24, { mat: 'metal_dark', top: 'wood_planks' });
  planter(21.5, 12.8, 34.5, 2.4, 1.4);
  planter(21.5, 12.8, 21.5, 2.4, 1.4);
  planter(35.5, 12.8, 27.5, 1.3, 3.6);
  antenna(36.4, 12.8, 36.4, 10);
  antenna(22.4, 12.8, 36.4, 6);
  ac(24.5, 12.8, 36, 0);
  ac(27.5, 12.8, 36, 0);
  vent(24, 12.8, 25.5, 1.4);
  skylight(23, 28.6, 27, 32, 12.8, 'light_panel');
  billboard(28, 12.8, 37.1, PI, 8.4, 3.2, 'SKY', 'neon_blue', 'neon_blue');
}

// ------------------------------------------------------------------------------------------------ escapes + skybridges
MARKS.push(['const escN', solids.length]);
const escN = escapeZ(-11.35, -14.5, -1, 2, -1);       // N: heads north along its west facade
const escS = escapeZ(11.35, 14.5, 1, 2, 1);           // S: heads south along its east facade
void escN; void escS;
bridge('x', -28, 10, 18, 6.4, 9.6, 'neon_blue');       // N  > NE
bridge('z', 28, -18, -10, 9.6, 9.6, 'neon_orange');    // NE > E  (flat, rocket launcher)
bridge('z', 28, 10, 18, 9.6, 12.8, 'neon_blue');       // E  > SE
bridge('x', 28, -10, -18, 6.4, 9.6, 'neon_pink');      // S  > SW
bridge('z', -28, 18, 10, 9.6, 12.8, 'neon_pink');      // SW > W
bridge('z', -28, -10, -18, 12.8, 16, 'neon_pink');     // W  > NW

// ------------------------------------------------------------------------------------------------ street level dressing
MARKS.push(['vehicles', solids.length]);
// vehicles
car(-14.6, -26, 0.03, 'metal_painted_yellow');
car(14.4, -33, -0.05, 'metal_panel', 'van');
car(-14.3, 26.5, 0.0, 'metal_dark');
car(14.6, 24, 0.04, 'metal_painted_yellow');
car(-26, -14.5, PI / 2 + 0.03, 'metal_panel', 'van');
car(33, -14.2, PI / 2, 'metal_dark');
car(26, 14.6, PI / 2 - 0.04, 'metal_painted_yellow');
car(-32, 14.3, PI / 2, 'metal_dark');
car(41, -12, 0.02, 'metal_panel', 'van');
car(-41, 14, 0.0, 'metal_painted_yellow');
car(12, 41, PI / 2, 'metal_dark');
car(-14, -41, PI / 2, 'metal_painted_yellow');
MARKS.push(['street lights', solids.length]);
// street lights on the road edges
for (const [x, z, dx, dz] of [
  [-11.6, -30, -1, 0], [11.6, -22, 1, 0], [-16.4, 22, 1, 0], [16.4, 30, -1, 0],
  [-30, -11.6, 0, -1], [22, -16.4, 0, 1], [30, 11.6, 0, -1], [-22, 16.4, 0, 1],
  [-11.6, 0, -1, 0], [11.6, 0, 1, 0], [0, -11.6, 0, -1], [0, 11.6, 0, 1],
]) streetlight(x, z, dx, dz, (x + z) % 2 ? 'neon_orange' : 'neon_pink');
MARKS.push(['barriers, dumpsters', solids.length]);
// barriers, dumpsters, shelters, kiosks
barrier(-13.5, -21, 0.1);
barrier(13.5, 20.5, -0.1);
barrier(-22, -13.6, PI / 2);
barrier(22, 13.6, PI / 2);
barrier(-13.5, 34, 0);
barrier(13.5, -36, 0);
dumpster(-17.2, -31, 0);
dumpster(17.2, 32, 0, 'container_orange');
dumpster(-40.2, 24, 0);
dumpster(40.2, -26, 0, 'container_blue');
dumpster(24, 40.2, PI / 2);
dumpster(-24, -40.2, PI / 2, 'container_orange');
busShelter(-16.6, 4, PI / 2);
busShelter(16.6, -4, -PI / 2);
kiosk(-5.6, -15.5, 0, 'neon_pink');
kiosk(5.6, 15.5, PI, 'neon_blue');
MARKS.push(['ring alley: container', solids.length]);
// ring alley: container chicanes and steam vents
add({ type: 'container', pos: [41, 1.3, 0], rot: 0, color: 'red' });
add({ type: 'container', pos: [41, 3.9, 0.2], rot: 0.05, color: 'white' });
add({ type: 'container', pos: [-41, 1.3, 0], rot: 0, color: 'blue' });
add({ type: 'container', pos: [0, 1.3, -41], rot: PI / 2, color: 'yellow' });
add({ type: 'container', pos: [0, 1.3, 41], rot: PI / 2, color: 'green' });
add({ type: 'container', pos: [0, 3.9, 41.1], rot: PI / 2 + 0.04, color: 'orange' });
for (const [x, z] of [[40.5, 39.5], [-40.5, -39.5], [-40.5, 39.5], [40.5, -39.5]]) {
  cyl(x, 0, z, 0.55, 1.0, { mat: 'metal_dark', sides: 10 });
  cyl(x, 1.0, z, 0.62, 0.14, { mat: 'hazard', sides: 10, collide: false });
}
crateStack(-40.6, 0, -18, 0.1);
crateStack(40.6, 0, 20, -0.1);
crateStack(-19, 0, 40.6, PI / 2);
crateStack(20, 0, -40.6, PI / 2);

MARKS.push(['distant city', solids.length]);
// ------------------------------------------------------------------------------------------------ distant city (no collision)
{
  const r = rng(7);
  const mats = ['glass_window', 'glass_window', 'concrete_dark', 'glass_window', 'brick_dark'];
  const spots = [];
  for (let i = -6; i <= 6; i++) {
    spots.push([i * 17 + (r() - 0.5) * 6, -66 - r() * 26]);
    spots.push([i * 17 + (r() - 0.5) * 6, 66 + r() * 26]);
    spots.push([-66 - r() * 26, i * 17 + (r() - 0.5) * 6]);
    spots.push([66 + r() * 26, i * 17 + (r() - 0.5) * 6]);
  }
  spots.forEach(([x, z], i) => {
    const w = 12 + r() * 12, d = 12 + r() * 12;
    const h = FL * Math.round((7 + r() * 16) / 1);   // 22 .. 73 m
    const m = mats[i % mats.length];
    box(x - w / 2, -1, z - d / 2, x + w / 2, h, z + d / 2, { mat: m, collide: false, shadow: false });
    if (i % 3 === 0) {
      deco(x - w / 2 - 0.05, h - 1.2, z - d / 2 - 0.05, x + w / 2 + 0.05, h - 0.9, z + d / 2 + 0.05, { mat: i % 2 ? 'neon_pink' : 'neon_blue', shadow: false });
    }
    if (i % 4 === 1) cyl(x, h, z, 0.25, 8 + r() * 8, { mat: 'metal_dark', sides: 5, collide: false, shadow: false });
  });
  box(-330, -6, -330, 330, -0.6, 330, { mat: 'asphalt', collide: false, shadow: false });
}

// ------------------------------------------------------------------------------------------------ definition
export default {
  id: 'skyline',
  name: 'Skyline',
  subtitle: 'Rooftops - Dusk',
  description: 'A neon-lit rooftop city at dusk. Wall-run the alleys, grapple the Spire billboard, chain skybridges between roofs and fight for the rocket launcher on the open bridge.',
  colors: ['#5b2a86', '#ff5f7e'],
  bounds: { min: [-46, -4, -46], max: [46, TOP_Y, 46] },
  killY: -20,
  previewCamera: { pos: [-62, 34, 64], lookAt: [2, 5, -2] },
  theme: {
    sky: { top: '#0b0d33', horizon: '#ff6a6a', bottom: '#2a1240', sunColor: '#ffb070', sunSize: 1.7, stars: 0.5, clouds: 0.45 },
    sun: { dir: [-0.78, 0.3, 0.42], color: '#ff9c5e', intensity: 2.7 },
    hemi: { sky: '#8a72e0', ground: '#3b2148', intensity: 0.78 },
    fog: { color: '#8a4680', near: 60, far: 270 },
    exposure: 1.08,
    envIntensity: 0.65,
    bloom: { strength: 0.75, radius: 0.55, threshold: 0.8 },
  },
  solids,
  lights: [
    { pos: [0, 4.5, 4], color: '#4fdcff', intensity: 85, distance: 30 },
    { pos: [-26, 7, -14], color: '#ff3d95', intensity: 70, distance: 28 },
    { pos: [26, 11, -14], color: '#ff9a3c', intensity: 75, distance: 26 },
    { pos: [0, 8, 24], color: '#9a6bff', intensity: 60, distance: 28 },
  ],
  spawns: [
    // street level
    { pos: [-28, 0, -14], lookAt: [0, 0, -14] },
    { pos: [34, 0, -14], lookAt: [0, 0, -14] },
    { pos: [-34, 0, 14], lookAt: [0, 0, 14] },
    { pos: [28, 0, 14], lookAt: [0, 0, 14] },
    { pos: [-14, 0, -30], lookAt: [-14, 0, 0] },
    { pos: [14, 0, -28], lookAt: [14, 0, 0] },
    { pos: [-14, 0, 30], lookAt: [-14, 0, 0] },
    { pos: [14, 0, 32], lookAt: [14, 0, 0] },
    { pos: [-6, 0, -41], lookAt: [30, 0, -41] },
    { pos: [6, 0, 41], lookAt: [-30, 0, 41] },
    // rooftops
    { pos: [4, 6.4, -34], lookAt: [0, 6.4, -24] },
    { pos: [30, 9.6, -32], lookAt: [26, 9.6, -20] },
    { pos: [24, 9.6, -2], lookAt: [34, 9.6, 0] },
    { pos: [26, 12.8, 33], lookAt: [26, 12.8, 20] },
    { pos: [-4, 6.4, 22], lookAt: [0, 6.4, 34] },
    { pos: [-30, 9.6, 21], lookAt: [-30, 9.6, 34] },
    { pos: [-35, 12.8, -8], lookAt: [-28, 12.8, 0] },
    { pos: [-24, 16, -34], lookAt: [-28, 16, -20] },
  ],
  pickups: [
    { type: 'weapon', weapon: 'rocket', pos: [28, 9.6, -14] },
    { type: 'weapon', weapon: 'sniper', pos: [-35, 16, -35] },
    { type: 'weapon', weapon: 'shotgun', pos: [-41, 0, 8] },
    { type: 'armor', pos: [0, 0.5, 4.0] },
    { type: 'armor', pos: [-30, 9.6, 34.5] },
    { type: 'health', pos: [0, 6.4, -32], amount: 50 },
    { type: 'health', pos: [34, 9.6, 8], amount: 25 },
    { type: 'health', pos: [-28, 0, 14], amount: 25 },
    { type: 'health', pos: [41, 0, 12], amount: 25 },
    { type: 'ammo', pos: [22, 9.6, -20] },
    { type: 'ammo', pos: [33, 12.8, 24] },
    { type: 'ammo', pos: [-14, 0, 12] },
    { type: 'ammo', pos: [14, 0, -12] },
    { type: 'grenades', pos: [-21, 12.8, 8], amount: 2 },
    { type: 'grenades', pos: [12, 0, 32], amount: 2 },
  ],
  jumpPads: [
    { pos: [14.5, 0, 4], target: [24, 9.6, 4], apex: 3 },
    { pos: [-14.5, 0, -4], target: [-24, 12.8, -4], apex: 5 },
    { pos: [0, 0, -14.5], target: [0, 6.4, -24], apex: 3 },
    { pos: [0, 0, 14.5], target: [0, 6.4, 24], apex: 3 },
  ],
};
MARKS.push(['DEBUGCOUNT', solids.length]);
// DEBUGCOUNT
globalThis.__SKY = (() => { const c = {}; for (const s of solids) { const k = s.type + ':' + (s.mat || '-'); c[k] = (c[k] || 0) + 1; } return Object.entries(c).sort((a, b) => b[1] - a[1]).slice(0, 30); })();

globalThis.__MARKS = MARKS;
