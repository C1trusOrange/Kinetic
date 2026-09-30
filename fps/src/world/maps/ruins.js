// "Ruins": a sun-bleached ancient temple complex in a desert canyon. Midday, crisp shadows.
//
//   x: west(-) .. east(+)   z: north(-) .. south(+)   y: up.   Play volume 108 x 108 m, cliffs to y 24 (+ invisible to 44).
//
//   Tier 0 (y 0)      sand plaza, paved processional paths, sunken water courtyard (SW, floor y -1.6),
//                     Great Hall of the Sun (N, ground floor), bazaar village (SE), south gate + oasis
//   Tier 1 (y 4.5)    ziggurat terrace (centre), canyon shelves east + west (8 m wide), bazaar rooftops
//   Tier 2 (y 9)      ziggurat shrine platform (rocket launcher altar), canyon upper shelves,
//                     Great Hall roof (bridges from both canyon shelves), courtyard wall tops
//   Tier 3 (y 13-16)  shrine roof, broken aqueduct (grapple and jump-pad targets), obelisk tips
//
// Bots reach: the ziggurat (4 grand stairs + shrine stairs N/S), both canyon shelves (south end stairs),
// the upper shelves (stairs), the aqueduct west arm (stairs), the hall roof (west bridge), bazaar roofs (sand ramp),
// the courtyard (stairs N + E), plus every jump pad. The east bridge and the aqueduct gap need a jump or grapple.

const T1 = 4.5;
const T2 = 9;

const solids = [];
const add = s => { solids.push(s); return s; };

// ------------------------------------------------------------------ deterministic random
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
const R = rng(90210);
const rr = (a, b) => a + (b - a) * R();

// ------------------------------------------------------------------ primitives
const box = (x0, y0, z0, x1, y1, z1, mat, o) => add({ type: 'box', min: [x0, y0, z0], max: [x1, y1, z1], mat, ...o });
const stairs = (x0, z0, x1, z1, y0, y1, dir, mat, top, o) => add({
  type: 'stairs', pos: [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2], size: [x1 - x0, y1 - y0, z1 - z0], dir, mat, top, ...o,
});
const ramp = (x0, z0, x1, z1, y0, y1, dir, mat, top, o) => add({
  type: 'ramp', pos: [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2], size: [x1 - x0, y1 - y0, z1 - z0], dir, mat, top, ...o,
});
const pillar = (x, z, y0, h, r, mat = 'sandstone', sides = 10, o) => add({
  type: 'pillar', pos: [x, y0 + h / 2, z], radius: r, height: h, sides, mat, ...o,
});
const wall = (x0, z0, x1, z1, y0, h, t, mat, o) => add({ type: 'wall', from: [x0, z0], to: [x1, z1], y0, height: h, thickness: t, mat, ...o });
const cyl = (x, y0, z, r, h, mat, o = {}) => add({ type: 'cylinder', pos: [x, y0 + h / 2, z], radius: r, height: h, mat, ...o });

// 90 degree rotation helpers (build one quarter, stamp four)
const DIRS = ['+x', '+z', '-x', '-z'];
const rotDir = (k, d) => DIRS[(DIRS.indexOf(d) + k) % 4];
const rotXZ = (k, x, z) => { for (let i = 0; i < k; i++) { const t = x; x = -z; z = t; } return [x, z]; };
const boxK = (k, x0, y0, z0, x1, y1, z1, mat, o) => {
  const [ax, az] = rotXZ(k, x0, z0), [bx, bz] = rotXZ(k, x1, z1);
  return box(Math.min(ax, bx), y0, Math.min(az, bz), Math.max(ax, bx), y1, Math.max(az, bz), mat, o);
};
const stairsK = (k, x0, z0, x1, z1, y0, y1, dir, mat, top, o) => {
  const [ax, az] = rotXZ(k, x0, z0), [bx, bz] = rotXZ(k, x1, z1);
  return stairs(Math.min(ax, bx), Math.min(az, bz), Math.max(ax, bx), Math.max(az, bz), y0, y1, rotDir(k, dir), mat, top, o);
};
const pillarK = (k, x, z, y0, h, r, mat, sides, o) => { const [px, pz] = rotXZ(k, x, z); return pillar(px, pz, y0, h, r, mat, sides, o); };
const cylK = (k, x, y0, z, r, h, mat, o) => { const [px, pz] = rotXZ(k, x, z); return cyl(px, y0, pz, r, h, mat, o); };

// glowing glyph panels. face = direction the panel looks toward; (x, z) is the panel centre (already offset from the wall)
const FACE_ROT = { '+z': 0, '-z': Math.PI, '+x': Math.PI / 2, '-x': -Math.PI / 2 };
const panel = (face, x, y, z, w, h, mat = 'neon_green') => add({ type: 'panel', pos: [x, y, z], size: [w, h], rot: FACE_ROT[face], mat });
const panelK = (k, face, x, y, z, w, h, mat) => { const [px, pz] = rotXZ(k, x, z); return panel(rotDir(k, face), px, y, pz, w, h, mat); };
// panel on a wall face: face normal axis coordinate c (wall surface), position a along the wall
const glyph = (face, c, a, y, w, h, mat) => {
  const o = 0.035;
  if (face === '+z') return panel(face, a, y, c + o, w, h, mat);
  if (face === '-z') return panel(face, a, y, c - o, w, h, mat);
  if (face === '+x') return panel(face, c + o, y, a, w, h, mat);
  return panel(face, c - o, y, a, w, h, mat);
};

// axis-aligned wall with an optional door (world coordinate `at` along the wall, width w, height h)
function axisWall(ax, az, bx, bz, y0, h, t, mat, door, o) {
  const alongX = Math.abs(az - bz) < 1e-6;
  const lo = (alongX ? Math.min(ax, bx) : Math.min(az, bz)) - t / 2;
  const hi = (alongX ? Math.max(ax, bx) : Math.max(az, bz)) + t / 2;
  const c = alongX ? az : ax;
  const seg = (a, b, ya, yb) => {
    if (b - a < 0.01 || yb - ya < 0.01) return;
    if (alongX) box(a, ya, c - t / 2, b, yb, c + t / 2, mat, o);
    else box(c - t / 2, ya, a, c + t / 2, yb, b, mat, o);
  };
  if (!door) { seg(lo, hi, y0, y0 + h); return; }
  seg(lo, door.at - door.w / 2, y0, y0 + h);
  seg(door.at + door.w / 2, hi, y0, y0 + h);
  seg(door.at - door.w / 2, door.at + door.w / 2, y0 + door.h, y0 + h);
}

// crumbling wall: a row of blocks of random height
function ruinWall(x0, z0, x1, z1, y0, hMax, t, mat) {
  const len = Math.hypot(x1 - x0, z1 - z0);
  const n = Math.max(1, Math.round(len / 1.8));
  for (let i = 0; i < n; i++) {
    const a = i / n, b = (i + 1) / n;
    const h = hMax * (0.3 + 0.7 * R()) * (R() < 0.25 ? 0.55 : 1);
    wall(x0 + (x1 - x0) * a, z0 + (z1 - z0) * a, x0 + (x1 - x0) * b, z0 + (z1 - z0) * b, y0, h, t, mat);
  }
}

function boulder(x, z, s, mat = 'rock', y0 = 0) {
  const h = s * rr(0.55, 0.9);
  add({ type: 'box', pos: [x, y0 + h / 2 - 0.05, z], size: [s, h, s * rr(0.75, 1.25)], rot: rr(0, Math.PI), mat });
  if (s > 1.5) add({ type: 'box', pos: [x + rr(-0.3, 0.3), y0 + h + s * 0.14, z + rr(-0.3, 0.3)], size: [s * 0.62, s * 0.4, s * 0.55], rot: rr(0, Math.PI), mat });
}

function rubble(x, z, n, spread, y0 = 0, mat = 'sandstone') {
  for (let i = 0; i < n; i++) {
    const s = rr(0.45, 1.05);
    add({ type: 'box', pos: [x + rr(-spread, spread), y0 + s * 0.3, z + rr(-spread, spread)], size: [s, s * 0.62, s * rr(0.7, 1.2)], rot: rr(0, Math.PI), mat: R() < 0.3 ? 'sandstone_dark' : mat });
  }
}

function fallenColumn(x, z, len, r, yaw, axis = 'x', y0 = 0) {
  add({ type: 'cylinder', pos: [x, y0 + r - 0.04, z], radius: r, height: len, sides: 8, axis, rot: yaw, mat: 'sandstone' });
}

function dune(x, z, r, h, rt = 0.35) {
  add({ type: 'cylinder', pos: [x, h / 2 - 0.1, z], radius: r, radiusTop: r * rt, height: h + 0.2, sides: 10, rot: rr(0, 1), mat: 'sand' });
}

function palm(x, z, h = 6.5) {
  add({ type: 'cylinder', pos: [x, h / 2, z], radius: 0.34, radiusTop: 0.2, height: h, sides: 6, mat: 'wood_planks' });
  add({ type: 'cylinder', pos: [x, h + 0.2, z], radius: 2.7, radiusTop: 0.55, height: 0.9, sides: 7, rot: rr(0, 1), mat: 'grass' });
  add({ type: 'cylinder', pos: [x, h + 1.05, z], radius: 1.7, radiusTop: 0, height: 1.3, sides: 7, rot: rr(0, 1), mat: 'grass' });
}

function bush(x, z, r = 1.0) {
  add({ type: 'cylinder', pos: [x, 0.36, z], radius: r, radiusTop: r * 0.35, height: 0.8, sides: 7, rot: rr(0, 1), mat: 'grass' });
}

function grassPatch(x, z, w, d, rot = 0) {
  add({ type: 'box', pos: [x, 0.02, z], size: [w, 0.06, d], rot, mat: 'grass' });
}

function obelisk(x, z, h = 16, s = 1.3) {
  box(x - 2.3, 0, z - 2.3, x + 2.3, 0.7, z + 2.3, 'sandstone_dark', { top: 'sandstone' });
  box(x - 1.8, 0.7, z - 1.8, x + 1.8, 1.4, z + 1.8, 'sandstone_dark', { top: 'sandstone' });
  const rt = s * 0.6;
  add({ type: 'cylinder', pos: [x, 1.4 + h / 2, z], radius: s * Math.SQRT2, radiusTop: rt * Math.SQRT2, height: h, sides: 4, rot: Math.PI / 4, mat: 'sandstone' });
  add({ type: 'cylinder', pos: [x, 1.4 + h + 0.75, z], radius: rt * Math.SQRT2, radiusTop: 0, height: 1.5, sides: 4, rot: Math.PI / 4, mat: 'gold' });
  // gold collar and a glowing glyph slit on each face
  add({ type: 'cylinder', pos: [x, 1.4 + h - 0.15, z], radius: rt * Math.SQRT2 + 0.12, radiusTop: rt * Math.SQRT2 + 0.12, height: 0.3, sides: 4, rot: Math.PI / 4, mat: 'gold' });
  const face = s * (1 - 0.4 * (5.5 / h)) * 1.0;
  const yy = 1.4 + 5.5;
  glyph('+z', z + face, x, yy, 0.3, 3.4, 'neon_green');
  glyph('-z', z - face, x, yy, 0.3, 3.4, 'neon_green');
  glyph('+x', x + face, z, yy, 0.3, 3.4, 'neon_green');
  glyph('-x', x - face, z, yy, 0.3, 3.4, 'neon_green');
}

// glow-plinth for a jump pad (the World draws the pad itself; this gives it a stone plate to sit on)
function padPlate(x, y, z) {
  box(x - 1.75, y - 0.6, z - 1.75, x + 1.75, y + 0.1, z + 1.75, 'marble', { top: 'marble' });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(x + sx * 1.55 - 0.14, y + 0.09, z + sz * 1.55 - 0.14, x + sx * 1.55 + 0.14, y + 0.15, z + sz * 1.55 + 0.14, 'gold', { collide: false });
}

// ================================================================== 0. GROUND, CLIFF RING, DISTANT MESAS
const SD = 'sandstone_dark';
box(-54, -10, -54, 54, 0, 10, SD, { top: 'sand' });
box(-54, -10, 30, 54, 0, 54, SD, { top: 'sand' });
box(-54, -10, 10, -35, 0, 30, SD, { top: 'sand' });
box(-15, -10, 10, 54, 0, 30, SD, { top: 'sand' });
box(-35, -10, 10, -15, -1.6, 30, SD, { top: 'stone_tiles' });     // courtyard floor

// canyon wall ring, layered strata
const STRATA = [[-3, 9, SD], [9, 14, 'sandstone'], [14, 20, SD], [20, 24, 'rock']];
for (const [y0, y1, m] of STRATA) {
  box(-54, y0, -54, -52, y1, 54, m);
  box(52, y0, -54, 54, y1, 54, m);
  box(-52, y0, -54, 52, y1, -52, m);
  box(-52, y0, 52, 52, y1, 54, m);
}
// invisible extension up to the play volume ceiling
box(-54, 24, -54, -52, 44, 54, 'rock', { visible: false });
box(52, 24, -54, 54, 44, 54, 'rock', { visible: false });
box(-52, 24, -54, 52, 44, -52, 'rock', { visible: false });
box(-52, 24, 52, 52, 44, 54, 'rock', { visible: false });
box(-52, 44, -52, 52, 46, 52, 'rock', { visible: false });

// distant mesas (visual only) so the canyon reads as a landscape from the high perches
const MESAS = [
  [-78, -60, 22, 30], [-84, -20, 26, 44], [-90, 30, 20, 34], [-70, 74, 28, 26], [-30, 92, 24, 36],
  [30, 88, 30, 28], [78, 70, 24, 40], [92, 20, 22, 32], [88, -26, 28, 46], [76, -70, 24, 30], [30, -92, 30, 38], [-32, -90, 26, 32],
];
for (const [mx, mz, w, h] of MESAS) {
  const rot = rr(-0.3, 0.3);
  add({ type: 'box', pos: [mx, h / 2 - 4, mz], size: [w, h + 8, w * rr(0.8, 1.3)], rot, mat: SD, collide: false });
  add({ type: 'box', pos: [mx + rr(-2, 2), h * 0.6 + 2, mz + rr(-2, 2)], size: [w * 0.66, h * 0.7, w * 0.7], rot: rot + 0.2, mat: 'sandstone', collide: false });
  add({ type: 'box', pos: [mx, h + 2, mz], size: [w * 0.8, 3.5, w * 0.8], rot: rot, mat: 'rock', collide: false });
}

// ================================================================== 1. PROCESSIONAL PATHS
box(-4, -0.5, -38, 4, 0.05, -22.5, 'sandstone', { top: 'sandstone' });
box(-4, -0.5, 22.5, 4, 0.05, 38, 'sandstone', { top: 'sandstone' });
box(-38, -0.5, -4, -22.5, 0.05, 4, 'sandstone', { top: 'sandstone' });
box(22.5, -0.5, -4, 38, 0.05, 4, 'sandstone', { top: 'sandstone' });
// gold inlay lines along the paths
for (const s of [-1, 1]) {
  box(s * 3.55 - 0.08, 0.04, -38, s * 3.55 + 0.08, 0.06, -22.5, 'gold', { collide: false, shadow: false });
  box(s * 3.55 - 0.08, 0.04, 22.5, s * 3.55 + 0.08, 0.06, 38, 'gold', { collide: false, shadow: false });
  box(-38, 0.04, s * 3.55 - 0.08, -22.5, 0.06, s * 3.55 + 0.08, 'gold', { collide: false, shadow: false });
  box(22.5, 0.04, s * 3.55 - 0.08, 38, 0.06, s * 3.55 + 0.08, 'gold', { collide: false, shadow: false });
}

// ================================================================== 2. ZIGGURAT
box(-14, 0, -14, 14, T1, 14, SD, { top: 'sandstone' });
box(-5.5, T1, -5.5, 5.5, T2, 5.5, SD, { top: 'marble' });
// low outer step (visual plinth all round)
box(-14.7, 0, -14.7, 14.7, 0.5, 14.7, 'sandstone', { top: 'sandstone', collide: false });

for (let k = 0; k < 4; k++) {
  // grand stair up to the terrace, flanked by pedestals with braziers
  stairsK(k, -3.25, -22.5, 3.25, -14, 0, T1, '+z', SD, 'sandstone');
  for (const sx of [-1, 1]) {
    const px0 = sx > 0 ? 3.6 : -5.6;
    boxK(k, px0, 0, -22.5, px0 + 2, 2.2, -20.5, SD, { top: 'gold' });
    cylK(k, px0 + 1, 2.2, -21.5, 0.5, 0.5, 'gold', { top: 'neon_orange', sides: 8 });
    // stepped cheek blocks along the stair
    boxK(k, sx > 0 ? 3.25 : -3.65, 0, -20.5, sx > 0 ? 3.65 : -3.25, 1.4, -14, SD, { top: 'sandstone' });
  }
  // glyph frieze either side of the stair on the terrace face
  boxK(k, -13.6, 3.3, -14.14, -4.2, 3.62, -14.0, 'gold', { collide: false });
  boxK(k, 4.2, 3.3, -14.14, 13.6, 3.62, -14.0, 'gold', { collide: false });
  for (const sx of [-1, 1]) {
    for (let i = 0; i < 5; i++) {
      const gx = sx * (5.6 + i * 1.75);
      panelK(k, '-z', gx, 2.1, -14.035, 0.42, 1.5, 'neon_green');
    }
  }
  // corner: fallen blocks on the terrace
  pillarK(k, -11.6, -11.6, T1, 3.2, 0.7, 'sandstone', 8);
}
// shrine stairs (north + south) and side pilasters
for (let k = 0; k < 4; k += 2) {
  stairsK(k, -2.5, -13, 2.5, -5.5, T1, T2, '+z', SD, 'marble');
  boxK(k, -2.5 - 0.5, T1, -13, -2.5, T1 + 1.3, -8.4, 'sandstone', { top: 'sandstone' });
  boxK(k, 2.5, T1, -13, 3.0, T1 + 1.3, -8.4, 'sandstone', { top: 'sandstone' });
  boxK(k, -5.3, 6.1, -5.53, -2.9, 6.4, -5.5, 'gold', { collide: false });
  boxK(k, 2.9, 6.1, -5.53, 5.3, 6.4, -5.5, 'gold', { collide: false });
  panelK(k, '-z', -4.1, 7.2, -5.535, 2.0, 0.3, 'neon_green');
  panelK(k, '-z', 4.1, 7.2, -5.535, 2.0, 0.3, 'neon_green');
}
// east / west faces of the shrine platform
for (const sx of [-1, 1]) {
  const face = sx > 0 ? '+x' : '-x';
  glyph(face, sx * 5.5, 0, 7.2, 4.5, 0.3, 'neon_green');
  glyph(face, sx * 5.5, -3, 5.6, 0.35, 1.7, 'neon_green');
  glyph(face, sx * 5.5, 3, 5.6, 0.35, 1.7, 'neon_green');
  box(sx > 0 ? 5.5 : -5.64, 6.1, -5.3, sx > 0 ? 5.64 : -5.5, 6.4, 5.3, 'gold', { collide: false });
}

// pillared shrine on the platform
const SHRINE = [[-4.1, -4.1], [0, -4.1], [4.1, -4.1], [-4.1, 0], [4.1, 0], [-4.1, 4.1], [0, 4.1], [4.1, 4.1]];
for (const [x, z] of SHRINE) pillar(x, z, T2, 4.4, 0.55, 'marble', 10);
box(-6, 13.4, -6, 6, 14.3, 6, 'sandstone', { top: 'sandstone_dark' });
box(-6.06, 13.42, -6.06, 6.06, 13.72, 6.06, 'gold', { collide: false });
box(-4.2, 14.3, -4.2, 4.2, 15.0, 4.2, 'sandstone', { top: 'sandstone' });
box(-2.4, 15.0, -2.4, 2.4, 15.7, 2.4, 'sandstone', { top: 'gold' });
add({ type: 'cylinder', pos: [0, 16.9, 0], radius: 1.3, radiusTop: 0, height: 2.4, sides: 4, rot: Math.PI / 4, mat: 'gold' });
// altar dais
box(-2.3, T2, -2.3, 2.3, T2 + 0.28, 2.3, 'marble', { top: 'marble' });
box(-1.4, T2 + 0.28, -1.4, 1.4, T2 + 0.68, 1.4, 'marble', { top: 'gold' });
for (const [x, z] of [[-2.3, -2.3], [2.3, -2.3], [-2.3, 2.3], [2.3, 2.3]]) cyl(x, T2 + 0.28, z, 0.28, 0.5, 'gold', { top: 'neon_orange', sides: 8 });
// gold roof-edge finials
for (const [x, z] of [[-5.6, -5.6], [5.6, -5.6], [-5.6, 5.6], [5.6, 5.6]]) add({ type: 'cylinder', pos: [x, 14.75, z], radius: 0.4, radiusTop: 0, height: 0.9, sides: 4, rot: Math.PI / 4, mat: 'gold' });

// ================================================================== 3. GREAT HALL OF THE SUN (north)
box(-24, -0.5, -52, 24, 0.06, -38, 'stone_tiles', { top: 'stone_tiles' });
// walls (8 m, roof slab above), west + east with doors at z -46.5..-42.5
for (const sx of [-1, 1]) {
  const x0 = sx > 0 ? 22.5 : -24, x1 = sx > 0 ? 24 : -22.5;
  box(x0, 0, -52, x1, 8, -46.5, SD);
  box(x0, 0, -42.5, x1, 8, -38, SD);
  box(x0, 5.6, -46.5, x1, 8, -42.5, SD);
  // gold cornice + glyph strips on the outer face
  const outer = sx > 0 ? 24 : -24;
  box(sx > 0 ? 24 : -24.14, 6.3, -52, sx > 0 ? 24.14 : -24, 6.65, -38, 'gold', { collide: false });
  glyph(sx > 0 ? '+x' : '-x', outer, -49.2, 3.4, 0.4, 2.4, 'neon_green');
  glyph(sx > 0 ? '+x' : '-x', outer, -39.6, 3.4, 0.4, 2.4, 'neon_green');
  glyph(sx > 0 ? '+x' : '-x', outer, -45, 7.2, 5.5, 0.28, 'neon_orange');
}
// roof slab + parapets
box(-24.6, 8, -52, 24.6, 9, -37.4, 'sandstone', { top: 'sandstone' });
box(-24.7, 7.7, -52, 24.7, 8.0, -37.3, 'gold', { collide: false });
glyph('+z', -37.4, 0, 8.45, 47, 0.3, 'neon_orange');
wall(-24.3, -37.7, -3.5, -37.7, 9, 1.0, 0.6, 'sandstone');
wall(3.5, -37.7, 24.3, -37.7, 9, 1.0, 0.6, 'sandstone');
wall(-24.3, -51.6, -24.3, -46.6, 9, 1.0, 0.6, 'sandstone');
wall(-24.3, -41.6, -24.3, -37.7, 9, 1.0, 0.6, 'sandstone');
wall(24.3, -51.6, 24.3, -46.6, 9, 1.0, 0.6, 'sandstone');
wall(24.3, -41.6, 24.3, -37.7, 9, 1.0, 0.6, 'sandstone');
// portico columns (front) and two interior rows
for (const x of [-21, -12.6, -4.2, 4.2, 12.6, 21]) pillar(x, -39.2, 0, 8, 1.1, 'sandstone', 12);
for (const x of [-16, -8, 0, 8, 16]) { pillar(x, -43.6, 0, 8, 0.9, 'marble', 12); pillar(x, -48.4, 0, 8, 0.9, 'marble', 12); }
// back wall: sun disc with corona, glyph frieze, statue plinths
add({ type: 'cylinder', pos: [0, 4.6, -51.84], radius: 3.2, height: 0.12, sides: 24, axis: 'z', mat: 'neon_orange' });
add({ type: 'cylinder', pos: [0, 4.6, -51.78], radius: 2.6, height: 0.2, sides: 24, axis: 'z', mat: 'gold' });
add({ type: 'cylinder', pos: [0, 4.6, -51.66], radius: 1.4, height: 0.2, sides: 16, axis: 'z', mat: 'marble' });
glyph('+z', -52, 0, 7.4, 44, 0.28, 'neon_green');
for (const x of [-20, -14, 14, 20]) glyph('+z', -52, x, 3.6, 0.5, 3.0, 'neon_green');
for (const sx of [-1, 1]) {
  box(sx * 19 - 1.6, 0, -51.9, sx * 19 + 1.6, 1.8, -48.7, SD, { top: 'gold' });
  pillar(sx * 19, -50.3, 1.8, 3.6, 0.55, 'sandstone', 8);
  add({ type: 'cylinder', pos: [sx * 19, 6.05, -50.3], radius: 0.5, radiusTop: 0, height: 1.0, sides: 4, rot: Math.PI / 4, mat: 'gold' });
}
// fallen roof block + dust at the west door
rubble(-27, -44, 5, 1.6);

// ================================================================== 4. CANYON SHELVES (east + west)
// s = -1 west, +1 east. cfg: T2 stair z-range + direction
function shelves(s, cfg) {
  const bx = (xa, y0, za, xb, y1, zb, mat, o) => { const a = s * xa, b = s * xb; return box(Math.min(a, b), y0, za, Math.max(a, b), y1, zb, mat, o); };
  const st = (xa, za, xb, zb, y0, y1, dir, mat, top, o) => { const a = s * xa, b = s * xb; return stairs(Math.min(a, b), za, Math.max(a, b), zb, y0, y1, dir, mat, top, o); };
  const gl = (c, a, y, w, h, mat) => glyph(s > 0 ? '-x' : '+x', s * c, a, y, w, h, mat);
  // tier 1 shelf + south end stairs
  bx(38, 0, -34, 46, T1, 24, SD, { top: 'sandstone' });
  st(38, 24, 46, 38, 0, T1, '-z', SD, 'sandstone');
  // tier 2 shelf, landing + stairs up from the tier 1 shelf
  bx(46, 0, -46, 52, T2, 30, SD, { top: 'sandstone' });
  const { z0, z1, dir } = cfg;
  st(42, z0, 46, z1, T1, T2, dir, SD, 'sandstone');
  if (dir === '+z') bx(42, 0, z1, 46, T2, z1 + 4, SD, { top: 'sandstone' });
  else bx(42, 0, z0 - 4, 46, T2, z0, SD, { top: 'sandstone' });
  // stair side wall (keeps the shelf edge readable)
  // facing gold + glyph bands on both faces
  box(s > 0 ? 37.86 : -38, 3.3, -34, s > 0 ? 38 : -37.86, 3.64, 24, 'gold', { collide: false });
  box(s > 0 ? 45.86 : -46, 7.8, -46, s > 0 ? 46 : -45.86, 8.14, 30, 'gold', { collide: false });
  for (let z = -30; z <= 20; z += 5.5) {
    if (z > cfg.z0 - 8 && z < cfg.z1 + 8) continue;
    gl(38, z, 2.0, 0.4, 1.6, 'neon_green');
  }
  for (let z = -42; z <= 26; z += 6) gl(46, z, 6.4, 0.4, 1.6, 'neon_green');
  // low parapets on the upper shelf edge (cover for the sniper perches), open at the stairs
  const par = [[-42, -32], [-26, -16], [-4, 6], [16, 28]];
  for (const [za, zb] of par) {
    if (zb > cfg.z0 - 1 && za < cfg.z1 + 5) continue;
    wall(s * 46.3, za, s * 46.3, zb, T2, 1.1, 0.6, 'sandstone');
  }
  // outcrops that break the cliff line
  for (const [z, y, w] of [[-36, T2, 3.2], [-14, T2, 2.8], [8, T2, 3.4], [20, T2, 2.6]]) {
    const dz = rr(2.0, 3.6);
    add({ type: 'box', pos: [s * 50.4, y + 1.6, z], size: [3.2, 3.2, dz + 1.4], rot: rr(-0.25, 0.25), mat: 'rock' });
    add({ type: 'box', pos: [s * 50.9, y + 4.0, z + rr(-1, 1)], size: [2.6, 2.4, w], rot: rr(-0.3, 0.3), mat: SD });
  }
  // boulders at the foot of the shelf
  for (const z of [-30, -22, -10, 4, 18, 30]) boulder(s * rr(35.2, 36.6), z + rr(-2, 2), rr(1.4, 2.3), 'rock');
}
shelves(-1, { z0: -6, z1: 10, dir: '+z' });
shelves(1, { z0: -10, z1: 6, dir: '-z' });

// ================================================================== 5. AQUEDUCT + BRIDGES
const AQ_Z = -30;
const AQ_BOTTOM = 12.4;
const AQ_TOP = 13.4;
function aqSpan(xa, xb, base) {
  const w = xb - xa, cx = (xa + xb) / 2;
  const H = AQ_BOTTOM - base;
  const t = w >= 8 ? 1.3 : 1.2;
  if (H > 9) {
    const h1 = 6.2, h2 = H - h1;
    add({ type: 'arch', pos: [cx, base + h1 / 2, AQ_Z], size: [w, h1, 4.2], thickness: t, lintel: 1.1, mat: 'sandstone' });
    add({ type: 'arch', pos: [cx, base + h1 + h2 / 2, AQ_Z], size: [w, h2, 3.8], thickness: t, lintel: 1.0, mat: 'sandstone' });
  } else {
    add({ type: 'arch', pos: [cx, base + H / 2, AQ_Z], size: [w, H, 4.0], thickness: t, lintel: Math.min(1.0, H - 2.7), mat: 'sandstone' });
  }
}
function aqDeck(x0, x1, gaps = []) {
  box(x0, AQ_BOTTOM, AQ_Z - 2.25, x1, AQ_TOP, AQ_Z + 2.25, 'sandstone', { top: 'sandstone' });
  box(x0, 12.0, AQ_Z - 2.5, x1, AQ_BOTTOM + 0.02, AQ_Z + 2.5, SD, { collide: false });
  box(x0, AQ_TOP, AQ_Z - 1.75, x1, AQ_TOP + 0.2, AQ_Z + 1.75, 'water', { collide: false, shadow: false });
  // parapets, with optional gaps [a, b] on the south side
  for (const side of [-1, 1]) {
    const zc = AQ_Z + side * 2.0;
    let a = x0;
    const cuts = side > 0 ? gaps : [];
    for (const [ga, gb] of cuts) { if (ga > a) box(a, AQ_TOP, zc - 0.25, ga, AQ_TOP + 1.1, zc + 0.25, 'sandstone'); a = gb; }
    box(a, AQ_TOP, zc - 0.25, x1, AQ_TOP + 1.1, zc + 0.25, 'sandstone');
  }
}
// west arm: x -52 .. -6 (intact), stairs from the west upper shelf
{
  const xs = [-52, -46, -38, -29.5, -21, -12.5, -6];
  const bases = [T2, T1, 0, 0, 0, 0];
  for (let i = 0; i < bases.length; i++) aqSpan(xs[i], xs[i + 1], bases[i]);
  aqDeck(-52, -6, [[-51.5, -48]]);
  stairs(-52, AQ_Z + 2.25, -49, -10, T2, AQ_TOP, '-z', SD, 'sandstone');
}
// east arm: x 52 .. 20 (broken off), reached by jump pad or grapple
{
  const xs = [52, 46, 38, 29, 20];
  const bases = [T2, T1, 0, 0];
  for (let i = 0; i < bases.length; i++) aqSpan(xs[i + 1], xs[i], bases[i]);
  aqDeck(20, 52);
  // ragged broken end + fallen deck chunk
  box(17.4, AQ_BOTTOM + 0.3, AQ_Z - 2.25, 20, AQ_TOP - 0.3, AQ_Z + 2.0, 'sandstone', { collide: false });
  add({ type: 'box', pos: [12, 1.1, -24], size: [7.5, 2.0, 4.4], rot: 0.5, mat: 'sandstone' });
  add({ type: 'box', pos: [16.5, 0.7, -26.5], size: [3.4, 1.4, 2.6], rot: -0.4, mat: SD });
  rubble(14, -25, 7, 3.2);
}
// aqueduct keystone glyphs
for (const x of [-34, -25, -17, 25, 33.5, 42]) {
  glyph('+z', AQ_Z + 2.5, x, 12.2, 0.5, 0.5, 'neon_green');
}

// bridges from the canyon upper shelves to the hall roof at z -46 .. -42
function bridge(s, broken) {
  const xa = s * 46, xb = s * 24;
  const lo = Math.min(xa, xb), hi = Math.max(xa, xb);
  const archX = [46, 39, 32, 25]; // arch boundaries (abs x)
  const spans = broken ? 2 : 3;
  for (let i = 0; i < spans; i++) {
    const a = s * archX[i], b = s * archX[i + 1];
    add({ type: 'arch', pos: [(a + b) / 2, 3.9, -44], size: [7, 7.8, 4.0], thickness: 1.2, lintel: 1.2, mat: 'sandstone' });
  }
  if (!broken) {
    box(lo, 7.8, -46, hi, T2, -42, 'sandstone', { top: 'sandstone' });
    for (const zc of [-45.7, -42.3]) box(lo, T2, zc - 0.3, hi, T2 + 1.0, zc + 0.3, 'sandstone');
  } else {
    // east bridge: collapsed after the second arch (deck ends at x 32; ragged stub near the hall)
    const cut = s * 32;
    box(Math.min(xa, cut), 7.8, -46, Math.max(xa, cut), T2, -42, 'sandstone', { top: 'sandstone' });
    for (const zc of [-45.7, -42.3]) box(Math.min(xa, cut), T2, zc - 0.3, Math.max(xa, cut), T2 + 1.0, zc + 0.3, 'sandstone');
    box(24, 7.8, -46, 27.5, T2, -42, 'sandstone', { top: 'sandstone' });
    rubble(29.5, -44, 5, 2.4);
    add({ type: 'box', pos: [34.5, 0.9, -48.5], size: [5.6, 1.8, 3.4], rot: 0.3, mat: 'sandstone' });
  }
}
bridge(-1, false);
bridge(1, true);

// ================================================================== 6. SUNKEN WATER COURTYARD (SW)
// rim walls: west + south (8 m, carved), gate posts + lintel over the north stairs
box(-38, -0.5, 10, -35.02, 8, 30, SD);
box(-38, -0.5, 30.02, -15, 8, 32, SD);
box(-38.2, 8, 9.8, -34.8, 8.5, 30.2, 'sandstone', { top: 'sandstone' });
box(-38.2, 8, 30.0, -14.8, 8.5, 32.2, 'sandstone', { top: 'sandstone' });
box(-35.16, 6.2, 10, -35.02, 6.5, 30, 'gold', { collide: false });
box(-38, 6.2, 29.86, -15, 6.5, 30.02, 'gold', { collide: false });
for (let z = 12.5; z <= 27; z += 3.5) glyph('+x', -35.02, z, 3.3, 0.5, 3.2, 'neon_green');
for (let x = -33.5; x <= -17; x += 3.5) glyph('-z', 30.02, x, 3.3, 0.5, 3.2, 'neon_green');
// pilasters break up the walls a little (kept shallow so wall-runs stay clean)
for (let z = 14; z <= 26; z += 6) box(-35.02, -1.6, z - 0.5, -34.78, 6.2, z + 0.5, 'sandstone', { collide: false });
for (let x = -31.5; x <= -19; x += 6) box(x - 0.5, -1.6, 29.78, x + 0.5, 6.2, 30.02, 'sandstone', { collide: false });
// stairs down: east side (wide) + north side
stairs(-19, 14, -15, 26, -1.6, 0, '+x', 'sandstone', 'sandstone');
stairs(-31, 10, -23, 14, -1.6, 0, '-z', 'sandstone', 'sandstone');
// water surface + island with steps
box(-35, -1.16, 10, -15, -1.0, 30, 'water', { collide: false, shadow: false });
box(-30, -1.6, 17, -24, -0.75, 23, 'marble', { top: 'marble' });
box(-29, -0.75, 18, -25, -0.3, 22, 'marble', { top: 'gold' });
// propylon over the north stairs
pillar(-33.6, 8.8, 0, 6.6, 0.8, 'sandstone', 12);
pillar(-20.4, 8.8, 0, 6.6, 0.8, 'sandstone', 12);
box(-35.2, 6.6, 8.0, -18.8, 7.7, 9.6, SD, { top: 'sandstone' });
box(-35.3, 7.1, 7.9, -18.7, 7.4, 9.7, 'gold', { collide: false });
glyph('-z', 8.0, -27, 7.15, 8, 0.3, 'neon_green');
// fallen columns in the bath
fallenColumn(-31.5, 26.5, 5, 0.65, 0.3, 'x', -1.6);
fallenColumn(-21, 13.5, 4, 0.6, 1.1, 'x', -1.6);
rubble(-19.5, 27, 4, 1.4, -1.6);
rubble(-33, 12, 3, 1.0, -1.6);

// ================================================================== 7. AVENUES: colonnade (east), broken arches (west), obelisks
// east colonnade with walk-on architraves
for (const z of [-22, -15, -8.5]) pillar(31, z, 0, 7.6, 0.85, 'sandstone', 12);
for (const z of [8.5, 15, 22]) pillar(31, z, 0, 7.6, 0.85, 'sandstone', 12);
box(30.1, 7.6, -22, 31.9, 8.6, -15, SD, { top: 'sandstone' });
box(30.1, 7.6, 15, 31.9, 8.6, 22, SD, { top: 'sandstone' });
box(30.1, 7.6, 8.5, 31.9, 8.6, 15, SD, { top: 'sandstone' });
box(30.1, 7.6, -15, 31.9, 8.6, -12, SD, { top: 'sandstone' });        // broken stub
pillar(31, -3.6, 0, 3.4, 0.85, 'sandstone', 12);                       // shattered near the pad
rubble(31, -1.8, 4, 1.8);
fallenColumn(28.5, -12, 5.5, 0.8, 0.12, 'z');
// west arches (one intact, one broken)
add({ type: 'arch', pos: [-30, 5, -9], size: [12, 10, 2.2], thickness: 1.6, lintel: 1.4, mat: SD });
box(-36, 0, -21.5, -34.4, 6.2, -19.3, SD);
box(-36, 6.2, -21.5, -33, 7.0, -19.3, SD, { collide: false });
add({ type: 'box', pos: [-28, 0.9, -19.2], size: [6.5, 1.8, 2.2], rot: 0.35, mat: SD });
rubble(-27, -21, 6, 3);
// obelisks
obelisk(-30, -15, 16, 1.3);
obelisk(26, -25, 14, 1.2);
obelisk(-10, 32, 14, 1.2);
obelisk(10, 32, 16, 1.3);

// ================================================================== 8. BAZAAR VILLAGE (SE) + SOUTH GATE + OASIS (SW)
function house(x0, z0, x1, z1, h, doors, mat = 'sandstone') {
  const t = 0.7;
  const find = s => doors.find(d => d.side === s);
  axisWall(x0, z0, x1, z0, 0, h, t, mat, find('n'));
  axisWall(x0, z1, x1, z1, 0, h, t, mat, find('s'));
  axisWall(x0, z0, x0, z1, 0, h, t, mat, find('w'));
  axisWall(x1, z0, x1, z1, 0, h, t, mat, find('e'));
  box(x0 - 0.5, h, z0 - 0.5, x1 + 0.5, h + 0.4, z1 + 0.5, 'wood_planks', { top: 'wood_planks' });
  // roof beams peeking out
  for (let x = x0 + 1; x < x1; x += 2) box(x - 0.12, h - 0.25, z0 - 0.7, x + 0.12, h, z0 - 0.5, 'wood_planks', { collide: false });
}
const HR = 4.2;
house(13, 26, 23, 34, HR, [{ side: 'n', at: 17, w: 3, h: 2.8 }, { side: 's', at: 20, w: 3, h: 2.8 }, { side: 'e', at: 30, w: 2.6, h: 2.8 }]);
house(13, 38, 23, 46, HR, [{ side: 'n', at: 20, w: 3, h: 2.8 }, { side: 'e', at: 42, w: 3, h: 2.8 }]);
house(27, 38, 35, 46, HR, [{ side: 'w', at: 42, w: 3, h: 2.8 }, { side: 'n', at: 31, w: 3, h: 2.8 }]);
// planks across the alleys + sand ramp up to the first roof
box(17, HR, 34.4, 19.2, HR + 0.4, 37.6, 'wood_planks', { top: 'wood_planks' });
box(22.5, HR, 41, 27.5, HR + 0.4, 43, 'wood_planks', { top: 'wood_planks' });
ramp(23.5, 28, 33.5, 32.2, 0, HR + 0.4, '-x', 'sand', 'sand');
// roof props
box(14, HR + 0.4, 27.2, 16.6, HR + 1.6, 28.6, 'sandstone');
add({ type: 'crate', pos: [21, HR + 1.0, 44.5], size: 1.2 });
add({ type: 'crate', pos: [22.2, HR + 1.0, 44.9], size: [1.1, 1.1, 1.1], rot: 0.4 });
add({ type: 'crate', pos: [31, HR + 1.0, 39.5], size: 1.2 });
// market stalls, crates, barrels
function stall(x, z, w = 4, rot = 0) {
  const c = Math.cos(rot), s = Math.sin(rot);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const px = x + (sx * (w / 2) * c - sz * 1.2 * s), pz = z + (sx * (w / 2) * s + sz * 1.2 * c);
    add({ type: 'cylinder', pos: [px, 1.4, pz], radius: 0.09, height: 2.8, sides: 6, mat: 'wood_planks' });
  }
  add({ type: 'box', pos: [x, 2.85, z], size: [w + 0.6, 0.14, 3.0], rot, mat: 'wood_planks' });
  add({ type: 'box', pos: [x, 0.5, z], size: [w - 0.6, 1.0, 1.0], rot, mat: 'wood_planks' });
}
stall(30, 26, 4, 0.1);
stall(6, 40, 4, -0.2);
add({ type: 'crate', pos: [26.6, 0.6, 24.6], size: 1.2 });
add({ type: 'crate', pos: [27.9, 0.6, 24.9], size: 1.2, rot: 0.3 });
add({ type: 'crate', pos: [27.2, 1.8, 24.7], size: 1.1, rot: 0.15 });
add({ type: 'crate', pos: [36, 0.6, 32], size: 1.2 });
add({ type: 'crate', pos: [36.2, 0.6, 33.3], size: [1.2, 1.2, 1.2], rot: 0.2 });
add({ type: 'crate', pos: [24.5, 0.6, 47.5], size: 1.5 });
for (const [x, z] of [[24.2, 36.2], [25.4, 36.6], [24.8, 37.6], [3, 43.5], [4.1, 44], [-4, 27], [-4.9, 27.9]]) cyl(x, 0, z, 0.45, 1.05, 'wood_planks', { sides: 10 });
// south gate ruin
add({ type: 'arch', pos: [0, 7, 40], size: [14, 14, 3.2], thickness: 3.2, lintel: 2.4, mat: SD });
box(-7.3, 13.6, 38.2, 7.3, 14.4, 41.8, 'sandstone', { collide: false });
glyph('-z', 38.4, 0, 12.4, 6.5, 0.4, 'neon_orange');
glyph('-z', 38.4, -5.4, 5.5, 0.5, 4, 'neon_green');
glyph('-z', 38.4, 5.4, 5.5, 0.5, 4, 'neon_green');
add({ type: 'box', pos: [9.6, 1.0, 44], size: [7, 2.0, 3.2], rot: 0.45, mat: 'sandstone' });
rubble(9, 41, 6, 2.6);
ruinWall(-22, 38, -8, 38, 0, 3.4, 1.0, SD);
ruinWall(8, 50, 20, 50, 0, 3.0, 1.0, SD);
// dunes
dune(-4, 47, 7, 1.7); dune(-18, 47, 8, 1.5); dune(4, 51, 6, 1.2); dune(38, 44, 5, 1.4, 0.4);
dune(-6, 15, 4.2, 0.9); dune(8, -30, 3.6, 0.8); dune(-42, 44, 6, 1.6);
// oasis
grassPatch(-29, 42, 9, 6, 0.3); grassPatch(-25, 45, 6, 5, -0.4); grassPatch(-33, 39, 5, 4, 0.9); grassPatch(-22, 38, 3.5, 3, 0.2);
for (const [x, z, h] of [[-29, 42, 7.2], [-25.5, 45, 6.0], [-33, 40, 6.6], [-22.5, 38.5, 5.4], [-30.5, 46, 5.2]]) palm(x, z, h);
for (const [x, z, r] of [[-27, 40, 1.0], [-31, 44, 1.2], [-24, 42, 0.9], [-35, 42, 1.0]]) bush(x, z, r);
// pit rim oasis
grassPatch(-13, 7, 5, 4, 0.2); grassPatch(-37, 5, 4, 3, -0.3);
palm(-13, 7, 5.6); palm(-37, 4.5, 6.4);
bush(-15, 6, 0.9); bush(-36, 7, 0.9);

// ================================================================== 9. COVER & DRESSING
// fallen blocks and columns around the plaza
add({ type: 'box', pos: [-16, 0.65, -30], size: [3.2, 1.3, 1.5], rot: 0.25, mat: 'sandstone' });
add({ type: 'box', pos: [17, 0.65, -12], size: [2.4, 1.3, 2.4], rot: 0.5, mat: SD });
add({ type: 'box', pos: [-20, 0.65, 8], size: [2.6, 1.3, 1.6], rot: -0.4, mat: 'sandstone' });
fallenColumn(-14, -32, 6, 0.75, 0.45, 'x');
fallenColumn(17, 30, 5, 0.7, -0.2, 'x');
fallenColumn(-24, 30, 4.5, 0.7, 0.9, 'x');
rubble(-16, -30, 5, 2.4); rubble(19, -13, 4, 2); rubble(-20, 8, 4, 2);
// ruined wall stubs framing the paths
ruinWall(-12, -25, -12, -34, 0, 2.6, 0.9, 'sandstone');
ruinWall(12, -33, 12, -26, 0, 2.6, 0.9, 'sandstone');
ruinWall(-32, 22, -22, 22, 0, 2.2, 0.9, SD);
ruinWall(-8, 24, -8, 30, 0, 2.4, 0.9, 'sandstone');
ruinWall(8, 24, 8, 30, 0, 2.4, 0.9, 'sandstone');
ruinWall(18, 10, 26, 10, 0, 2.0, 0.9, SD);
// dirt wear near the bazaar and paths
grassPatch(0, 0, 0.1, 0.1);
add({ type: 'box', pos: [28, 0.02, 30], size: [12, 0.06, 9], rot: 0.1, mat: 'dirt' });
add({ type: 'box', pos: [-8, 0.02, 40], size: [8, 0.06, 5], rot: -0.2, mat: 'dirt' });
add({ type: 'box', pos: [-32, 0.02, -30], size: [7, 0.06, 6], rot: 0.5, mat: 'dirt' });
// boulders along the cliff bases (north and south walls)
for (const x of [-46, -38, 36, 46]) boulder(x, -35 + rr(-1, 1), rr(1.6, 2.6), 'rock');
for (const x of [-48, -36, 26, 44]) boulder(x, 49 + rr(-1, 1), rr(1.8, 3.0), 'rock');
for (const x of [-30, 22, 40]) boulder(x, -49.5 + rr(-1, 1), rr(1.6, 2.4), 'rock');
// T1 terrace cover
add({ type: 'box', pos: [-8, T1 + 0.6, 9.5], size: [2.4, 1.2, 1.4], rot: 0.2, mat: 'sandstone' });
add({ type: 'box', pos: [9, T1 + 0.6, -9.5], size: [2.4, 1.2, 1.4], rot: -0.2, mat: 'sandstone' });
rubble(-10, 10.5, 3, 1.2, T1); rubble(10, -10.5, 3, 1.2, T1);
// shelf shrines: sniper perch ruins
ruinWall(-51.6, 20, -47, 20, T2, 1.3, 0.6, 'sandstone');
ruinWall(51.6, -30, 47, -30, T2, 1.3, 0.6, 'sandstone');
// hall roof cover
add({ type: 'box', pos: [-12, T2 + 0.6, -47], size: [2.6, 1.2, 1.6], rot: 0.2, mat: 'sandstone' });
add({ type: 'box', pos: [12, T2 + 0.6, -43], size: [2.6, 1.2, 1.6], rot: -0.3, mat: 'sandstone' });

// ================================================================== 10. JUMP PAD PLATES
const pads = [
  { pos: [-31, 0, 0], target: [-40, T1, 0], apex: 3.0 },
  { pos: [31, 0, 0], target: [40, T1, 0], apex: 3.0 },
  { pos: [9.5, T1, 9.5], target: [4.9, 14.3, 4.9], apex: 3.0 },
  { pos: [0, 0, -31], target: [0, T2, -45], apex: 3.5 }, // 6.4 m run-up: the arc must clear the T2 slab face at z -37.4
  { pos: [48.5, T2, -13], target: [44, AQ_TOP, -30], apex: 4.0 },
  { pos: [-33, -1.6, 26], target: [-36.5, 8.5, 21], apex: 3.0 },
];
for (const p of pads) padPlate(p.pos[0], p.pos[1], p.pos[2]);

// ================================================================== DEFINITION
export default {
  id: 'ruins',
  name: 'Ruins',
  subtitle: 'Desert temple - Midday',
  description: 'A sun-bleached temple complex in a desert canyon. Fight up a stepped ziggurat for the rocket launcher, wall-run the bath walls above the water court, and swing between obelisks under a broken aqueduct.',
  colors: ['#d9a441', '#2a5fbf'],
  bounds: { min: [-54, -3, -54], max: [54, 44, 54] },
  killY: -14,
  previewCamera: { pos: [43, 26, 47], lookAt: [-2, 5, -6] },
  theme: {
    sky: { top: '#1a55c4', horizon: '#dbe7f2', bottom: '#b89a6a', sunColor: '#fff1cf', sunSize: 1.25, stars: false, clouds: 0.22 },
    sun: { dir: [-0.36, 0.84, 0.4], color: '#fff0d6', intensity: 2.8 },
    hemi: { sky: '#a8c6f2', ground: '#cba76d', intensity: 0.85 },
    fog: { color: '#ead3a8', near: 85, far: 320 },
    exposure: 0.88,
    envIntensity: 0.5,
    // bloom (see Game._setupComposer): strength = the value at 100 % Glow (default setting 65 %)
    bloom: { strength: 2.4, radius: 0.8, threshold: 0.7, knee: 0.3 },
  },
  solids,
  lights: [
    { pos: [0, 12.0, 0], color: '#ffbe6b', intensity: 46, distance: 18 },
    { pos: [0, 6.6, -46], color: '#ffc880', intensity: 50, distance: 26 },
    { pos: [-26, 2.6, 20], color: '#7cf0ff', intensity: 38, distance: 20 },
    { pos: [18, 3.2, 30], color: '#ffb070', intensity: 26, distance: 12 },
  ],
  spawns: [
    { pos: [-30, 0, -24], lookAt: [0, 0, -4] },
    { pos: [30, 0, -26], lookAt: [0, 0, -4] },
    { pos: [-27, 0, 6], lookAt: [0, 0, 0] },
    { pos: [28, 0, 12], lookAt: [0, 0, 0] },
    { pos: [-9, 0, 31], lookAt: [0, 0, 10] },
    { pos: [9, 0, 28], lookAt: [0, 0, 10] },
    { pos: [0, 0, -35], lookAt: [0, 0, 0] },
    { pos: [-30, 0, 46], lookAt: [0, 0, 10] },
    { pos: [26, 0, 50], lookAt: [0, 0, 10] },
    { pos: [0, 0, 49], lookAt: [0, 0, 0] },
    { pos: [-12, 0, -46], lookAt: [0, 0, -30] },
    { pos: [12, 0, -46], lookAt: [0, 0, -30] },
    { pos: [-40, T1, 10], lookAt: [0, T1, 0] },
    { pos: [40, T1, -14], lookAt: [0, T1, 0] },
    { pos: [-49, T2, -18], lookAt: [0, T2, 0] },
    { pos: [49, T2, 16], lookAt: [0, T2, 0] },
    { pos: [10, T1, -10], lookAt: [-10, T1, 10] },
    { pos: [-10, T1, 10], lookAt: [10, T1, -10] },
  ],
  pickups: [
    { type: 'weapon', weapon: 'rocket', pos: [0, T2 + 0.68, 0] },
    { type: 'weapon', weapon: 'arc', pos: [13.5, 4.5, -0.5] },
    { type: 'weapon', weapon: 'gale', pos: [-1.5, 3.73, -15.5] },
    { type: 'weapon', weapon: 'sniper', pos: [-49, T2, 24] },
    { type: 'weapon', weapon: 'sniper', pos: [0, T2, -46] },
    { type: 'weapon', weapon: 'smg', pos: [-24, 0, -20] },
    { type: 'weapon', weapon: 'rail', pos: [-44, 0, -50] },
    { type: 'weapon', weapon: 'shotgun', pos: [18, 0, 30] },
    { type: 'health', pos: [-27, -0.3, 20], amount: 50 },
    { type: 'health', pos: [0, 0, -41.4], amount: 25 },
    { type: 'health', pos: [42, T1, 4], amount: 25 },
    { type: 'health', pos: [-22, 0, 36], amount: 25 },
    { type: 'armor', pos: [0, 0, -50.4] },
    { type: 'armor', pos: [49, T2, -4] },
    { type: 'ammo', pos: [-42, T1, -18] },
    { type: 'ammo', pos: [-11, T1, -11] },
    { type: 'ammo', pos: [34, 0, 24] },
    { type: 'ammo', pos: [-6, 0, 46] },
    { type: 'grenades', pos: [-1, 0, 36], amount: 2 },
    { type: 'grenades', pos: [42, T1, -26], amount: 2 },
  ],
  // King of the Hill control zones, in rotation order: pos = floor centre [x, y, z], radius (m); entities count with feet within [-1.2, +3.2] m of the floor
  zones: [
    { id: 'ziggurat', name: 'Ziggurat', pos: [0, 9, 0], radius: 6 },
    { id: 'courtyard', name: 'Water Court', pos: [-26, -0.8, 17], radius: 8 },
    { id: 'hall', name: 'Great Hall', pos: [0, 0.4, -22], radius: 7 },
    { id: 'bazaar', name: 'Bazaar', pos: [22, 0, 30], radius: 8 },
  ],
  jumpPads: pads,
};
