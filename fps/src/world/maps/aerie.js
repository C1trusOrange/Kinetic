// "Aerie": a high-noon research station on five floating glacier plateaus above a sea of cloud.
//
//   x: west(-) .. east(+)   z: north(-) .. south(+)   y: up.   Play volume 124 x 124 m, kill plane at y -38.
//
//   Plateaus (top y 0)   C 'Summit Yard' (centre, 36 x 36, with the Spire observatory) and four 32 x 28 shelves:
//                        N 'Cryo Dock', E 'Skywatch', S 'Radio Hall', W 'Hangar'. Each shelf carries a roof building (T1, y 5)
//                        with a 3.6 m pass-through, two flank stairways and a sniper/spawn roof.
//   Bridges              four 6 m grated spokes (C <-> shelf) and four 4.5 m diagonal rim bridges (shelf <-> shelf). Each rim
//                        bridge has a 4.5 m parapet on its outer side = an 18.5 m wall-run lane; the inner side is open.
//   Tiers                U -7 (catch nets) . 0 deck . 4.6 Spire mezzanine + shelf roofs (5) . 9.2 Summit deck . 11 pylon perches.
//   Edge language        yellow rail = safe; no rail = drop. Four shelves have an 8 m open 'punt sill' (hazard strip + orange lip
//                        light); spokes and the rim inner sides are open. NE + SW pits are netted (safe, y -7); SE + NW pits are
//                        open voids (lethal). Slim recovery masts stand 1.5 m inside every lethal lip (grapple anchors).
//   Bots                 walk everything except the four pylon perches (grapple-only, T3); they never need them.
//   Players              wall-run the rim parapets, the shelf-building faces and the Spire N/S faces; grapple the summit mast,
//                        the recovery masts, pylons and rock cones; jump pads at the Spire and pit nets.

const solids = [];
const add = s => { solids.push(s); return s; };
const lo = Math.min;
const hi = Math.max;
const PI = Math.PI;
const K = Math.SQRT1_2;

const box = (a, b, o = {}) => add({
  type: 'box',
  min: [lo(a[0], b[0]), lo(a[1], b[1]), lo(a[2], b[2])],
  max: [hi(a[0], b[0]), hi(a[1], b[1]), hi(a[2], b[2])],
  ...o,
});
/** Visual-only box (never collides, never casts a shadow). */
const deco = (a, b, o = {}) => box(a, b, { collide: false, shadow: false, ...o });
/** Vertical cylinder standing on y. */
const cyl = (x, y, z, r, h, o = {}) => add({ type: 'cylinder', pos: [x, y + h / 2, z], radius: r, height: h, ...o });
const wallSeg = (x0, z0, x1, z1, y0, h, o = {}) => add({ type: 'wall', from: [x0, z0], to: [x1, z1], y0, height: h, ...o });
const RAIL_H = 1.45;                       // bots cannot jump 1.45 m; a player needs the double jump
const rail = (a, b, o = {}) => add({ type: 'railing', from: a, to: b, height: RAIL_H, ...o });

/** Wall along an axis with rectangular openings (door frames), every piece a plain box. */
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

/** Rails along an axis-aligned edge, leaving gaps [[c0, c1]] (coordinates along the edge). y = walking surface. */
function edgeRail(x0, z0, x1, z1, gaps = [], y = 0) {
  const alongX = Math.abs(x1 - x0) > Math.abs(z1 - z0);
  const a = alongX ? lo(x0, x1) : lo(z0, z1);
  const b = alongX ? hi(x0, x1) : hi(z0, z1);
  const fixed = alongX ? z0 : x0;
  const segs = [];
  let cur = a;
  for (const [g0, g1] of gaps.slice().sort((p, q) => p[0] - q[0])) { if (g0 > cur) segs.push([cur, g0]); cur = hi(cur, g1); }
  if (cur < b) segs.push([cur, b]);
  for (const [s0, s1] of segs) {
    if (s1 - s0 < 0.5) continue;
    rail(alongX ? [s0, y, fixed] : [fixed, y, s0], alongX ? [s1, y, fixed] : [fixed, y, s1]);
  }
}

// ------------------------------------------------------------------------------------------------ materials of the set
const DECK_C = 'stone_tiles';        // centre plateau (pale blue-grey tiles)
const DECK_S = 'concrete_floor';     // shelf yards
const CLIFF = 'glacier_rock';

// ------------------------------------------------------------------------------------------------ islands
/** 3 m slab (top y 0) + a hanging rock cone (solid: a grapple anchor under every plateau). */
function island(x0, z0, x1, z1, top) {
  box([x0, -3, z0], [x1, 0, z1], { mat: CLIFF, top, bottom: CLIFF });
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, r = lo(x1 - x0, z1 - z0) / 2;
  add({ type: 'cylinder', pos: [cx, -11, cz], radius: r * 0.12, radiusTop: r * 0.85, height: 16, sides: 10, mat: CLIFF });
}
island(-18, -18, 18, 18, DECK_C);           // C
island(-16, -58, 16, -30, DECK_S);          // N
island(-16, 30, 16, 58, DECK_S);            // S
island(30, -16, 58, 16, DECK_S);            // E
island(-58, -16, -30, 16, DECK_S);          // W

// C plateau: pale accent ring (visual only, 3 cm proud of the deck) and edge rails with gaps at the four spokes
for (const s of [-1, 1]) {
  for (const [a, b] of [[-16.7, -3.9], [3.9, 16.7]]) {
    deco([a, 0, s * 16.1 - 0.3], [b, 0.03, s * 16.1 + 0.3], { mat: 'tiles_white' });
    deco([s * 16.1 - 0.3, 0, a], [s * 16.1 + 0.3, 0.03, b], { mat: 'tiles_white' });
  }
}
edgeRail(-18, -18, 18, -18, [[-3.4, 3.4]]); edgeRail(-18, 18, 18, 18, [[-3.4, 3.4]]);
edgeRail(-18, -18, -18, 18, [[-3.4, 3.4]]); edgeRail(18, -18, 18, 18, [[-3.4, 3.4]]);

// ------------------------------------------------------------------------------------------------ spoke bridges (6 x 12 m)
function spoke(x0, z0, x1, z1) {
  box([x0, -0.6, z0], [x1, 0, z1], { mat: 'concrete_dark', top: 'metal_grate', bottom: 'metal_dark' });
  const alongZ = (x1 - x0) < (z1 - z0);
  if (alongZ) {
    const cx = (x0 + x1) / 2;
    box([cx - 0.35, -1.25, z0], [cx + 0.35, -0.6, z1], { mat: 'metal_dark' });                    // centre truss
    for (const e of [x0, x1]) {
      const s = e === x0 ? 1 : -1;
      box([e, -1.3, z0], [e + s * 0.28, -0.6, z1], { mat: 'metal_dark' });                          // edge girders
      deco([e, 0, z0 + 0.5], [e + s * 0.16, 0.03, z1 - 0.5], { mat: 'neon_blue' });                 // edge marker line
    }
  } else {
    const cz = (z0 + z1) / 2;
    box([x0, -1.25, cz - 0.35], [x1, -0.6, cz + 0.35], { mat: 'metal_dark' });
    for (const e of [z0, z1]) {
      const s = e === z0 ? 1 : -1;
      box([x0, -1.3, e], [x1, -0.6, e + s * 0.28], { mat: 'metal_dark' });
      deco([x0 + 0.5, 0, e], [x1 - 0.5, 0.03, e + s * 0.16], { mat: 'neon_blue' });
    }
  }
}
spoke(-3, -30, 3, -18); spoke(-3, 18, 3, 30); spoke(18, -3, 30, 3); spoke(-30, -3, -18, 3);

// ------------------------------------------------------------------------------------------------ rim bridges (4.5 m diagonals + parapet)
/** Deck between two shelf corners + outer parapet (wall-run lane). (nx, nz) = outward normal. */
function rim(x0, z0, x1, z1, nx, nz) {
  wallSeg(x0, z0, x1, z1, -0.6, 0.59, { thickness: 4.5, mat: 'concrete_dark', top: 'metal_grate', bottom: 'metal_dark' });
  const dx = x1 - x0, dz = z1 - z0, L = Math.hypot(dx, dz), ux = dx / L, uz = dz / L;
  wallSeg(x0 + ux * 1.5, z0 + uz * 1.5, x1 - ux * 1.5, z1 - uz * 1.5, -1.3, 0.7, { thickness: 0.9, mat: 'metal_dark' });   // truss under the deck
  const s0 = 3.5, s1 = L - 3.5;
  const pa = [x0 + ux * s0 + nx * 2.4, z0 + uz * s0 + nz * 2.4], pb = [x0 + ux * s1 + nx * 2.4, z0 + uz * s1 + nz * 2.4];
  wallSeg(pa[0], pa[1], pb[0], pb[1], -0.6, 5.1, { thickness: 0.5, mat: 'metal_panel' });
  wallSeg(pa[0], pa[1], pb[0], pb[1], 4.5, 0.14, { thickness: 0.72, mat: 'metal_painted_yellow', collide: false, shadow: false });   // yellow cap
  // cyan lane line on the parapet's deck-side face + edge marker on the open inner side
  const ia = [pa[0] - nx * 0.28, pa[1] - nz * 0.28], ib = [pb[0] - nx * 0.28, pb[1] - nz * 0.28];
  wallSeg(ia[0], ia[1], ib[0], ib[1], 3.0, 0.12, { thickness: 0.05, mat: 'neon_blue', collide: false, shadow: false });
  const ja = [x0 + ux * 1.2 - nx * 2.2, z0 + uz * 1.2 - nz * 2.2], jb = [x1 - ux * 1.2 - nx * 2.2, z1 - uz * 1.2 - nz * 2.2];
  wallSeg(ja[0], ja[1], jb[0], jb[1], 0, 0.03, { thickness: 0.16, mat: 'neon_blue', collide: false, shadow: false });
}
rim(14, -32, 32, -14, K, -K);        // NE (inner side over the NE net)
rim(32, 14, 14, 32, K, K);           // SE (inner side over the SE void)
rim(-14, 32, -32, 14, -K, K);        // SW (net)
rim(-32, -14, -14, -32, -K, -K);     // NW (void)

// ------------------------------------------------------------------------------------------------ the Spire (observatory)
wallRun('x', -10, -10, 10, 0, 4.1, 0.6, 'concrete', [{ c: 0, w: 4, y0: 0, y1: 3.2 }]);     // north face + door
wallRun('x', 10, -10, 10, 0, 4.1, 0.6, 'concrete', [{ c: 0, w: 4, y0: 0, y1: 3.2 }]);      // south face + door
wallRun('z', -10, -10, 10, 0, 4.1, 0.6, 'concrete');                                          // west face (stairs outside)
wallRun('z', 10, -10, 10, 0, 4.1, 0.6, 'concrete');                                           // east face
// mezzanine (T1, y 4.6): one slab over the lobby, a 4 m balcony to the south so the summit stairs have a landing
box([-10, 4.1, -10], [10, 4.6, 14], { mat: 'metal_panel', top: DECK_C, bottom: 'metal_dark' });
deco([-6.5, 4.6, -0.3], [6.5, 4.63, 0.3], { mat: 'tiles_white' });
deco([-0.3, 4.6, 3], [0.3, 4.63, 12.7], { mat: 'tiles_white' });
for (const x of [-8.6, 8.6]) cyl(x, 0, 13.2, 0.4, 4.1, { sides: 8, mat: 'metal_dark' });   // balcony posts
add({ type: 'stairs', pos: [-14, 2.3, 0], size: [8, 4.6, 3.6], dir: '+x', mat: 'concrete_dark', top: 'metal_grate' });
add({ type: 'stairs', pos: [14, 2.3, 0], size: [8, 4.6, 3.6], dir: '-x', mat: 'concrete_dark', top: 'metal_grate' });
add({ type: 'stairs', pos: [0, 6.9, 6], size: [4, 4.6, 8], dir: '-z', mat: 'concrete_dark', top: 'metal_grate' });   // T1 -> summit
// summit deck (T2, y 9.2) on four pillars; only the south edge has rails
box([-10, 8.7, -10], [10, 9.2, 2], { mat: 'metal_panel', top: DECK_C, bottom: 'metal_dark' });
deco([-9.2, 9.2, -9.2], [9.2, 9.23, -8.6], { mat: 'tiles_white' });
for (const [x, z] of [[-9, -9], [9, -9], [-9, 1], [9, 1]]) add({ type: 'pillar', pos: [x, 6.65, z], radius: 0.5, height: 4.1, sides: 8 });
cyl(0, 9.2, -8.5, 0.35, 14.8, { sides: 8, mat: 'metal_dark' });                                    // mast (grapple anchor, y 24)
cyl(0, 24, -8.5, 0.5, 0.6, { sides: 8, mat: 'neon_blue', collide: false, shadow: false });         // beacon
deco([-1.6, 20, -8.62], [1.6, 20.16, -8.38], { mat: 'metal_dark' });                               // antenna cross-arm
cyl(-7, 9.2, -7.5, 2.2, 2.0, { sides: 16, mat: 'container_white' });                               // observatory cab
cyl(-7, 11.2, -7.5, 2.2, 1.1, { sides: 16, radiusTop: 0.9, mat: 'tiles_white' });                    // dome
cyl(-7, 10.3, -7.5, 2.23, 0.12, { sides: 16, mat: 'neon_blue', collide: false, shadow: false });
add({ type: 'box', pos: [7, 10.0, -7.5], size: [3, 1.6, 3], mat: 'container_blue', bevel: 0.08 });  // instrument bay
edgeRail(-10, 2, 10, 2, [[-2.4, 2.4]], 9.2);
// mezzanine rails (gaps at the two outdoor stairways)
edgeRail(-10, -10, 10, -10, [], 4.6); edgeRail(-10, 14, 10, 14, [], 4.6);
edgeRail(-10, -10, -10, 14, [[-2.4, 2.4]], 4.6); edgeRail(10, -10, 10, 14, [[-2.4, 2.4]], 4.6);
// lobby: central column, cover, ceiling light strips, door frames
add({ type: 'pillar', pos: [0, 2.05, 0], radius: 0.7, height: 4.1, sides: 8 });
add({ type: 'crate', pos: [-6, 0.6, -6], size: 1.2 }); add({ type: 'crate', pos: [-4.8, 0.6, -6.2], size: 1.2, rot: 0.3 });
add({ type: 'crate', pos: [6, 0.6, 6], size: 1.2 }); add({ type: 'crate', pos: [5, 0.6, 6.3], size: 1.2, rot: 0.3 });
deco([-6, 4.0, -2], [6, 4.09, -1.4], { mat: 'light_panel' }); deco([-6, 4.0, 1.4], [6, 4.09, 2], { mat: 'light_panel' });
for (const z of [-10.31, 10.31]) {
  const d = z < 0 ? -1 : 1;
  deco([-2.3, 0, z], [-2.0, 3.4, z + d * 0.06], { mat: 'metal_painted_yellow' });
  deco([2.0, 0, z], [2.3, 3.4, z + d * 0.06], { mat: 'metal_painted_yellow' });
  deco([-2.3, 3.2, z], [2.3, 3.45, z + d * 0.06], { mat: 'metal_painted_yellow' });
}
for (const x of [-10.32, 10.32]) deco([x - 0.04, 2.9, -6], [x + 0.04, 3.05, 6], { mat: 'neon_blue' });    // status lines on the E/W faces
// plateau cover
for (const [x, z] of [[-14, 6.5], [14, -6.5], [-6.5, 14.5], [6.5, -14.5]]) add({ type: 'box', pos: [x, 0.65, z], size: [2.4, 1.3, 2.4], top: 'snow', mat: 'stone_blocks', bevel: 0.08 });

// ------------------------------------------------------------------------------------------------ shelves (built for N, rotated by quarter turns: N, E, S, W)
const SHELF = [
  { name: 'cryo', wall: 'metal_panel' },
  { name: 'sky', wall: 'metal_panel' },
  { name: 'radio', wall: 'concrete_dark' },
  { name: 'hangar', wall: 'metal_panel' },
];
const rotQ = (q, x, z) => {   // (x, z) -> (-z, x), q times
  let px = x, pz = z;
  for (let i = 0; i < q; i++) { const t = px; px = -pz; pz = t; }
  return [px, pz];
};
function shelf(q) {
  const st = SHELF[q];
  const R = (x, z) => rotQ(q, x, z);
  const rb = (a, b, o) => { const p = R(a[0], a[2]), r = R(b[0], b[2]); return box([p[0], a[1], p[1]], [r[0], b[1], r[1]], o); };
  const rd = (a, b, o) => { const p = R(a[0], a[2]), r = R(b[0], b[2]); return deco([p[0], a[1], p[1]], [r[0], b[1], r[1]], o); };
  const rc = (x, y, z, r, h, o) => { const p = R(x, z); return cyl(p[0], y, p[1], r, h, o); };
  const rl = (x0, z0, x1, z1, gaps, y = 0) => {
    const p = R(x0, z0), r = R(x1, z1);
    const worldX = Math.abs(r[0] - p[0]) > Math.abs(r[1] - p[1]);
    const localX = Math.abs(x1 - x0) > Math.abs(z1 - z0);
    const wg = gaps.map(([g0, g1]) => {
      const a = localX ? R(g0, z0) : R(x0, g0), b = localX ? R(g1, z0) : R(x0, g1);
      const u = worldX ? a[0] : a[1], v = worldX ? b[0] : b[1];
      return [lo(u, v), hi(u, v)];
    });
    edgeRail(p[0], p[1], r[0], r[1], wg, y);
  };
  const rp = (x, y, z, w, h, o) => { const p = R(x, z); return add({ type: 'panel', pos: [p[0], y, p[1]], size: [w, h], rot: -q * PI / 2, ...o }); };
  const long = q % 2 === 0 ? 'x' : 'z';     // world axis of the shelf's local X direction

  // building: one roof slab (T1, y 5, walkable top) on two piers = a 3.6 x 3.2 m pass-through from the yard to the back deck
  rb([-12, 0, -56], [-1.8, 3.2, -46], { mat: st.wall });
  rb([1.8, 0, -56], [12, 3.2, -46], { mat: st.wall });
  rb([-12, 3.2, -56], [12, 5, -46], { mat: st.wall, top: 'snow', bottom: 'metal_dark' });
  rd([-0.7, 3.14, -55.5], [0.7, 3.2, -46.5], { mat: 'light_panel' });                       // tunnel ceiling strip
  for (const s of [-1, 1]) {
    rd([s * 1.8 - 0.15, 0, -46.06], [s * 1.8 + 0.15, 3.5, -46], { mat: 'metal_painted_yellow' });   // door frame on the yard face
  }
  rd([-2.0, 3.2, -46.06], [2.0, 3.5, -46], { mat: 'metal_painted_yellow' });
  // flank stairways (top step meets the roof edge)
  const dirs = ['-z', '+x', '+z', '-x'];
  for (const sx of [-1, 1]) {
    const p = R(sx * 13.5, -42.75);
    add({ type: 'stairs', pos: [p[0], 2.5, p[1]], size: (q % 2 === 0) ? [3, 5, 8.5] : [8.5, 5, 3], dir: dirs[q], mat: 'concrete_dark', top: 'metal_grate' });
  }
  // roof rails: back and sides (the yard edge stays open, the drop is safe), a 2 m gap where each stairway steps on
  rl(-12, -56, 12, -56, [], 5);
  rl(-12, -56, -12, -46, [[-48.2, -46]], 5);
  rl(12, -56, 12, -46, [[-48.2, -46]], 5);
  // yard cover
  const cov = (x, z, o = {}) => { const p = R(x, z); return add({ type: 'box', pos: [p[0], 0.65, p[1]], size: [2.4, 1.3, 2.4], rot: q * PI / 2, mat: 'stone_blocks', top: 'snow', bevel: 0.08, ...o }); };
  cov(-9, -36); cov(9, -36); cov(-5, -33); cov(5, -33);
  // open sill on the outer edge (8 m): hazard strip, orange lip light, flanking recovery masts
  rd([-4, 0, -57.55], [4, 0.03, -56.75], { mat: 'hazard' });
  rd([-4, 0, -58], [4, 0.05, -57.86], { mat: 'neon_orange' });
  for (const s of [-1, 1]) mast(...R(s * 5.4, -56.5));
  // shelf perimeter rails: outer edge (gap = the sill), the two sides, the yard edge (gaps = spoke and the rim bridge mouths)
  rl(-16, -58, 16, -58, [[-4, 4]]);
  rl(-16, -58, -16, -30, [[-33.6, -30]]);
  rl(16, -58, 16, -30, [[-33.6, -30]]);
  rl(-16, -30, 16, -30, [[-3.4, 3.4], [-16, -12.4], [12.4, 16]]);
  const yaw = q * PI / 2 + PI / 2;    // long axis of a container lying across the shelf

  // ---- per-shelf character
  if (q === 0) {            // N Cryo Dock: coolant pipes + neon, ice cover, roof tanks
    cov(0, -41, { mat: 'ice', top: 'ice', bevel: 0.12 });
    for (const s of [-1, 1]) {
      const cx = s * 7.4;
      const p = R(cx, -45.8);
      add({ type: 'cylinder', pos: [p[0], 0.9, p[1]], radius: 0.2, height: 9, axis: long, sides: 8, mat: 'metal_dark', collide: false, shadow: false });
      add({ type: 'cylinder', pos: [p[0], 1.55, p[1]], radius: 0.14, height: 9, axis: long, sides: 8, mat: 'neon_blue', collide: false, shadow: false });
      rd([cx - 4.5, 2.45, -46.05], [cx + 4.5, 2.58, -46], { mat: 'neon_blue' });
    }
    for (const s of [-1, 1]) {
      rc(s * 8.5, 5, -51, 1.5, 2.6, { sides: 14, mat: 'container_white', top: 'ice' });
      rc(s * 8.5, 5.5, -51, 1.53, 0.3, { sides: 14, mat: 'neon_blue', collide: false, shadow: false });
    }
  } else if (q === 1) {     // E Skywatch: glass curtain wall, sun canopy over the roof pad, container cover
    for (const s of [-1, 1]) rp(s * 6.95, 2.2, -45.93, 9.1, 2.6, { mat: 'glass_window' });
    { const p = R(0, -41); add({ type: 'container', pos: [p[0], 1.3, p[1]], rot: yaw, color: 'white' }); }
    for (const [x, z] of [[-5.5, -54.5], [5.5, -54.5], [-5.5, -47.5], [5.5, -47.5]]) rc(x, 5, z, 0.3, 3.4, { sides: 8, mat: 'metal_dark' });
    rb([-6.4, 8.4, -55.4], [6.4, 8.7, -46.6], { mat: 'metal_panel', top: 'snow', bottom: 'metal_dark' });
    rd([-6.4, 8.35, -55.4], [6.4, 8.4, -55.2], { mat: 'neon_blue' });
  } else if (q === 2) {     // S Radio Hall: antenna array, dish, cable masts, hut, crate stack
    for (const [x, z, h] of [[-10.5, -54.5, 11], [10.5, -54.5, 9], [10.5, -47.5, 7]]) rc(x, 5, z, 0.16, h, { sides: 6, mat: 'metal_dark' });
    rc(-10.5, 16, -54.5, 0.28, 0.4, { sides: 8, mat: 'neon_orange', collide: false, shadow: false });
    rc(6.5, 5, -52.5, 0.3, 1.5, { sides: 8, mat: 'metal_dark' });
    rc(6.5, 6.5, -52.5, 0.4, 0.9, { sides: 16, radiusTop: 2.2, mat: 'metal_panel', top: 'metal_dark' });
    { const p = R(-6.5, -51); add({ type: 'container', pos: [p[0], 6.3, p[1]], rot: q * PI / 2, color: 'blue', size: [2.44, 2.6, 5] }); }
    cov(0, -41, { mat: 'concrete' });
    { const p = R(-3.5, -40.5); add({ type: 'crate', pos: [p[0], 0.6, p[1]], size: 1.2 }); add({ type: 'crate', pos: [p[0] + 1.3, 0.6, p[1] + 0.2], size: 1.2, rot: 0.4 }); add({ type: 'crate', pos: [p[0] + 0.6, 1.8, p[1] + 0.1], size: 1.2, rot: 0.2 }); }
  } else {                  // W Hangar: hazard trim, big painted door frame, orange containers
    rd([-11.6, 0, -46.06], [-2.4, 0.5, -46], { mat: 'hazard' });
    rd([2.4, 0, -46.06], [11.6, 0.5, -46], { mat: 'hazard' });
    for (const s of [-1, 1]) {
      rd([s * 6.9 - 4.4, 2.6, -46.06], [s * 6.9 + 4.4, 2.75, -46], { mat: 'metal_painted_yellow' });
      rd([s * 6.9 - 4.4, 3.9, -46.06], [s * 6.9 + 4.4, 4.05, -46], { mat: 'metal_painted_yellow' });
    }
    { const p = R(0, -41); add({ type: 'container', pos: [p[0], 1.3, p[1]], rot: yaw, color: 'orange' }); }
    rc(-8, 5, -53, 1.2, 1.4, { sides: 12, mat: 'container_orange' }); rc(8, 5, -53, 1.2, 1.4, { sides: 12, mat: 'container_orange' });
  }
}
for (let q = 0; q < 4; q++) shelf(q);

/** Recovery mast: slim 8 m pole (a grapple anchor above the lip) with an orange tip. */
function mast(x, z, y = 0, h = 8) {
  cyl(x, y, z, 0.25, h, { sides: 8, mat: 'metal_dark' });
  cyl(x, y + h, z, 0.32, 0.4, { sides: 8, mat: 'neon_orange', collide: false, shadow: false });
}
for (const [x, z] of [[-8, 31.5], [8, 31.5], [31.5, 8], [31.5, -8], [8, -31.5], [-8, -31.5], [-31.5, 8], [-31.5, -8]]) mast(x, z);
for (const [x, z] of [[26.3, 16.8], [16.8, 26.4], [-26.3, -16.8], [-16.8, -26.4]]) mast(x, z);   // inner side of the two lethal rims

// ------------------------------------------------------------------------------------------------ catch nets under the NE and SW pits
function net(x0, z0, x1, z1) {
  box([x0, -7.6, z0], [x1, -7, z1], { mat: 'concrete_dark', top: 'metal_grate', bottom: CLIFF });
}
net(3, -30, 18, -18); net(18, -30, 30, -3);
net(-18, 18, -3, 30); net(-30, 3, -18, 30);
for (const [x, z] of [[9, -26], [24, -22], [24, -9], [-9, 26], [-24, 22], [-24, 9]]) add({ type: 'box', pos: [x, -7 + 0.65, z], size: [2.4, 1.3, 2.4], mat: 'stone_blocks', bevel: 0.08 });
// a rock spur under each net keeps the pits from looking like empty boxes
for (const [x, z] of [[14, -22], [-14, 22]]) add({ type: 'cylinder', pos: [x, -15, z], radius: 1.4, radiusTop: 6.5, height: 15, sides: 9, mat: CLIFF });

// ------------------------------------------------------------------------------------------------ corner pylons (grapple-only perches at y 11)
const PYLONS = [[-42, -42], [42, -42], [42, 42], [-42, 42]];
for (const [x, z] of PYLONS) {
  add({ type: 'cylinder', pos: [x, -4.3, z], radius: 1.2, radiusTop: 2.6, height: 29.4, sides: 10, mat: CLIFF });
  box([x - 3, 10.4, z - 3], [x + 3, 11, z + 3], { mat: 'metal_panel', top: 'tiles_white', bottom: 'metal_dark' });
  edgeRail(x - 3, z - 3, x + 3, z - 3, [], 11); edgeRail(x - 3, z + 3, x + 3, z + 3, [], 11);
  edgeRail(x - 3, z - 3, x - 3, z + 3, [], 11); edgeRail(x + 3, z - 3, x + 3, z + 3, [], 11);
  deco([x - 2.9, 11, z - 2.9], [x + 2.9, 11.03, z - 2.7], { mat: 'neon_blue' });
  deco([x - 2.9, 11, z + 2.7], [x + 2.9, 11.03, z + 2.9], { mat: 'neon_blue' });
}

// ------------------------------------------------------------------------------------------------ invisible walls (up to bounds.max.y) around the play volume
box([62, -46, -64], [64, 42, 64], { visible: false, shadow: false });
box([-64, -46, -64], [-62, 42, 64], { visible: false, shadow: false });
box([-64, -46, 62], [64, 42, 64], { visible: false, shadow: false });
box([-64, -46, -64], [64, 42, -62], { visible: false, shadow: false });

// ------------------------------------------------------------------------------------------------ decor: cloud sea, cumulus, far snow peaks, floating rock
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
{
  const r = rng(20240611);
  deco([-450, -31, -450], [450, -30, 450], { mat: 'cloud' });
  // cumulus towers rising out of the sea (kept below the plateau cones)
  for (let i = 0; i < 12; i++) {
    const a = r() * PI * 2, d = 70 + r() * 210, R0 = 20 + r() * 26;
    const x = Math.cos(a) * d, z = Math.sin(a) * d;
    cyl(x, -31, z, R0, 4.5, { sides: 14, radiusTop: R0 * 0.72, mat: 'cloud', collide: false, shadow: false });
    cyl(x + R0 * 0.1, -26.5, z, R0 * 0.62, 3.2, { sides: 12, radiusTop: R0 * 0.36, mat: 'cloud', collide: false, shadow: false });
  }
  // distant snow peaks: a tall main cone with two lower shoulders each, snow on the upper 45 %
  const peak = (x, z, R0, top) => {
    const y0 = -33, H = top - y0, rt = 0.9, f = 0.55;
    add({ type: 'cylinder', pos: [x, y0 + H / 2, z], radius: R0, radiusTop: rt, height: H, sides: 8, mat: 'peak_rock', collide: false, shadow: false });
    const yc = y0 + H * f, rc0 = R0 + (rt - R0) * f;
    add({ type: 'cylinder', pos: [x, yc + (H * (1 - f)) / 2, z], radius: rc0 + 0.9, radiusTop: rt + 0.9, height: H * (1 - f), sides: 8, mat: 'snow', collide: false, shadow: false });
  };
  for (let i = 0; i < 11; i++) {
    const a = (i / 11) * PI * 2 + (r() - 0.5) * 0.4, d = 150 + r() * 90;
    const cx = Math.cos(a) * d, cz = Math.sin(a) * d, R0 = 34 + r() * 24, top = 30 + r() * 44;
    peak(cx, cz, R0, top);
    for (let k = 0; k < 2; k++) {
      const ang = r() * PI * 2, off = R0 * (0.5 + 0.4 * r());
      peak(cx + Math.cos(ang) * off, cz + Math.sin(ang) * off, R0 * (0.5 + 0.25 * r()), top * (0.42 + 0.25 * r()));
    }
  }
  // floating rock chunks
  for (let i = 0; i < 12; i++) {
    const a = r() * PI * 2, d = 78 + r() * 50, rr = 2.2 + r() * 4.2;
    cyl(Math.cos(a) * d, -14 + r() * 40, Math.sin(a) * d, rr * 0.3, rr * 1.7, { sides: 8, radiusTop: rr, mat: CLIFF, top: 'snow', collide: false, shadow: false });
  }
}

// ------------------------------------------------------------------------------------------------ jump pads
/** Local (N-frame) -> world for the pylon pads, rotated by quarter turns q. */
const P = (q, x, y, z) => { const p = rotQ(q, x, z); return [p[0], y, p[1]]; };
const jumpPads = [
  // catch-net returns
  { pos: [7, -7, -22], target: [7, 0, -14], apex: 3 },
  { pos: [24, -7, -14], target: [14, 0, -12], apex: 3 },
  { pos: [-7, -7, 22], target: [-7, 0, 14], apex: 3 },
  { pos: [-24, -7, 14], target: [-14, 0, 12], apex: 3 },
  // Spire -> summit deck
  { pos: [-14, 0, -10], target: [-5, 9.2, -3], apex: 3 },
  { pos: [14, 0, -10], target: [5, 9.2, -3], apex: 3 },
];
// pylon perches are grapple-only (T3, y 11, no pickups: bots never go there). One pad per perch launches a player back to
// the next shelf (apex 12 so the arc clears the perch rails; the pad sits in the corner facing the map centre, off the landing line).
for (let q = 0; q < 4; q++) {
  const pl = PYLONS[q];
  jumpPads.push({ pos: [pl[0] + (pl[0] > 0 ? -1.6 : 1.6), 11, pl[1] + (pl[1] > 0 ? -1.6 : 1.6)], target: P(q, -42, 0, -11), apex: 12 });
}

// ------------------------------------------------------------------------------------------------ spawns / pickups / zones
const centre = [0, 0, 0];
const spawn = (x, y, z) => ({ pos: [x, y, z], lookAt: [centre[0], y, centre[2]] });
const spawns = [];
for (let q = 0; q < 4; q++) {
  const a = P(q, -14, 0, -52), b = P(q, 14, 0, -52), c = P(q, 3.2, 5, -48.7);
  spawns.push(spawn(...a), spawn(...b), spawn(...c));
}
spawns.push(spawn(14, 0, 14), spawn(-14, 0, -14), spawn(-6, 4.6, 6), spawn(3, 9.2, -1.5), spawn(12, -7, -24), spawn(-12, -7, 24));

const pickups = [
  { type: 'weapon', weapon: 'rocket', pos: [0, 4.6, 0] },
  { type: 'weapon', weapon: 'sniper', pos: [0, 5, -51] },
  { type: 'weapon', weapon: 'sniper', pos: [0, 5, 51] },
  { type: 'weapon', weapon: 'shotgun', pos: [0, 0, -5] },
  { type: 'weapon', weapon: 'smg', pos: [38, 0, -4] },      // content drop: smg
  { type: 'weapon', weapon: 'smg', pos: [-38, 0, 4] },      // content drop: smg
  { type: 'weapon', weapon: 'gale', pos: [0, 0, 6] },      // content drop: gale
  { type: 'weapon', weapon: 'gale', pos: [0, 0, -38] },    // content drop: gale
  { type: 'health', pos: [0, 0, -24], amount: 25 }, { type: 'health', pos: [24, 0, 0], amount: 25 },
  { type: 'health', pos: [-24, 0, 0], amount: 50 },
  { type: 'health', pos: [22, -7, -26], amount: 25 }, { type: 'health', pos: [-22, -7, 26], amount: 25 },
  { type: 'armor', pos: [0, 9.2, -5] },
  { type: 'armor', pos: [51, 5, 0] },
  { type: 'health', pos: [-51, 5, 0], amount: 50 },
  { type: 'ammo', pos: [-40, 0, -10.5] }, { type: 'ammo', pos: [40, 0, 10.5] },
  { type: 'ammo', pos: [9, 0, 40] }, { type: 'ammo', pos: [-9, 0, -40] },
  { type: 'grenades', pos: [-14, 0, 14], amount: 2, extra: 'kinetic' },
  { type: 'grenades', pos: [14, 0, -14], amount: 2, extra: 'smoke' },
  { type: 'grenades', pos: [-42, 0, 8.5], amount: 2 },
];

const zones = [
  { id: 'yardN', name: 'Cryo Dock', pos: [0, 0, -40], radius: 7.5 },
  { id: 'yardE', name: 'Skywatch', pos: [40, 0, 0], radius: 7.5 },
  { id: 'summit', name: 'Summit', pos: [0, 9.2, -4], radius: 7.5 },
  { id: 'yardS', name: 'Radio Hall', pos: [0, 0, 40], radius: 7.5 },
  { id: 'yardW', name: 'Hangar', pos: [-40, 0, 0], radius: 7.5 },
];

export default {
  id: 'aerie',
  name: 'Aerie',
  subtitle: 'Sky station - High noon',
  description: 'Five glacier platforms above a sea of cloud. Rails mean safe, open sills mean drop. Wall-run the rim parapets, grapple a mast if you are shoved, and hold the Summit.',
  colors: ['#5fa8e8', '#e8f4ff'],
  bounds: { min: [-62, -40, -62], max: [62, 40, 62] },
  killY: -38,
  previewCamera: { pos: [70, 40, 70], lookAt: [0, 2, 0] },
  theme: {
    sky: { top: '#2a6fd0', horizon: '#cfe6ff', bottom: '#e8f2ff', sunColor: '#fff3d0', sunSize: 1.3, stars: false, clouds: 0.55 },
    sun: { dir: [0.45, 0.72, 0.30], color: '#fff1d8', intensity: 3.0 },
    hemi: { sky: '#a9cdf5', ground: '#e6eef5', intensity: 1.15 },
    fog: { color: '#cfe3f5', near: 80, far: 320 },
    exposure: 1.0,
    envIntensity: 0.75,
    bloom: { strength: 0.3, radius: 0.5, threshold: 0.9 },
  },
  solids,
  lights: [
    { pos: [0, 3.2, 0], color: '#8fdcff', intensity: 70, distance: 18 },      // Spire lobby
    { pos: [0, 3, -51], color: '#8fdcff', intensity: 45, distance: 16 },      // Cryo Lab tunnel
    { pos: [0, 3, 51], color: '#ffe2b8', intensity: 45, distance: 16 },       // Radio Hall tunnel
    { pos: [-51, 3, 0], color: '#ffe2b8', intensity: 45, distance: 16 },      // Hangar tunnel
  ],
  spawns,
  pickups,
  jumpPads,
  zones,
};
