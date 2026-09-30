// SCRATCH PROTOTYPE of the proposed 4th map "Aerie" (skeleton only: islands, bridges, Spire, buildings, spawns, pickups, pads).
// Used only to validate coordinates / nav connectivity / bot edge behaviour. Not a shippable map.
const solids = [];
const add = s => { solids.push(s); return s; };
const box = (a, b, o = {}) => add({
  type: 'box',
  min: [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.min(a[2], b[2])],
  max: [Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.max(a[2], b[2])],
  ...o,
});
const PI = Math.PI;

/** wall with openings (copied from foundry.js) */
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

/** floating island: 3 m slab + hanging rock cone (collides, so the underside is grapple-able) */
function island(x0, z0, x1, z1, top = 'concrete_floor') {
  box([x0, -3, z0], [x1, 0, z1], { mat: 'rock', top, bottom: 'rock' });
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, r = Math.min(x1 - x0, z1 - z0) / 2;
  add({ type: 'cylinder', pos: [cx, -11, cz], radius: r * 0.12, radiusTop: r * 0.85, height: 16, sides: 10, mat: 'rock' });
}
const deck = (a, b, o = {}) => box(a, b, { mat: 'concrete_dark', top: 'metal_grate', ...o });
const crate = (x, y, z, s = 1.2, rot = 0) => add({ type: 'crate', pos: [x, y + s / 2, z], size: s, rot });
const block = (x, z, w = 2.4, h = 1.3, d = 2.4, rot = 0) => add({ type: 'box', pos: [x, h / 2, z], size: [w, h, d], rot, mat: 'stone_blocks', bevel: 0.08 });

// ------------------------------------------------------------------------------- islands
island(-18, -18, 18, 18, 'tiles_white');                 // C plateau
island(-16, -58, 16, -30);                               // N
island(-16, 30, 16, 58);                                 // S
island(30, -16, 58, 16);                                 // E
island(-58, -16, -30, 16);                               // W

// ------------------------------------------------------------------------------- spokes (6 m wide, 12 m long)
deck([-3, -0.6, -30], [3, 0, -18]);
deck([-3, -0.6, 18], [3, 0, 30]);
deck([18, -0.6, -3], [30, 0, 3]);
deck([-30, -0.6, -3], [-18, 0, 3]);

// ------------------------------------------------------------------------------- rim bridges (4.5 m wide diagonals + 4.5 m parapet wall on the outer side = wall-run lane)
function rim(x0, z0, x1, z1, nx, nz) {
  // deck between the two shelf corners, slightly lower than the shelf tops so it never z-fights
  add({ type: 'wall', from: [x0, z0], to: [x1, z1], y0: -0.6, height: 0.59, thickness: 4.5, mat: 'concrete_dark', top: 'metal_grate' });
  // outer parapet (offset 2.4 m along the outward normal), trimmed 3.5 m at each end
  const dx = x1 - x0, dz = z1 - z0, L = Math.hypot(dx, dz), ux = dx / L, uz = dz / L;
  const s0 = 3.5, s1 = L - 3.5;
  add({
    type: 'wall',
    from: [x0 + ux * s0 + nx * 2.4, z0 + uz * s0 + nz * 2.4],
    to: [x0 + ux * s1 + nx * 2.4, z0 + uz * s1 + nz * 2.4],
    y0: -0.6, height: 5.1, thickness: 0.5, mat: 'metal_panel',
  });
}
const K = Math.SQRT1_2;
rim(14, -32, 32, -14, K, -K);      // NE
rim(32, 14, 14, 32, K, K);         // SE
rim(-14, 32, -32, 14, -K, K);      // SW
rim(-32, -14, -14, -32, -K, -K);   // NW

// ------------------------------------------------------------------------------- the Spire (observatory) on the plateau
wallRun('x', -10, -10, 10, 0, 4.1, 0.6, 'concrete', [{ c: 0, w: 4, y0: 0, y1: 3.2 }]);   // north face (door)
wallRun('x', 10, -10, 10, 0, 4.1, 0.6, 'concrete', [{ c: 0, w: 4, y0: 0, y1: 3.2 }]);    // south face (door)
wallRun('z', -10, -10, 10, 0, 4.1, 0.6, 'concrete');                                        // west face (stairs outside)
wallRun('z', 10, -10, 10, 0, 4.1, 0.6, 'concrete');                                         // east face
box([-10, 4.1, -10], [10, 4.6, 10], { mat: 'metal_panel', top: 'tiles_white' });            // T1 deck (y 4.6)
add({ type: 'stairs', pos: [-14, 2.3, 0], size: [8, 4.6, 3.6], dir: '+x', mat: 'concrete_dark', top: 'metal_grate' });
add({ type: 'stairs', pos: [14, 2.3, 0], size: [8, 4.6, 3.6], dir: '-x', mat: 'concrete_dark', top: 'metal_grate' });
add({ type: 'stairs', pos: [0, 6.9, 6], size: [4, 4.6, 8], dir: '-z', mat: 'concrete_dark', top: 'metal_grate' });   // T1 -> summit
box([-10, 8.7, -10], [10, 9.2, 2], { mat: 'metal_panel', top: 'tiles_white' });                                   // summit deck (y 9.2)
for (const [x, z] of [[-9, -9], [9, -9], [-9, 1], [9, 1]]) add({ type: 'pillar', pos: [x, 6.65, z], radius: 0.5, height: 4.1, sides: 8 });
add({ type: 'cylinder', pos: [0, 16.6, -6], radius: 0.35, height: 14.8, sides: 8, mat: 'metal_dark' });                // mast (grapple anchor)
add({ type: 'pillar', pos: [0, 2.05, 0], radius: 0.7, height: 4.1, sides: 8 });                                        // lobby column
crate(-6, 0, -6); crate(-4.8, 0, -6.2, 1.2, 0.3); crate(6, 0, 6); crate(5, 0, 6.3, 1.2, 0.3);

// ------------------------------------------------------------------------------- shelf buildings (solid blocks with roof + stairs = T1)
function shelfBuilding(rotQuarter) {
  // built for the N shelf, then rotated by quarter turns about the origin: (x,z) -> rotate
  const R = (x, z) => {
    let px = x, pz = z;
    for (let i = 0; i < rotQuarter; i++) { const t = px; px = -pz; pz = t; }   // (x,z)->(-z,x)
    return [px, pz];
  };
  const rb = (a, b, o) => { const p = R(a[0], a[2]), q = R(b[0], b[2]); box([p[0], a[1], p[1]], [q[0], b[1], q[1]], o); };
  rb([-12, 0, -56], [12, 5, -46], { mat: 'metal_panel', top: 'tiles_white' });
  for (const sx of [-1, 1]) {
    const p = R(sx * 13.5, -42.75);
    const dirs = ['-z', '+x', '+z', '-x'];
    // N-shelf stairs rise toward -z; rotating (x,z)->(-z,x) turns -z into +x, etc.
    add({ type: 'stairs', pos: [p[0], 2.5, p[1]], size: (rotQuarter % 2 === 0) ? [3, 5, 8.5] : [8.5, 5, 3], dir: dirs[rotQuarter], mat: 'concrete_dark', top: 'metal_grate' });
  }
  // cover blocks in the yard
  for (const [x, z] of [[-9, -36], [9, -36], [0, -41], [-5, -33], [5, -33]]) { const p = R(x, z); block(p[0], p[1]); }
}
for (let q = 0; q < 4; q++) shelfBuilding(q);

// recovery mast test: slim 8 m pole 1.5 m inside the N shelf's south lip
add({ type: 'cylinder', pos: [10, 4, -31.5], radius: 0.25, height: 8, sides: 8, mat: 'metal_dark' });
// corner pylons (grapple-only perches)
for (const [x, z] of [[-42, -42], [42, -42], [42, 42], [-42, 42]]) {
  add({ type: 'cylinder', pos: [x, -4, z], radius: 1.2, radiusTop: 2.6, height: 30, sides: 10, mat: 'rock' });
  box([x - 3, 10.4, z - 3], [x + 3, 11, z + 3], { mat: 'metal_panel', top: 'tiles_white' });
}

// cloud sea + far mountains (decor)
box([-400, -31, -400], [400, -30, 400], { mat: 'plaster', collide: false, shadow: false });

const lights = [
  { pos: [0, 3.2, 0], color: '#8fdcff', intensity: 70, distance: 18 },
  { pos: [0, 8, -40], color: '#ffe2b8', intensity: 40, distance: 24 },
  { pos: [0, 8, 40], color: '#ffe2b8', intensity: 40, distance: 24 },
];

export default {
  id: 'aeriem', name: 'Aerie', subtitle: 'Sky station - High noon', description: 'scratch proto',
  colors: ['#5fa8e8', '#e8f4ff'],
  bounds: { min: [-62, -40, -62], max: [62, 40, 62] },
  killY: -38,
  previewCamera: { pos: [70, 40, 70], lookAt: [0, 2, 0] },
  theme: {
    sky: { top: '#2a6fd0', horizon: '#cfe6ff', bottom: '#e8f2ff', sunColor: '#fff3d0', sunSize: 1.3, stars: false, clouds: 0.55 },
    sun: { dir: [0.45, 0.72, 0.30], color: '#fff1d8', intensity: 3.0 },
    hemi: { sky: '#a9cdf5', ground: '#e6eef5', intensity: 1.05 },
    fog: { color: '#cfe3f5', near: 80, far: 320 },
    exposure: 1.0, envIntensity: 0.75,
    bloom: { strength: 0.3, radius: 0.5, threshold: 0.9 },
  },
  solids,
  lights,
  spawns: [
    { pos: [-8, 0, -38], lookAt: [0, 0, 0] }, { pos: [8, 0, -38], lookAt: [0, 0, 0] }, { pos: [0, 5, -51], lookAt: [0, 0, 0] },
    { pos: [-8, 0, 38], lookAt: [0, 0, 0] }, { pos: [8, 0, 38], lookAt: [0, 0, 0] }, { pos: [0, 5, 51], lookAt: [0, 0, 0] },
    { pos: [38, 0, -8], lookAt: [0, 0, 0] }, { pos: [38, 0, 8], lookAt: [0, 0, 0] }, { pos: [51, 5, 0], lookAt: [0, 0, 0] },
    { pos: [-38, 0, -8], lookAt: [0, 0, 0] }, { pos: [-38, 0, 8], lookAt: [0, 0, 0] }, { pos: [-51, 5, 0], lookAt: [0, 0, 0] },
    { pos: [14, 0, 14], lookAt: [0, 0, 0] }, { pos: [-14, 0, -14], lookAt: [0, 0, 0] },
    { pos: [-6, 4.6, 6], lookAt: [0, 4.6, -6] }, { pos: [-6, 9.2, -6], lookAt: [0, 9.2, 0] },
  ],
  pickups: [
    { type: 'weapon', weapon: 'rocket', pos: [0, 4.6, 0] },
    { type: 'weapon', weapon: 'sniper', pos: [0, 5, -51] },
    { type: 'weapon', weapon: 'sniper', pos: [0, 5, 51] },
    { type: 'weapon', weapon: 'shotgun', pos: [0, 0, -5] },
    { type: 'health', pos: [0, 0, -24], amount: 25 }, { type: 'health', pos: [0, 0, 24], amount: 25 },
    { type: 'health', pos: [24, 0, 0], amount: 25 }, { type: 'health', pos: [-24, 0, 0], amount: 50 },
    { type: 'armor', pos: [0, 9.2, -6] }, { type: 'armor', pos: [-51, 5, 8] },
    { type: 'ammo', pos: [-38, 0, 0] }, { type: 'ammo', pos: [38, 0, 0] }, { type: 'ammo', pos: [0, 0, 40] }, { type: 'ammo', pos: [0, 0, -40] },
    { type: 'grenades', pos: [-14, 0, 14], amount: 2 }, { type: 'grenades', pos: [14, 0, -14], amount: 2 },
  ],
  jumpPads: [
    { pos: [-14, 0, -10], target: [-6, 9.2, -6], apex: 3 },
    { pos: [14, 0, -10], target: [6, 9.2, -6], apex: 3 },
  ],
  zones: [
    { id: 'summit', name: 'Summit', pos: [0, 9.2, -4], radius: 8 },
    { id: 'lobby', name: 'Lobby', pos: [0, 0, 0], radius: 8 },
    { id: 'yardN', name: 'Cryo Dock', pos: [0, 0, -40], radius: 8 },
    { id: 'rimNE', name: 'Skybridge', pos: [23, 0, -23], radius: 7 },
    { id: 'yardE', name: 'Skywatch', pos: [40, 0, 0], radius: 8 },
    { id: 'yardS', name: 'Radio Hall', pos: [0, 0, 40], radius: 8 },
    { id: 'rimSW', name: 'Skybridge', pos: [-23, 0, 23], radius: 7 },
    { id: 'yardW', name: 'Hangar', pos: [-40, 0, 0], radius: 8 },
  ],
};
