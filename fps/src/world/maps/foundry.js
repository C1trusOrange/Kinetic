// "Foundry": an open-air steel foundry yard at night.  ~100 x 88 m.
//
//   x: west(-) .. east(+)   z: north(-) .. south(+)   y: up.
//
//   Centre        Smelting hall (x -18..18, z -22..10): furnace + 24 m chimney, ring catwalk at y 5,
//                 crane-operator galleries at y 9.5, roof trusses at y 13.
//   South (z 22)  Rail trench, 8 m wide and 4 m deep, 80 m long: two tall flat concrete walls = the
//                 signature wall-run corridor. Ramps at both ends, two concrete bridges, crane girder at 9.5 m.
//   z 16, y 5     South gantry: catwalk from the hall's south door out over the forecourt, turning north
//                 along the east rack. Jump pads lift you out of the trench onto it.
//   West          Container canyon: two rows of 1-3 high stacks, bridged at y 5.25.
//   North         Gantry crane (girders at 13 m) over an open yard, cover, ladle stage.
//   North-east    Tank farm: two 10 m tanks joined by a sky catwalk (sniper perch), a stairs tank at y 5, jump pads.
//   South-east    Slag shed with a roof arena.   South: control shack, scrap yard.
//
// Bots reach every tier by stairs / ramps (or the jump pads); wall-runs, grapple lines and container tops
// are player bonuses.

const solids = [];
const add = s => { solids.push(s); return s; };
const box = (a, b, o = {}) => add({
  type: 'box',
  min: [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.min(a[2], b[2])],
  max: [Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.max(a[2], b[2])],
  ...o,
});
const PI = Math.PI;

// ------------------------------------------------------------------------------------------ helpers

/** Wall run along X (axis 'x', fixed z = at) or along Z (axis 'z', fixed x = at) with rectangular openings. */
function wallRun(axis, at, a0, a1, y0, h, t, mat, ops = [], o = {}) {
  const list = ops.slice().sort((p, q) => p.c - q.c);
  const top = y0 + h;
  const seg = (s0, s1, ya, yb) => {
    if (s1 - s0 < 0.02 || yb - ya < 0.02) return;
    if (axis === 'x') box([s0, ya, at - t / 2], [s1, yb, at + t / 2], { mat, ...o });
    else box([at - t / 2, ya, s0], [at + t / 2, yb, s1], { mat, ...o });
  };
  let cur = a0;
  for (const op of list) {
    const s0 = op.c - op.w / 2, s1 = op.c + op.w / 2;
    seg(cur, s0, y0, top);
    seg(s0, s1, y0, Math.min(op.y0 ?? y0, top));
    seg(s0, s1, Math.max(op.y1, y0), top);
    cur = s1;
  }
  seg(cur, a1, y0, top);
}

/** Decorative frame around an opening (both wall faces): hazard jambs, painted lintel, glowing strip. */
function trimOpening(axis, at, t, op, style = 'door') {
  const a0 = op.c - op.w / 2, a1 = op.c + op.w / 2, p = 0.14, jw = 0.45;
  const y0 = op.y0 ?? 0;
  const M = (s0, s1, ya, yb, extra) => (axis === 'x'
    ? box([s0, ya, at - t / 2 - p], [s1, yb, at + t / 2 + p], { collide: false, ...extra })
    : box([at - t / 2 - p, ya, s0], [at + t / 2 + p, yb, s1], { collide: false, ...extra }));
  if (style === 'door') {
    M(a0 - jw, a0 + 0.03, y0, op.y1 + 0.4, { mat: 'hazard' });
    M(a1 - 0.03, a1 + jw, y0, op.y1 + 0.4, { mat: 'hazard' });
    M(a0 - jw, a1 + jw, op.y1 - 0.04, op.y1 + 0.4, { mat: 'metal_painted_yellow' });
    // glowing strip above the lintel, both faces
    const off = t / 2 + p + 0.03;
    for (const s of [-1, 1]) {
      if (axis === 'x') glow(op.c, op.y1 + 0.75, at + s * off, op.w + 0.6, 0.22, 0, s);
      else glow(at + s * off, op.y1 + 0.75, op.c, op.w + 0.6, 0.22, s, 0);
    }
  } else {
    M(a0 - 0.3, a1 + 0.3, op.y1 - 0.04, op.y1 + 0.3, { mat: 'metal_painted_yellow' });
    M(a0 - 0.3, a1 + 0.3, y0 - 0.3, y0 + 0.04, { mat: 'metal_dark' });
  }
}

/** Emissive panel on a surface whose outward normal is (nx, nz). */
function glow(x, y, z, w, h, nx, nz, mat = 'neon_orange') {
  return add({ type: 'panel', pos: [x, y, z], size: [w, h], rot: Math.atan2(nx, nz), mat });
}

/** Railing between two points (axis aligned) with optional gaps given as [c0, c1] ranges in world coords of the long axis. */
function rail(a, b, gaps = [], o = {}) {
  const k = Math.abs(b[0] - a[0]) >= Math.abs(b[2] - a[2]) ? 0 : 2;
  if (b[k] < a[k]) { const t = a; a = b; b = t; }
  const ranges = gaps.slice().sort((p, q) => p[0] - q[0]);
  const at = c => {
    const f = (c - a[k]) / (b[k] - a[k]);
    return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
  };
  const seg = (c0, c1) => { if (c1 - c0 >= 0.4) add({ type: 'railing', from: at(c0), to: at(c1), ...o }); };
  let cur = a[k];
  for (const [g0, g1] of ranges) { seg(cur, Math.min(g0, b[k])); cur = Math.max(cur, g1); }
  seg(cur, b[k]);
}

/** Catwalk deck without rails (rails are added separately so gaps can be cut where stairs / pads land). */
function deck(a, b, w = 3, o = {}) {
  return add({ type: 'catwalk', from: a, to: b, width: w, railings: 'none', ...o });
}

const pillar = (x, z, y0, y1, r = 0.4, o = {}) => add({ type: 'pillar', pos: [x, (y0 + y1) / 2, z], radius: r, height: y1 - y0, sides: 8, ...o });
const cyl = (x, y0, z, r, h, o = {}) => add({ type: 'cylinder', pos: [x, y0 + h / 2, z], radius: r, height: h, ...o });
const pipe = (axis, x, y, z, len, r, mat = 'metal_rust', o = {}) => add({ type: 'cylinder', pos: [x, y, z], radius: r, height: len, sides: 8, axis, mat, ...o });
const crate = (x, y, z, s = 1.2, rot = 0) => add({ type: 'crate', pos: [x, y + (Array.isArray(s) ? s[1] : s) / 2, z], size: s, rot });
const barrel = (x, z, y = 0, mat = 'container_orange') => add({ type: 'cylinder', pos: [x, y + 0.55, z], radius: 0.42, height: 1.1, sides: 10, mat, top: 'metal_dark' });
const cont = (x, y, z, color, rot = 0) => add({ type: 'container', pos: [x, y, z], rot, color });
/** K-rail / low concrete barrier (1 m high) centred at x,z; rot 0 = long along X. */
const kbarrier = (x, z, rot = 0, len = 3, h = 1.0) => add({ type: 'box', pos: [x, h / 2, z], size: [len, h, 0.6], rot, mat: 'concrete', bevel: 0.1, top: 'concrete_dark' });

/** I-beam along X (axis 'x', fixed z = at) or Z. `top` is the y of the upper flange's top face. */
function girder(axis, at, s0, s1, top, depth, width, o = {}) {
  const mat = o.mat || 'metal_dark', topMat = o.top || 'metal_painted_yellow';
  const bot = top - depth, fl = Math.min(0.18, depth * 0.16), hw = width / 2, web = Math.min(0.32, width * 0.32) / 2;
  const B = (y0, y1, h, top2) => (axis === 'x'
    ? box([s0, y0, at - h], [s1, y1, at + h], { mat, top: top2 })
    : box([at - h, y0, s0], [at + h, y1, s1], { mat, top: top2 }));
  B(top - fl, top, hw, topMat);
  B(bot, bot + fl, hw, mat);
  B(bot + fl, top - fl, web, mat);
}

/** Hanging industrial lamp with an emissive underside. */
function lamp(x, y, z, r = 0.55, drop = 0.7) {
  add({ type: 'cylinder', pos: [x, y, z], radius: r, radiusTop: r * 0.4, height: 0.5, sides: 8, mat: 'metal_dark', bottom: 'light_panel' });
  add({ type: 'cylinder', pos: [x, y + 0.25 + drop / 2, z], radius: 0.05, height: drop, sides: 4, mat: 'metal_dark', collide: false });
}

/** Floodlight mast: pole, lamp head aimed along (nx, nz), emissive face (3 solids). */
function mast(x, z, h, nx, nz, y0 = 0) {
  const l = Math.hypot(nx, nz) || 1;
  nx /= l; nz /= l;
  const rot = Math.atan2(nx, nz);
  add({ type: 'cylinder', pos: [x, y0 + h / 2, z], radius: 0.2, height: h, sides: 8, mat: 'metal_dark', radiusTop: 0.14 });
  const hx = x + nx * 0.45, hz = z + nz * 0.45;
  add({ type: 'box', pos: [hx, y0 + h + 0.15, hz], size: [2.3, 0.6, 0.5], rot, mat: 'metal_dark', collide: false });
  add({ type: 'panel', pos: [hx + nx * 0.26, y0 + h + 0.15, hz + nz * 0.26], size: [2.1, 0.44], rot, mat: 'light_panel' });
}

/** Round tank with reinforcing bands (cylinder + rings). Walkable flat top at y0 + h. */
function tank(x, z, r, h, o = {}) {
  add({ type: 'cylinder', pos: [x, h / 2, z], radius: r, height: h, sides: 20, mat: o.mat || 'metal_corrugated', top: o.top || 'metal_panel', bottom: 'metal_dark', flat: false });
  const bands = o.bands || [0.9, h * 0.5, h - 0.7];
  for (const y of bands) add({ type: 'cylinder', pos: [x, y, z], radius: r + 0.09, height: 0.32, sides: 20, mat: 'metal_dark', collide: false, flat: false });
  add({ type: 'cylinder', pos: [x, h + 0.09, z], radius: r + 0.14, height: 0.18, sides: 20, mat: 'metal_dark', top: 'metal_dark', collide: false, flat: false });
}

/** Polygonal railing around a circular platform; `gapDeg` = [[a0, a1], ...] angular gaps (degrees, 0 = +x, CCW from above). */
function ringRail(cx, cz, y, r, n = 12, gapDeg = []) {
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * 360, a1 = ((i + 1) / n) * 360, mid = (a0 + a1) / 2;
    if (gapDeg.some(([g0, g1]) => mid >= g0 && mid <= g1)) continue;
    const p = a => [cx + Math.cos(a * PI / 180) * r, y, cz + Math.sin(a * PI / 180) * r];
    add({ type: 'railing', from: p(a0), to: p(a1) });
  }
}

/** Row of containers stepping +Z (long axis Z) from z0, `levels[i]` high (0 = gap). */
function contRow(x, z0, levels, palette, seed = 0) {
  levels.forEach((lv, i) => {
    for (let l = 0; l < lv; l++) {
      const dx = (((i * 7 + l * 3 + seed) % 5) - 2) * 0.07;
      cont(x + (l ? dx : 0), 1.3 + l * 2.6, z0 + i * 6.1, palette[(i + l * 2 + seed) % palette.length], 0);
    }
  });
}

const PAL = ['red', 'blue', 'green', 'yellow', 'white', 'orange'];

// ------------------------------------------------------------------------------------------ ground

const CF = 'concrete_floor';
function slab(x0, z0, x1, z1, top = CF, y0 = -5, y1 = 0, mat = 'concrete_dark') {
  box([x0, y0, z0], [x1, y1, z1], { mat, top });
}
slab(-50, -45, 50, -22);                    // north yard
slab(-50, -22, -18, 22);                    // west band
slab(18, -22, 50, 22);                      // east band
slab(-18, -22, 18, 10, 'metal_panel');      // hall floor
slab(-18, 10, 18, 22, 'asphalt');           // forecourt road
slab(-50, 30, 50, 45);                      // south yard
slab(-50, 22, -40, 30);                     // trench end blocks
slab(40, 22, 50, 30);
box([-40, -6, 22], [40, -4, 30], { mat: 'concrete_dark', top: CF });   // trench floor (y -4)
add({ type: 'ramp', pos: [-35, -2, 26], size: [10, 4, 8], dir: '-x', mat: 'concrete_dark', top: 'asphalt' });
add({ type: 'ramp', pos: [35, -2, 26], size: [10, 4, 8], dir: '+x', mat: 'concrete_dark', top: 'asphalt' });

// flush overlays (visual only): asphalt lanes, hazard borders
const overlay = (x0, z0, x1, z1, mat, y = 0) => box([x0, y, z0], [x1, y + 0.03, z1], { mat, collide: false, shadow: false });
overlay(-49, -30, 26, -26, 'asphalt');                   // north yard crane road
overlay(-49, 3, -18, 8, 'asphalt');                      // west road
overlay(18, -6, 49, -2, 'asphalt');                      // east road
overlay(-40, 22, 40, 23.2, 'hazard', -4);                // trench wall bases
overlay(-40, 28.8, 40, 30, 'hazard', -4);
overlay(-40, 21.2, 40, 22, 'hazard');                    // trench lip warning stripes
overlay(-40, 30, 40, 30.8, 'hazard');
for (const z of [-24.5, 12]) {                           // hall door aprons
  overlay(-4.5, z - 1.5, 4.5, z + 1.5, 'hazard');
}
overlay(-25, -19.5, -21.5, -12.5, 'hazard'); overlay(21.5, 0.5, 25, 7.5, 'hazard');

// ------------------------------------------------------------------------------------------ boundary

const BW = 16;
for (const [x0, z0, x1, z1] of [[-50, -45, 50, -44], [-50, 44, 50, 45], [-50, -44, -49, 44], [49, -44, 50, 44]]) {
  box([x0, 0, z0], [x1, 6, z1], { mat: 'concrete_dark' });
  box([x0, 6, z0], [x1, BW, z1], { mat: 'metal_corrugated', top: 'metal_dark' });
}
// invisible extensions (players can grapple / rocket-jump but never leave the volume)
box([-51, BW, -46], [51, 36, -44], { visible: false });
box([-51, BW, 44], [51, 36, 46], { visible: false });
box([-51, BW, -46], [-49, 36, 46], { visible: false });
box([49, BW, -46], [51, 36, 46], { visible: false });
// inner pilasters, glowing seam, floodlight panels
for (let i = 0; i < 7; i++) {
  const x = -37.5 + i * 12.5;
  box([x - 0.6, 0, -44.55], [x + 0.6, BW, -44], { mat: 'concrete', collide: false });
  box([x - 0.6, 0, 44], [x + 0.6, BW, 44.55], { mat: 'concrete', collide: false });
}
for (let i = 0; i < 4; i++) {
  const x = -43.75 + i * 25;
  glow(x, 10.6, -43.97, 3.6, 1.0, 0, 1, 'light_panel');
  glow(x + 12.5, 10.6, 43.97, 3.6, 1.0, 0, -1, 'light_panel');
}
for (let i = 0; i < 5; i++) {
  const z = -29.3 + i * 14.65;
  box([-49.55, 0, z - 0.6], [-49, BW, z + 0.6], { mat: 'concrete', collide: false });
  box([49, 0, z - 0.6], [49.55, BW, z + 0.6], { mat: 'concrete', collide: false });
}
for (let i = 0; i < 3; i++) {
  const z = -36.6 + i * 29.3;
  glow(-48.97, 10.6, z, 3.6, 1.0, 1, 0, 'light_panel');
  glow(48.97, 10.6, z + 14.65, 3.6, 1.0, -1, 0, 'light_panel');
}
box([-49, 0, -44.06], [49, 0.55, -44], { mat: 'hazard', collide: false });
box([-49, 0, 44], [49, 0.55, 44.06], { mat: 'hazard', collide: false });
box([-49.06, 0, -44], [-49, 0.55, 44], { mat: 'hazard', collide: false });
box([49, 0, -44], [49.06, 0.55, 44], { mat: 'hazard', collide: false });
glow(0, 6.25, -43.96, 96, 0.28, 0, 1);
glow(0, 6.25, 43.96, 96, 0.28, 0, -1);
glow(-48.96, 6.25, 0, 86, 0.28, 1, 0);
glow(48.96, 6.25, 0, 86, 0.28, -1, 0);

// ------------------------------------------------------------------------------------------ smelting hall

const HW = 12;
const N_OPS = [
  { c: 0, w: 8, y0: 0, y1: 7.5 },
  { c: -11, w: 3.6, y0: 6, y1: 9 },
  { c: 11, w: 3.6, y0: 6, y1: 9 },
];
const W_OPS = [
  { c: -16, w: 7, y0: 0, y1: 7.5 },
  { c: -2, w: 3.6, y0: 6, y1: 9 },
  { c: 6, w: 3.6, y0: 6, y1: 9 },
];
const E_OPS = [
  { c: 4, w: 7, y0: 0, y1: 7.5 },
  { c: -10, w: 3.6, y0: 6, y1: 9 },
  { c: -18, w: 3.6, y0: 6, y1: 9 },
];
wallRun('x', -21.5, -18, 18, 0, HW, 1, 'metal_corrugated', N_OPS, { top: 'metal_dark' });
wallRun('x', 9.5, -18, 18, 0, HW, 1, 'metal_corrugated', N_OPS, { top: 'metal_dark' });
wallRun('z', -17.5, -21, 9, 0, HW, 1, 'metal_corrugated', W_OPS, { top: 'metal_dark' });
wallRun('z', 17.5, -21, 9, 0, HW, 1, 'metal_corrugated', E_OPS, { top: 'metal_dark' });
// concrete plinth (visual) + trims
wallRun('x', -21.5, -18.15, 18.15, 0, 1.3, 1.3, 'concrete_dark', N_OPS, { collide: false, top: 'concrete' });
wallRun('x', 9.5, -18.15, 18.15, 0, 1.3, 1.3, 'concrete_dark', N_OPS, { collide: false, top: 'concrete' });
wallRun('z', -17.5, -21, 9, 0, 1.3, 1.3, 'concrete_dark', W_OPS, { collide: false, top: 'concrete' });
wallRun('z', 17.5, -21, 9, 0, 1.3, 1.3, 'concrete_dark', E_OPS, { collide: false, top: 'concrete' });
for (const op of N_OPS) { trimOpening('x', -21.5, 1, op, op.y0 ? 'window' : 'door'); trimOpening('x', 9.5, 1, op, op.y0 ? 'window' : 'door'); }
for (const op of W_OPS) trimOpening('z', -17.5, 1, op, op.y0 ? 'window' : 'door');
for (const op of E_OPS) trimOpening('z', 17.5, 1, op, op.y0 ? 'window' : 'door');
// vertical ribs on the outer faces
for (const x of [-15.5, -6.8, 6.8, 15.5]) {
  box([x - 0.25, 1.3, -22.25], [x + 0.25, 11.9, -22], { mat: 'metal_dark', collide: false });
  box([x - 0.25, 1.3, 10], [x + 0.25, 11.9, 10.25], { mat: 'metal_dark', collide: false });
}
for (const z of [-8.2, 2]) box([-18.25, 1.3, z - 0.25], [-18, 11.9, z + 0.25], { mat: 'metal_dark', collide: false });
for (const z of [-14, -3.8]) box([18, 1.3, z - 0.25], [18.25, 11.9, z + 0.25], { mat: 'metal_dark', collide: false });
// wall cap band + big signage
for (const [x, z, nx, nz] of [[0, -22.03, 0, -1], [0, 10.03, 0, 1]]) {
  glow(x, 10.6, z, 18, 0.5, nx, nz);
  glow(x - 10, 11.2, z, 5, 0.3, nx, nz, 'neon_blue'); glow(x + 10, 11.2, z, 5, 0.3, nx, nz, 'neon_blue');
}
glow(-18.03, 10.6, -6, 24, 0.5, -1, 0);
glow(18.03, 10.6, -6, 24, 0.5, 1, 0);

// ---- floor details: furnace hazard ring + glowing channels
cyl(0, 0, -6, 6.9, 0.22, { sides: 28, mat: 'hazard', top: 'hazard' });
for (const [x0, z0, x1, z1] of [[-0.35, -21, 0.35, -12.9], [-0.35, 0.9, 0.35, 9], [-17, -6.35, -6.9, -5.65], [6.9, -6.35, 17, -5.65]]) {
  box([x0, 0, z0], [x1, 0.035, z1], { mat: 'neon_orange', collide: false, shadow: false });
}

// ---- furnace
cyl(0, 0.2, -6, 5.7, 1.0, { sides: 22, mat: 'concrete_dark', top: 'concrete_dark' });
cyl(0, 1.1, -6, 5.0, 7.2, { sides: 24, mat: 'metal_dark', top: 'metal_dark' });
for (const y of [3.2, 6.3]) cyl(0, y, -6, 5.09, 0.3, { sides: 24, mat: 'neon_orange', collide: false });
cyl(0, 8.3, -6, 4.6, 5.0, { radiusTop: 3.1, sides: 20, mat: 'metal_rust' });
cyl(0, 13.3, -6, 2.6, 12, { radiusTop: 2.0, sides: 16, mat: 'metal_rust' });
for (const y of [15.5, 19.5, 23.2]) cyl(0, y, -6, 2.5 - (y - 13.3) * 0.05, 0.4, { sides: 16, mat: 'metal_dark', collide: false });
cyl(0, 25.2, -6, 2.15, 0.45, { sides: 16, mat: 'neon_orange', collide: false });
add({ type: 'cylinder', pos: [0, 27.1, -6], radius: 1.7, radiusTop: 0, height: 3.4, sides: 12, mat: 'neon_orange', collide: false });
for (const [nx, nz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
  // furnace mouths: frame + glowing slot
  const px = nx * 5.05, pz = -6 + nz * 5.05, rot = Math.atan2(nx, nz);
  add({ type: 'box', pos: [px, 2.5, pz], size: [2.2, 3.1, 0.7], rot, mat: 'metal_dark', collide: false });
  add({ type: 'panel', pos: [px + nx * 0.37, 2.2, pz + nz * 0.37], size: [1.5, 2.3], rot, mat: 'neon_orange' });
  add({ type: 'panel', pos: [px + nx * 0.37, 3.95, pz + nz * 0.37], size: [1.9, 0.3], rot, mat: 'neon_orange' });
}
// pipes leaving the bell
for (const [nx, nz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
  add({ type: 'cylinder', pos: [nx * 3.9, 6.2, -6 + nz * 3.9], radius: 0.28, height: 4.4, sides: 8, mat: 'metal_rust', collide: false });
}

// ---- ladles on rails
for (const sx of [-1, 1]) {
  add({ type: 'box', pos: [sx * 8.9, 0.32, -6], size: [3.4, 0.64, 3.4], mat: 'metal_dark', bevel: 0.08 });
  cyl(sx * 8.9, 0.64, -6, 1.35, 1.5, { radiusTop: 1.5, sides: 12, mat: 'metal_rust', top: 'metal_dark' });
  cyl(sx * 8.9, 2.1, -6, 1.2, 0.06, { sides: 12, mat: 'neon_orange', collide: false });
}

// ---- ring catwalk (y 5) around the furnace
deck([-13.5, 5, -18], [13.5, 5, -18]);
deck([-13.5, 5, 6], [13.5, 5, 6]);
deck([-12, 5, -16.5], [-12, 5, 4.5]);
deck([12, 5, -16.5], [12, 5, 4.5]);
for (const [x, z] of [[-12, -18], [12, -18], [-12, 6], [12, 6], [-6, -18], [6, -18], [-6, 6], [6, 6], [-12, -6], [12, -6]]) {
  pillar(x, z, 0, 4.6, 0.42, { mat: 'concrete_dark' });
}
// outer loop
rail([-13.5, 5, -19.5], [13.5, 5, -19.5]);
rail([-13.5, 5, 7.5], [13.5, 5, 7.5], [[-1.5, 1.5]]);
rail([-13.5, 5, -19.5], [-13.5, 5, 7.5], [[-3, 1]]);
rail([13.5, 5, -19.5], [13.5, 5, 7.5], [[-13, -9]]);
// inner loop (gaps = drop-off points)
rail([-10.5, 5, -16.5], [10.5, 5, -16.5], [[-2, 2]]);
rail([-10.5, 5, 4.5], [10.5, 5, 4.5], [[-2, 2]]);
rail([-10.5, 5, -16.5], [-10.5, 5, 4.5], [[-8, -4]]);
rail([10.5, 5, -16.5], [10.5, 5, 4.5], [[-8, -4]]);
// glowing underside strips around the inner edge
for (const [x0, z0, x1, z1] of [[-10.6, -16.9, 10.6, -16.7], [-10.6, 4.7, 10.6, 4.9], [-10.9, -16.6, -10.7, 4.6], [10.7, -16.6, 10.9, 4.6]]) {
  box([x0, 4.42, z0], [x1, 4.5, z1], { mat: 'neon_orange', collide: false });
}

// ---- stair towers (ground -> ring contact at y 5 -> galleries at y 9.5)
add({ type: 'stairs', pos: [-15, 4.75, -0.5], size: [3, 9.5, 19], dir: '-z', mat: 'concrete_dark', top: 'metal_grate' });
add({ type: 'stairs', pos: [15, 4.75, -11.5], size: [3, 9.5, 19], dir: '+z', mat: 'concrete_dark', top: 'metal_grate' });

// ---- galleries (y 9.5) + operator cabins
deck([-15, 9.5, -10], [-15, 9.5, -20.5], 3);
deck([-13.5, 9.5, -20], [9, 9.5, -20], 2);
deck([15, 9.5, -2], [15, 9.5, 8.5], 3);
deck([13.5, 9.5, 8], [-9, 9.5, 8], 2);
rail([-16.5, 9.5, -10], [-16.5, 9.5, -20.5]);
rail([-13.5, 9.5, -10], [-13.5, 9.5, -19]);
rail([-13.5, 9.5, -19], [9, 9.5, -19]);
rail([16.5, 9.5, -2], [16.5, 9.5, 8.5]);
rail([13.5, 9.5, -2], [13.5, 9.5, 7]);
rail([13.5, 9.5, 7], [-9, 9.5, 7]);
for (const s of [1, -1]) {
  // cabin deck (point-symmetric: NE cabin at +x/-z, SW cabin at -x/+z)
  const cx = s * 12.8, cz = -6 - s * 13;
  box([cx - 3.8, 9.2, cz - 2], [cx + 3.8, 9.5, cz + 2], { mat: 'metal_dark', top: 'metal_grate' });
  add({ type: 'railing', from: [cx - 3.8, 9.5, cz + s * 2], to: [cx + 3.8, 9.5, cz + s * 2] });
  // console desks + screens
  box([cx + s * 0.6 - 1.4, 9.5, cz - s * 1.85], [cx + s * 0.6 + 1.4, 10.4, cz - s * 1.1], { mat: 'metal_dark', collide: false, top: 'metal_panel' });
  glow(cx + s * 0.6, 10.1, cz - s * 1.09, 2.3, 0.55, 0, s, 'neon_blue');
  box([cx + s * 3.4, 9.5, cz - 1.9], [cx + s * 3.8, 12.0, cz + 0.2], { mat: 'metal_dark', collide: false });
}
// gallery + ring pillars support
for (const [x, z] of [[-15, -15], [-15, -20.4], [-2, -20], [8.5, -20], [15, 3], [15, 8.4], [2, 8], [-8.5, 8]]) pillar(x, z, 0, 9.0, 0.35, { mat: 'metal_dark', collide: false });

// ---- roof: plates over the outer bands, trusses above, hanging lamps
box([-18, 12, -22], [18, 12.45, -12], { mat: 'metal_dark', top: 'metal_corrugated' });
box([-18, 12, 0], [18, 12.45, 10], { mat: 'metal_dark', top: 'metal_corrugated' });
for (const x of [-10, 10]) girder('z', x, -22, 10, 13.5, 1.9, 1.2);
for (const z of [-19, -15.5, 2, 5.5, 8.5]) girder('x', z, -18.6, 18.6, 13.0, 0.7, 0.55, { mat: 'metal_rust' });
girder('x', -12, -18.6, 18.6, 12.45, 0.7, 0.5); girder('x', 0, -18.6, 18.6, 12.45, 0.7, 0.5);
for (const [x, z] of [[-11.5, -16], [-5, -16], [5, -16], [11.5, -16], [-11.5, 4.5], [-5, 4.5], [5, 4.5], [11.5, 4.5], [-16, -6], [16, -6]]) lamp(x, 11.3, z);
// skylights (moon glow) in the roof plates
for (const x of [-14, 14]) { box([x - 1.6, 12.45, -17.5], [x + 1.6, 12.5, -13.5], { mat: 'neon_blue', collide: false, shadow: false }); box([x - 1.6, 12.45, 2.5], [x + 1.6, 12.5, 6.5], { mat: 'neon_blue', collide: false, shadow: false }); }
// roof-top props: vents
for (const [x, z] of [[-14, -20], [14, 8]]) { cyl(x, 12.45, z, 0.8, 1.2, { sides: 10, mat: 'metal_dark' }); cyl(x, 13.65, z, 1.0, 0.2, { sides: 10, mat: 'metal_rust' }); }

// ---- hall floor clutter
crate(-6, 0, 7.6); crate(-4.7, 0, 7.8, 1.2, 0.3); crate(-5.4, 1.2, 7.7, 1.0, 0.1);
crate(6, 0, -19.6); crate(7.3, 0, -19.4, 1.2, 0.2);
barrel(-9.5, -19); barrel(-10.4, -19.4); barrel(9.5, 7.6); barrel(10.4, 7.9);

// ------------------------------------------------------------------------------------------ south gantry / east rack

deck([-26, 5, 16], [31.5, 5, 16]);
deck([0, 5, 7.5], [0, 5, 14.5]);
deck([30, 5, 14.5], [30, 5, -12]);
rail([-26, 5, 14.5], [28.5, 5, 14.5], [[-1.5, 1.5]]);
rail([-26, 5, 17.5], [31.5, 5, 17.5], [[-21, -17], [17, 21]]);
rail([31.5, 5, 17.5], [31.5, 5, -12], [[-6, -3]]);
rail([28.5, 5, 14.5], [28.5, 5, -12]);
rail([-1.5, 5, 7.5], [-1.5, 5, 14.5]); rail([1.5, 5, 7.5], [1.5, 5, 14.5]);
add({ type: 'stairs', pos: [-31.5, 2.5, 16], size: [11, 5, 3], dir: '+x', mat: 'concrete_dark', top: 'metal_grate' });
add({ type: 'stairs', pos: [30, 2.5, -17], size: [3, 5, 10], dir: '+z', mat: 'concrete_dark', top: 'metal_grate' });
add({ type: 'stairs', pos: [36.5, 2.5, -4.5], size: [10, 5, 3], dir: '-x', mat: 'concrete_dark', top: 'metal_grate' });
for (const x of [-24, -16, -8, 8, 16, 24]) pillar(x, 16, 0, 4.6, 0.4, { mat: 'concrete' });
for (const z of [10, 4, -2, -8]) pillar(30, z, 0, 4.6, 0.4, { mat: 'concrete' });
pillar(31.5 - 1.5, 16, 0, 4.6, 0.4, { mat: 'concrete' });
pipe('x', -1, 3.55, 15.2, 54, 0.28, 'metal_rust');
pipe('x', -1, 3.55, 16.8, 54, 0.28, 'container_yellow');
pipe('z', 29.4, 3.55, 1, 28, 0.26, 'metal_rust');
glow(0, 4.55, 14.42, 54, 0.14, 0, -1); glow(0, 4.55, 17.58, 54, 0.14, 0, 1);

// ------------------------------------------------------------------------------------------ trench

// bridges (ground level), rails, track, lights
for (const x of [-14, 14]) {
  box([x - 2, -0.6, 21.9], [x + 2, 0, 30.1], { mat: 'concrete', top: CF });
  add({ type: 'railing', from: [x - 1.9, 0, 22], to: [x - 1.9, 0, 30] });
  add({ type: 'railing', from: [x + 1.9, 0, 22], to: [x + 1.9, 0, 30] });
  box([x - 2.02, -1.1, 22], [x - 1.7, -0.6, 30], { mat: 'metal_dark', collide: false });
  box([x + 1.7, -1.1, 22], [x + 2.02, -0.6, 30], { mat: 'metal_dark', collide: false });
  glow(x, -0.62, 22.02, 4, 0.16, 0, 1); glow(x, -0.62, 29.98, 4, 0.16, 0, -1, 'neon_blue');
}
glow(0, -1.9, 22.04, 78, 0.22, 0, 1);
glow(0, -1.9, 29.96, 78, 0.22, 0, -1, 'neon_blue');
glow(0, -3.4, 22.04, 78, 0.1, 0, 1);
glow(0, -3.4, 29.96, 78, 0.1, 0, -1, 'neon_blue');
for (const x of [-30, -18, -6, 6, 18, 30]) {   // expansion joints
  glow(x, -2, 22.03, 0.14, 3.9, 0, 1, 'metal_dark');
  glow(x + 6, -2, 29.97, 0.14, 3.9, 0, -1, 'metal_dark');
}
// rails + sleepers
box([-38, -4, 24.7], [38, -3.88, 24.86], { mat: 'metal_rust', collide: false, shadow: false });
box([-38, -4, 27.14], [38, -3.88, 27.3], { mat: 'metal_rust', collide: false, shadow: false });
for (let x = -37; x <= 37; x += 3) box([x - 0.16, -4, 24.35], [x + 0.16, -3.94, 27.65], { mat: 'rubber', collide: false, shadow: false });
// rail carts (ore hoppers)
for (const [x, z] of [[-8, 24.3], [8.5, 27.7]]) {
  add({ type: 'box', pos: [x, -3.0, z], size: [5, 1.3, 2.1], mat: 'metal_rust', bevel: 0.12 });
  add({ type: 'box', pos: [x, -2.25, z], size: [4.6, 0.3, 1.8], mat: 'neon_orange', collide: false, shadow: false });
  add({ type: 'box', pos: [x, -3.7, z], size: [4.2, 0.35, 1.5], mat: 'metal_dark' });
}
// crane B: girder over the trench + portal frames + centre legs
girder('x', 26, -39, 39, 10.4, 1.5, 1.1);
for (const s of [-1, 1]) {
  girder('z', s * 38, 20, 32, 10.4, 1.5, 1.1);
  pillar(s * 38, 20.2, 0, 9.0, 0.55, { mat: 'concrete_dark' });
  pillar(s * 38, 31.8, 0, 9.0, 0.55, { mat: 'concrete_dark' });
  pillar(s * 28, 26, -4, 8.9, 0.6, { mat: 'metal_dark' });
  box([s * 28 - 0.2, 8.9, 24.4], [s * 28 + 0.2, 9.0, 27.6], { mat: 'metal_dark', collide: false });
}
for (const x of [-14, 0, 14]) lamp(x, 8.0, 26, 0.6, 0.9);

// ------------------------------------------------------------------------------------------ west container canyon

contRow(-42, -40.5, [3, 1, 2, 2, 0, 2], PAL, 0);
contRow(-32, -40.5, [2, 0, 2, 1, 2, 2], PAL, 2);
// bridges between the two rows (deck sits 5 cm above the container roofs)
for (const z of [-28.3, -10]) {
  deck([-41.3, 5.25, z], [-32.7, 5.25, z], 2.6);
  rail([-41.3, 5.25, z - 1.3], [-32.7, 5.25, z - 1.3]);
  rail([-41.3, 5.25, z + 1.3], [-32.7, 5.25, z + 1.3]);
}
add({ type: 'stairs', pos: [-42, 2.6, -2.2], size: [2.6, 5.2, 9.5], dir: '-z', mat: 'concrete_dark', top: 'metal_grate' });
crate(-37, 0, -38.5); crate(-35.6, 0, -38.7, 1.2, 0.4); crate(-36.3, 1.2, -38.5, 1.1, 0.2);
crate(-38, 0, -14.5); crate(-36.5, 0, -14.4, 1.2, 0.3);
kbarrier(-37, -19.5, PI / 2, 3); kbarrier(-37, -33, 0.0, 2.6);
barrel(-46.5, -20); barrel(-46.6, -21.2); barrel(-45.6, -20.7);
// power substation (west of the hall)
for (const [x, z] of [[-26, -30], [-26, -24.2], [-26, -18.4]]) {
  add({ type: 'box', pos: [x, 1.3, z], size: [3.2, 2.6, 2.6], mat: 'metal_rust', bevel: 0.1 });
  add({ type: 'box', pos: [x - 0.1, 2.75, z], size: [2.6, 0.3, 2.1], mat: 'metal_dark' });
  glow(x + 1.62, 1.4, z, 1.6, 0.14, 1, 0, 'neon_blue');
  glow(x - 1.62, 1.4, z, 1.6, 0.14, -1, 0, 'neon_orange');
}
rail([-27.8, 0, -32.5], [-27.8, 0, -16], [], { collide: true });
mast(-24, -14, 9, 1, 0.2); mast(-45, 2, 9, 1, -0.4);

// ------------------------------------------------------------------------------------------ north yard + crane A

for (const z of [-38, -28]) girder('x', z, -29, 27, 13.0, 1.5, 1.1);
for (const z of [-38, -28]) for (const x of [-27, -1, 25]) pillar(x, z, 0, 11.5, 0.55, { mat: 'concrete_dark' });
girder('z', -9, -38.6, -27.4, 13.9, 1.1, 0.9);
box([-9.8, 6.2, -33.8], [-8.2, 7.4, -32.2], { mat: 'metal_painted_yellow', bevel: 0.05 });
cyl(-9, 5.2, -33, 0.16, 1.0, { sides: 6, mat: 'metal_dark' });
for (const dx of [-0.5, 0.5]) add({ type: 'cylinder', pos: [-9 + dx, 10.4, -33], radius: 0.05, height: 6.2, sides: 4, mat: 'metal_dark', collide: false });
// container tunnel + stacks
cont(-16, 1.3, -36.5, 'blue', PI / 2); cont(-16, 1.3, -31.2, 'red', PI / 2); cont(-16, 3.9, -33.85, 'green', 0);
cont(11.5, 1.3, -36.5, 'red', 0); cont(14.3, 1.3, -36.5, 'yellow', 0); cont(12.9, 3.9, -36.5, 'white', 0);
cont(4, 1.3, -41.5, 'orange', PI / 2); cont(-4, 1.3, -41.5, 'blue', PI / 2);
// ladle stage
box([-3, 0, -35], [9, 1.0, -30], { mat: 'concrete_dark', top: 'metal_panel', bevel: 0.05 });
add({ type: 'ramp', pos: [3, 0.5, -28.4], size: [4, 1, 3.2], dir: '-z', mat: 'concrete_dark', top: 'metal_panel' });
box([-3, 1.0, -35.05], [9, 1.06, -34.95], { mat: 'hazard', collide: false });
glow(3, 0.5, -29.95, 12, 0.14, 0, 1);
cyl(6.5, 1.0, -32.5, 1.3, 1.5, { radiusTop: 1.45, sides: 12, mat: 'metal_rust', top: 'metal_dark' });
cyl(6.5, 2.4, -32.5, 1.15, 0.06, { sides: 12, mat: 'neon_orange', collide: false });
crate(-1.2, 1.0, -33.2); crate(0.1, 1.0, -33.5, 1.2, 0.3);
kbarrier(-6, -24.5, 0, 3); kbarrier(9, -24.5, 0, 3); kbarrier(22, -25, PI / 2, 3);
barrel(20, -32); barrel(21, -32.4); barrel(20.4, -33.2);
mast(-6, -40, 9, 0, 1); mast(18, -34, 9, -1, 0.4); mast(8, -24, 8, 0, -1);

// ------------------------------------------------------------------------------------------ north-east tank farm

tank(33, -37, 4.5, 10);
tank(44, -37, 4.5, 10);
tank(38.5, -26, 3.2, 5, { bands: [0.7, 4.3] });
deck([37.5, 10.03, -37], [40.5, 10.03, -37], 2.6);
rail([37.5, 10.03, -38.3], [40.5, 10.03, -38.3]); rail([37.5, 10.03, -35.7], [40.5, 10.03, -35.7]);
ringRail(33, -37, 10, 4.2, 12, [[150, 210]]);
ringRail(44, -37, 10, 4.2, 12, [[-35, 35], [175, 185], [65, 115]]);
ringRail(38.5, -26, 5, 2.95, 10, [[40, 140]]);
add({ type: 'stairs', pos: [38.5, 2.5, -17.4], size: [3, 5, 10.4], dir: '-z', mat: 'concrete_dark', top: 'metal_grate' });
// pipes and valves
pipe('z', 38.5, 6.6, -32.4, 4.6, 0.3, 'metal_rust'); pipe('x', 36.7, 9, -41.2, 5.2, 0.28, 'metal_dark');
cyl(28.0, 0, -37, 0.45, 5.5, { sides: 8, mat: 'metal_rust' }); cyl(49 - 1.5, 0, -32.2, 0.45, 5.5, { sides: 8, mat: 'metal_rust' });
glow(33, 9.25, -32.47, 3, 0.35, 0, 1); glow(44, 9.25, -32.47, 3, 0.35, 0, 1);
crate(30, 0, -29.5); crate(31.3, 0, -29.6, 1.2, 0.3); crate(27, 0, -32.6);
mast(26, -41, 10, 1, 0.4); mast(46, -28, 9, -1, 0.5);

// ------------------------------------------------------------------------------------------ east plaza

cont(41, 1.3, -14, 'orange', PI / 2); cont(41, 3.9, -14, 'green', PI / 2); cont(43.4, 1.3, -9, 'yellow', 0);
cont(45, 1.3, 9, 'blue', PI / 2); cont(41, 1.3, 11.5, 'red', 0); cont(45.5, 3.9, 9, 'white', PI / 2);
crate(36, 0, -8); crate(37.3, 0, -8.2, 1.2, 0.2); crate(36.6, 1.2, -8.1, 1.1, 0.5);
crate(24, 0, 10); crate(25.3, 0, 10.4, 1.2, 0.4);
kbarrier(24, -14, PI / 2, 3); kbarrier(35, 2, 0, 3.4); kbarrier(35, -18, 0, 3.4); kbarrier(26, 3, PI / 2, 3);
barrel(47, -3); barrel(47.2, -1.8); barrel(46, -2.5);
// generator block with stack
add({ type: 'box', pos: [22, 1.0, -17.5], size: [4.4, 2.0, 2.4], mat: 'metal_dark', bevel: 0.1 });
glow(22, 1.0, -16.28, 3.6, 0.2, 0, 1, 'neon_orange');
cyl(20.6, 2.0, -17.5, 0.28, 3.0, { sides: 8, mat: 'metal_rust' });
mast(44, 0, 9, -1, 0.1); mast(30, 20, 9, 0, -1);

// ------------------------------------------------------------------------------------------ forecourt

kbarrier(-10, 12.5, 0, 3.4); kbarrier(10, 12.5, 0, 3.4); kbarrier(-12, 19.5, 0, 3.4); kbarrier(12, 19.5, 0, 3.4);
crate(-22, 0, 20); crate(-20.7, 0, 20.3, 1.2, 0.3);
mast(-14, 20, 9, 1, -1); mast(14, 12, 9, -1, 1);

// ------------------------------------------------------------------------------------------ south-east slag shed

const SH = 5.6;
wallRun('x', 32.6, 20.7, 49, 0, SH, 0.6, 'metal_corrugated', [
  { c: 27, w: 5, y0: 0, y1: 4.2 }, { c: 35, w: 5, y0: 0, y1: 4.2 }, { c: 43, w: 5, y0: 0, y1: 4.2 },
], { top: 'metal_dark' });
wallRun('z', 21, 32.6, 44, 0, SH, 0.6, 'metal_corrugated', [{ c: 39, w: 3.6, y0: 0, y1: 3.2 }], { top: 'metal_dark' });
for (const c of [27, 35, 43]) trimOpening('x', 32.6, 0.6, { c, w: 5, y0: 0, y1: 4.2 });
trimOpening('z', 21, 0.6, { c: 39, w: 3.6, y0: 0, y1: 3.2 });
box([20.7, SH, 32.3], [49, SH + 0.5, 44], { mat: 'metal_dark', top: 'roof_gravel' });
box([20.7, SH + 0.5, 32.3], [49, SH + 1.1, 32.7], { mat: 'concrete_dark', collide: true });
box([20.7, SH + 0.5, 36.6], [21.1, SH + 1.1, 44], { mat: 'concrete_dark' });
for (const x of [27, 35, 43]) { pillar(x, 38, 0, SH, 0.35, { mat: 'concrete_dark' }); }
for (const x of [26, 36, 44]) box([x - 5, SH - 0.06, 37], [x + 5, SH, 37.3], { mat: 'light_panel', collide: false, shadow: false });
add({ type: 'stairs', pos: [19.2, 2.8, 38.5], size: [3, 5.6, 11], dir: '-z', mat: 'concrete_dark', top: 'metal_grate' });
crate(24, 0, 41); crate(25.3, 0, 41.2, 1.2, 0.3); crate(47, 0, 35); crate(45.8, 0, 35.3, 1.2, 0.2); crate(30, 0, 34.4);
barrel(46, 41); barrel(47, 40.2); barrel(31, 42.5);
// roof props
cyl(30, SH + 0.5, 40, 0.9, 1.4, { sides: 10, mat: 'metal_dark' }); cyl(38, SH + 0.5, 35, 0.9, 1.4, { sides: 10, mat: 'metal_rust' });
box([41, SH + 0.5, 39], [45, SH + 2.0, 42], { mat: 'metal_panel', bevel: 0.08 });
crate(24, SH + 0.5, 40.5); crate(25.3, SH + 0.5, 40.7, 1.2, 0.3);
glow(43, SH + 1.3, 38.94, 2.5, 0.2, 0, -1, 'neon_orange');

// ------------------------------------------------------------------------------------------ south: control shack + scrap yard

const KH = 3.4;
wallRun('x', 35.2, -6, 6, 0, KH, 0.4, 'metal_panel', [{ c: 0, w: 2.4, y0: 0, y1: 2.7 }, { c: -4, w: 1.8, y0: 1.3, y1: 2.3 }, { c: 4, w: 1.8, y0: 1.3, y1: 2.3 }], { top: 'metal_dark' });
wallRun('x', 41.8, -6, 6, 0, KH, 0.4, 'metal_panel', [{ c: 0, w: 2.4, y0: 0, y1: 2.7 }], { top: 'metal_dark' });
wallRun('z', -5.8, 35, 42, 0, KH, 0.4, 'metal_panel', [{ c: 38.5, w: 2.2, y0: 0, y1: 2.7 }], { top: 'metal_dark' });
wallRun('z', 5.8, 35, 42, 0, KH, 0.4, 'metal_panel', [{ c: 38.5, w: 2.2, y0: 0, y1: 2.7 }], { top: 'metal_dark' });
box([-6.2, KH, 35], [6.2, KH + 0.4, 42], { mat: 'metal_dark', top: 'roof_gravel' });
box([-6, 0.7, 36.4], [-4.6, 1.3, 38.8], { mat: 'crate', collide: true });
glow(0, 3.0, 34.98, 8, 0.2, 0, -1, 'neon_blue');
cyl(3.5, KH + 0.4, 38.5, 0.5, 2.5, { sides: 8, mat: 'metal_dark' });    // antenna mast
cyl(-2, KH + 0.4, 39, 0.7, 0.9, { sides: 10, mat: 'metal_rust' });
crate(9, 0, 33.6); crate(10.3, 0, 33.9, 1.2, 0.2); crate(-10, 0, 41.5); crate(-11.2, 0, 41.8, 1.2, 0.4);
kbarrier(-12, 36, PI / 2, 3); kbarrier(12, 39, PI / 2, 3);

// scrap yard (south-west)
cont(-44, 1.3, 38, 'red', PI / 2); cont(-44, 3.9, 38, 'orange', PI / 2); cont(-36, 1.3, 41.2, 'blue', 0);
cont(-38, 1.3, 35, 'green', PI / 2); cont(-25, 1.3, 41, 'yellow', 0); cont(-25, 3.9, 41, 'white', 0);
tank(-30, 38.5, 3.0, 6.2);
crate(-46, 0, 33.5); crate(-44.7, 0, 33.6, 1.2, 0.3); crate(-45.4, 1.2, 33.5, 1.1, 0.2);
barrel(-40, 33.5); barrel(-40.9, 33.9); barrel(-22, 34); barrel(-21.2, 34.6);
kbarrier(-20, 40, 0, 3); kbarrier(-32, 33.5, 0, 3);
mast(-40, 42, 9, 0.5, -1); mast(4, 43, 9, 0, -1);
// west end block (beyond the trench)
crate(-46, 0, 24); crate(-44.7, 0, 24.3, 1.2, 0.4); barrel(-46, 28); barrel(-45.2, 28.6);
crate(46, 0, 24); crate(44.7, 0, 24.3, 1.2, 0.2); barrel(46.4, 28);

// ------------------------------------------------------------------------------------------ theme / lights / spawns / pickups

const lights = [
  { pos: [6, 7, 1.5], color: '#ff8a3a', intensity: 105, distance: 30 },       // furnace glow (hall)
  { pos: [0, 0.2, 26], color: '#68b4ff', intensity: 52, distance: 26 },       // trench
  { pos: [28, 9, -22], color: '#ffb35c', intensity: 98, distance: 42 },      // north-east sodium
  { pos: [-28, 9, 8], color: '#ffb35c', intensity: 98, distance: 42 },       // west sodium
];

export default {
  id: 'foundry',
  name: 'Foundry',
  subtitle: 'Industrial yard · Night',
  description: 'A steel foundry yard under a cold moon. Wall-run the 80 m rail trench, grapple the crane girders, fight through the glowing smelting hall and snipe from the tank farm.',
  colors: ['#1d2b4a', '#ff9a3c'],
  bounds: { min: [-50, -6, -45], max: [50, 36, 45] },
  killY: -25,
  previewCamera: { pos: [-44, 24, 40], lookAt: [8, 5, -8] },
  theme: {
    sky: { top: '#040820', horizon: '#2a3f78', bottom: '#0a0d1a', sunColor: '#dfe8ff', sunSize: 1.5, stars: true, clouds: 0.22 },
    sun: { dir: [0.38, 0.62, 0.5], color: '#b4c8ff', intensity: 1.5 },
    hemi: { sky: '#7f97d8', ground: '#4a3d4a', intensity: 0.95 },
    fog: { color: '#1a2650', near: 55, far: 230 },
    exposure: 1.12,
    envIntensity: 0.55,
    // bloom (see Game._setupComposer): strength = the value at 100 % Glow (default setting 65 %); wide radius = diffuse halos, not hard flares
    bloom: { strength: 2.8, radius: 0.9, threshold: 0.4, knee: 0.3 },
  },
  solids,
  lights,
  spawns: [
    { pos: [-45, 0, -38], lookAt: [-20, 0, -20] },
    { pos: [-37, 0, -22], lookAt: [-20, 0, -22] },
    { pos: [-22, 0, -38], lookAt: [0, 0, -20] },
    { pos: [2, 0, -40], lookAt: [0, 0, -20] },
    { pos: [17, 0, -36], lookAt: [0, 0, -20] },
    { pos: [46, 0, -21], lookAt: [20, 0, -8] },
    { pos: [44, 0, 5], lookAt: [20, 0, -2] },
    { pos: [28, 0, 7], lookAt: [0, 0, -6] },
    { pos: [46, 0, 26], lookAt: [0, -4, 26] },
    { pos: [-46, 0, 26], lookAt: [0, -4, 26] },
    { pos: [-30, 0, 33], lookAt: [0, 0, 20] },
    { pos: [14, 0, 40], lookAt: [0, 0, 20] },
    { pos: [30, 0, 40], lookAt: [35, 0, 33] },
    { pos: [-22, -4, 26], lookAt: [22, -4, 26] },
    { pos: [22, -4, 26], lookAt: [-22, -4, 26] },
    { pos: [-12, 5, 6], lookAt: [0, 5, -6] },
    { pos: [12, 5, -18], lookAt: [0, 5, -6] },
    { pos: [-14, 5, 16], lookAt: [14, 5, 16] },
  ],
  pickups: [
    { type: 'weapon', weapon: 'rocket', pos: [0, 0, 2.2] },
    { type: 'weapon', weapon: 'arc', pos: [6.5, 0, -10.5] },
    { type: 'weapon', weapon: 'gale', pos: [11.5, 5, -5.5] },
    { type: 'weapon', weapon: 'sniper', pos: [33, 10, -37] },
    { type: 'weapon', weapon: 'smg', pos: [14, 0, 6] },
    { type: 'weapon', weapon: 'rail', pos: [-47, 0, 42] },
    { type: 'weapon', weapon: 'shotgun', pos: [0, -4, 26] },
    { type: 'health', pos: [-13, 9.5, 7], amount: 50 },
    { type: 'health', pos: [-37, 0, -28.3], amount: 25 },
    { type: 'health', pos: [36, 0, 5], amount: 25 },
    { type: 'health', pos: [-27, -4, 26], amount: 25 },
    { type: 'armor', pos: [13, 9.5, -19] },
    { type: 'armor', pos: [-37, 5.25, -10] },
    { type: 'ammo', pos: [-24, 0, 1] },
    { type: 'ammo', pos: [24, 0, -16] },
    { type: 'ammo', pos: [8, 0, -38] },
    { type: 'ammo', pos: [-8, 0, 40] },
    { type: 'grenades', pos: [40, 0, 38], amount: 2 },
    { type: 'grenades', pos: [-46, 0, 4], amount: 2 },
  ],
  // King of the Hill control zones, in rotation order: pos = floor centre [x, y, z], radius (m); entities count with feet within [-1.2, +3.2] m of the floor
  zones: [
    { id: 'hall', name: 'Smelting Hall', pos: [0, 0, 2.2], radius: 7.5 },
    { id: 'plazaE', name: 'East Plaza', pos: [36, 0, -6], radius: 8 },
    { id: 'yardN', name: 'North Yard', pos: [0, 0, -26], radius: 8 },
    { id: 'trench', name: 'Rail Trench', pos: [0, -4, 26], radius: 7 },
  ],
  jumpPads: [
    { pos: [-19, -4, 24.5], target: [-19, 5, 16], apex: 3 },
    { pos: [19, -4, 24.5], target: [19, 5, 16], apex: 3 },
    { pos: [24, 0, -33], target: [31.5, 10, -36], apex: 3 },
    { pos: [38.5, 5, -26.8], target: [43.8, 10, -34.8], apex: 3 },
  ],
};
