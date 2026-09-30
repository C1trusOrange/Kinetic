// "Stratos": an open-air relay station floating above a permanent thunderstorm, at twilight.
//
//   x: west(-) .. east(+)   z: north(-) .. south(+)   y: up.   Round, wall-less, teal / violet / coral.
//   The only enclosure is an invisible 12-gon of collision walls (R 68) plus a lid; the edges are open over the cloud
//   deck (drawn at y -58 by the sky shader), so a fall is a long, pretty death (killY -32).
//
//   T0  y 0    Hub (r17, "Spindle Plaza"), four 9 m arms, four r12 docks.
//   T1  y 4.5  Spindle plinth, E comms hut roof, W hangar hull roof, and the RING skybridge (12-gon, R 62) joining the
//              docks (radial stairs on N/S, hut / hull roofs on E/W).
//   T2  y 9.5  Spindle crown (four elevator jump pads from the plinth), N roost + S gantry (straight stairs + booster pad).
//   The SPINDLE: a 70 m relay mast in the hub, neon bands, lightning-rod tip that gets struck (see Storm.js), grapple-able
//   from anywhere in the hub, wall-runnable all the way round. The E and W arms are wall-run corridors (solar sail walls).
//   The four rods on the E comms dock are real hazards: the ring on the deck pulses for 1.2 s, then 60 damage in 3.6 m.
//
//   Bots: stairs everywhere (hub > plinth > jump pads > crown; docks > roosts; radial stairs / roofs > ring).
//   Players: the sail walls, the Spindle pendulum, arch anchors, ring drops, rods.

const solids = [];
const add = s => { solids.push(s); return s; };
const PI = Math.PI;
const TAU = PI * 2;

const box = (x0, y0, z0, x1, y1, z1, o = {}) => add({
  type: 'box', min: [Math.min(x0, x1), Math.min(y0, y1), Math.min(z0, z1)], max: [Math.max(x0, x1), Math.max(y0, y1), Math.max(z0, z1)], ...o,
});
const deco = (x0, y0, z0, x1, y1, z1, o = {}) => box(x0, y0, z0, x1, y1, z1, { collide: false, ...o });
/** Vertical cylinder standing on y. */
const cyl = (x, y, z, r, h, o = {}) => add({ type: 'cylinder', pos: [x, y + h / 2, z], radius: r, height: h, ...o });
const wallSeg = (x0, z0, x1, z1, y0, h, o = {}) => add({ type: 'wall', from: [x0, z0], to: [x1, z1], y0, height: h, ...o });
const rail = (a, b, o = {}) => add({ type: 'railing', from: a, to: b, mat: 'metal_dark', ...o });
const stairs = (x, y, z, w, h, d, dir, o = {}) => add({ type: 'stairs', pos: [x, y + h / 2, z], size: [w, h, d], dir, mat: 'ceramic_white', top: 'hex_deck', ...o });

const R_RING = 62;
const V = k => [R_RING * Math.cos(k * PI / 6), R_RING * Math.sin(k * PI / 6)];

// ================================================================================================ T0: hub + Spindle

// hub disc: ceramic hull, hex-deck top, dark underside; neon inlay rings (a neon disc with a smaller deck disc on top)
cyl(0, -3, 0, 17, 3, { sides: 32, mat: 'ceramic_white', top: 'hex_deck', bottom: 'metal_dark' });
cyl(0, -0.55, 0, 17.06, 0.22, { sides: 32, mat: 'neon_cyan', collide: false });           // rim glow
for (const r of [15.4, 11.5]) {
  cyl(0, 0, 0, r, 0.05, { sides: 40, mat: 'neon_cyan', collide: false });
  cyl(0, 0, 0, r - 0.3, 0.06, { sides: 40, mat: 'hex_deck', collide: false });
}

// plinth (T1) + neon trim; stairs W / E from the hub (31 deg)
cyl(0, 0, 0, 9.6, 4.5, { sides: 28, mat: 'ceramic_white', top: 'hex_deck' });
cyl(0, 3.95, 0, 9.66, 0.22, { sides: 28, mat: 'neon_cyan', collide: false });
stairs(-12.9, 0, 0, 7.4, 4.5, 4, '+x');
stairs(12.9, 0, 0, 7.4, 4.5, 4, '-x');

// the Spindle: tapered shaft in three pieces (below the crown deck, above it) so no solids overlap; cone crown + rod tip
const shaftR = y => 4.2 - 0.8 * (y - 4.5) / 57.5;
cyl(0, 4.5, 0, shaftR(4.5), 4.1, { sides: 16, radiusTop: shaftR(8.6), mat: 'ceramic_teal' });
cyl(0, 9.5, 0, shaftR(9.5), 52.5, { sides: 16, radiusTop: 3.4, mat: 'ceramic_teal' });
for (const y of [6, 14, 22, 30, 38, 46]) {
  const r = shaftR(y);
  const ok = y > 9.5 || y < 8.6;
  if (ok) cyl(0, y - 0.175, 0, r + 0.14, 0.35, { sides: 16, radiusTop: r + 0.13, mat: 'neon_cyan', collide: false });
}
cyl(0, 62, 0, 3.4, 8, { sides: 16, radiusTop: 0.4, mat: 'metal_panel' });
cyl(0, 66, 0, 0.25, 8, { sides: 6, mat: 'neon_white', collide: false });
for (const y of [50, 58]) cyl(0, y, 0, shaftR(y) + 0.2, 0.5, { sides: 16, mat: 'metal_panel', collide: false });

// crown deck (T2) around the shaft, four elevator pads on the plinth (see jumpPads)
cyl(0, 8.6, 0, 7.0, 0.9, { sides: 24, mat: 'ceramic_teal', top: 'hex_deck', bottom: 'metal_dark' });
cyl(0, 9.0, 0, 7.06, 0.16, { sides: 24, mat: 'neon_violet', collide: false });

// cover at the arm mouths
box(-1.8, 0, -14.4, 1.8, 1.2, -13.6, { mat: 'ceramic_white', top: 'hex_deck' });
box(-1.8, 0, 13.6, 1.8, 1.2, 14.4, { mat: 'ceramic_white', top: 'hex_deck' });

// ================================================================================================ Z2: arms
// E / W: wall-run corridors between two solar sail walls (walls sit on the arm, flush with its edges)
for (const sx of [1, -1]) {
  box(sx > 0 ? 15 : -37, -3, -4.5, sx > 0 ? 37 : -15, 0, 4.5, { mat: 'ceramic_white', top: 'hex_deck', bottom: 'metal_dark' });
  for (const sz of [1, -1]) {
    wallSeg(sx * 19, sz * 4.25, sx * 37, sz * 4.25, -3, 10, { thickness: 0.5, mat: 'solar_cells', top: 'metal_dark' });
    // neon along the top of each sail and a glow strip at the foot
    wallSeg(sx * 19, sz * 4.25, sx * 37, sz * 4.25, 6.85, 0.16, { thickness: 0.62, mat: 'neon_cyan', collide: false });
  }
}
// N / S: open lanes with a pylon arch (grapple anchor) and low ceramic barriers
for (const sz of [-1, 1]) {
  box(-4.5, -3, sz > 0 ? 15 : -37, 4.5, 0, sz > 0 ? 37 : -15, { mat: 'ceramic_white', top: 'hex_deck', bottom: 'metal_dark' });
  for (const sx of [-1, 1]) deco(sx * 4.4 - 0.08, 0, sz * 15, sx * 4.4 + 0.08, 0.1, sz * 37, { mat: 'neon_cyan' });
  add({ type: 'arch', pos: [0, 4, sz * 27], size: [9.6, 8, 1.6], thickness: 1.2, lintel: 1.2, mat: 'metal_dark' });
  deco(-4.2, 7.0, sz * 27 - 0.83, 4.2, 7.25, sz * 27 - 0.8, { mat: 'neon_cyan' });
  deco(-4.2, 7.0, sz * 27 + 0.8, 4.2, 7.25, sz * 27 + 0.83, { mat: 'neon_cyan' });
}
for (const [x, z] of [[-2.2, -20.5], [2.2, -24], [-2.4, -33.5], [2.2, 20.5], [-2.2, 24], [2.4, 33.5]]) {
  box(x - 1.5, 0, z - 0.3, x + 1.5, 1.2, z + 0.3, { mat: 'ceramic_white', top: 'hex_deck' });
}

// ================================================================================================ Z3: docks
for (const [dx, dz] of [[48, 0], [-48, 0], [0, -48], [0, 48]]) {
  cyl(dx, -3, dz, 12, 3, { sides: 28, mat: 'ceramic_white', top: 'hex_deck', bottom: 'metal_dark' });
  cyl(dx, -0.6, dz, 12.06, 0.3, { sides: 28, mat: 'neon_cyan', collide: false });
}

// ---- E COMMS: hut (T1) with roof stairs on the south flank, four lightning rods (hazard) on the deck
box(41, 0, -4, 55, 4.5, 4, { mat: 'ceramic_teal', top: 'hex_deck', bottom: 'metal_dark' });
deco(41.02, 3.9, -4.06, 54.98, 4.05, -4.02, { mat: 'neon_cyan' });
deco(41.02, 3.9, 4.02, 54.98, 4.05, 4.06, { mat: 'neon_cyan' });
stairs(48, 0, 7.7, 4, 4.5, 7.4, '-z');
box(55, 3.6, -2, 62, 4.5, 2, { mat: 'metal_dark', top: 'hex_deck' });               // connector to the ring
for (const [x, z] of [[43, -7.5], [43, 7.5], [53, -7.5], [53, 7.5]]) {
  cyl(x, 0, z, 2.4, 0.05, { sides: 24, mat: 'neon_cyan', collide: false });
  cyl(x, 0, z, 2.2, 0.07, { sides: 24, mat: 'hex_deck', collide: false });
  cyl(x, 0, z, 0.55, 0.6, { sides: 8, mat: 'metal_dark' });
  cyl(x, 0.6, z, 0.25, 26, { sides: 8, mat: 'metal_dark' });
  cyl(x, 26.6, z, 0.3, 1.6, { sides: 6, mat: 'neon_white', collide: false });
  cyl(x, 8, z, 0.34, 0.3, { sides: 8, mat: 'neon_cyan', collide: false });
  cyl(x, 16, z, 0.34, 0.3, { sides: 8, mat: 'neon_cyan', collide: false });
}

// ---- W HANGAR: parked drop-ship hull (T1 roof), stairs on its north flank
box(-57, 0, -4, -40, 4.5, 4, { mat: 'ceramic_white', top: 'hex_deck', bottom: 'metal_dark' });
box(-62, 3.6, -2, -57, 4.5, 2, { mat: 'metal_dark', top: 'hex_deck' });              // connector to the ring
stairs(-48, 0, -7.7, 4, 4.5, 7.4, '+z');
deco(-56.9, 3.2, -4.06, -40.1, 3.5, -4.02, { mat: 'hazard' });
deco(-56.9, 3.2, 4.02, -40.1, 3.5, 4.06, { mat: 'hazard' });
deco(-57.05, 1.4, -1.5, -57.0, 3.0, 1.5, { mat: 'neon_orange' });
// cargo stacks (cover) beside the hull
box(-55, 0, 6.6, -52.5, 1.4, 8.6, { mat: 'metal_panel', top: 'hex_deck' });
box(-44.5, 0, 7, -42, 1.4, 9, { mat: 'metal_panel', top: 'hex_deck' });

// ---- N ARRAY: roost (T2) + straight stair flight, cover pylons, antenna masts
box(-12, 8.6, -52, -4, 9.5, -44, { mat: 'ceramic_teal', top: 'hex_deck', bottom: 'metal_dark' });
deco(-12.04, 9.0, -52.04, -3.96, 9.16, -43.96, { mat: 'neon_violet' });
for (const [x, z] of [[-11.2, -51.2], [-11.2, -44.8], [-4.8, -51.2], [-4.8, -44.8]]) cyl(x, 0, z, 0.5, 8.6, { sides: 8, mat: 'metal_dark' });
stairs(3.75, 0, -48, 15.5, 9.5, 4, '-x');
for (const [a, b] of [[[-12, 9.5, -52], [-12, 9.5, -44]], [[-12, 9.5, -52], [-4, 9.5, -52]], [[-12, 9.5, -44], [-4, 9.5, -44]]]) rail(a, b);
rail([-4, 9.5, -52], [-4, 9.5, -50.2]); rail([-4, 9.5, -45.8], [-4, 9.5, -44]);
for (const [x, z] of [[-4, -40.5], [7.5, -55], [-9.5, -56.5]]) box(x - 0.8, 0, z - 0.8, x + 0.8, 3, z + 0.8, { mat: 'ceramic_teal', top: 'hex_deck' });
for (const [x, z, h] of [[-3, -57, 20], [4, -57.5, 26], [10, -53, 16]]) {
  cyl(x, 0, z, 0.35, h, { sides: 8, mat: 'metal_dark' });
  cyl(x, h, z, 0.28, 1.4, { sides: 6, mat: 'neon_white', collide: false });
}
stairs(0, 0, -56.3, 4, 4.5, 7.4, '-z');                                            // radial stairs to the ring
box(-2, 3.6, -62, 2, 4.5, -60, { mat: 'metal_dark', top: 'hex_deck' });

// ---- S REACTOR: gantry (T2) + stairs (point-symmetric copy of the roost), reactor core
box(4, 8.6, 44, 12, 9.5, 52, { mat: 'ceramic_teal', top: 'hex_deck', bottom: 'metal_dark' });
deco(3.96, 9.0, 43.96, 12.04, 9.16, 52.04, { mat: 'neon_violet' });
for (const [x, z] of [[11.2, 51.2], [11.2, 44.8], [4.8, 51.2], [4.8, 44.8]]) cyl(x, 0, z, 0.5, 8.6, { sides: 8, mat: 'metal_dark' });
stairs(-3.75, 0, 48, 15.5, 9.5, 4, '+x');
for (const [a, b] of [[[12, 9.5, 52], [12, 9.5, 44]], [[12, 9.5, 52], [4, 9.5, 52]], [[12, 9.5, 44], [4, 9.5, 44]]]) rail(a, b);
rail([4, 9.5, 52], [4, 9.5, 50.2]); rail([4, 9.5, 45.8], [4, 9.5, 44]);
// reactor core (neon violet) in a dark cage
cyl(-6.5, 0, 53, 0.9, 0.5, { sides: 12, mat: 'metal_dark' });
cyl(-6.5, 0.5, 53, 2.1, 11, { sides: 16, mat: 'neon_violet' });
cyl(-6.5, 11.5, 53, 2.6, 0.5, { sides: 16, mat: 'metal_dark' });
for (const y of [2, 6, 10]) cyl(-6.5, y, 53, 2.7, 0.3, { sides: 16, mat: 'metal_dark', collide: false });
for (let k = 0; k < 4; k++) { const a = k * PI / 2 + PI / 4; cyl(-6.5 + Math.cos(a) * 2.5, 0.5, 53 + Math.sin(a) * 2.5, 0.16, 11, { sides: 6, mat: 'metal_dark', collide: false }); }
for (const [x, z] of [[-4.5, 40], [-7.5, 55], [9.5, 56.5]]) box(x - 0.8, 0, z - 0.8, x + 0.8, 3, z + 0.8, { mat: 'ceramic_teal', top: 'hex_deck' });
stairs(0, 0, 56.3, 4, 4.5, 7.4, '+z');
box(-2, 3.6, 60, 2, 4.5, 62, { mat: 'metal_dark', top: 'hex_deck' });

// ================================================================================================ Z4: ring skybridge (T1)
for (let k = 0; k < 12; k++) {
  const [x0, z0] = V(k), [x1, z1] = V(k + 1);
  wallSeg(x0, z0, x1, z1, 3.9, 0.6, { thickness: 5, mat: 'metal_dark', top: 'hex_deck', bottom: 'metal_dark' });
  cyl(x0, 3.9, z0, 3.2, 0.6, { sides: 16, mat: 'metal_dark', top: 'hex_deck', bottom: 'metal_dark' });
  cyl(x0, -30, z0, 0.9, 33.9, { sides: 8, mat: 'metal_dark', collide: false });
  // edge glow strips + railings on both sides (gaps at the four dock landings)
  const dx = x1 - x0, dz = z1 - z0, len = Math.hypot(dx, dz), ux = dx / len, uz = dz / len;
  for (const side of [1, -1]) {
    const nx = -uz * side, nz = ux * side;
    const gapA = k % 3 === 0 ? 3.4 : 0.2, gapB = (k + 1) % 3 === 0 ? 3.4 : 0.2;
    const ax = x0 + ux * gapA + nx * 2.4, az = z0 + uz * gapA + nz * 2.4;
    const bx = x1 - ux * gapB + nx * 2.4, bz = z1 - uz * gapB + nz * 2.4;
    rail([ax, 4.5, az], [bx, 4.5, bz]);
    wallSeg(x0 + nx * 2.53, z0 + nz * 2.53, x1 + nx * 2.53, z1 + nz * 2.53, 4.0, 0.22, { thickness: 0.1, mat: 'neon_cyan', collide: false });
  }
}

// ================================================================================================ invisible bounds
for (let k = 0; k < 12; k++) {
  const a0 = k * TAU / 12, a1 = (k + 1) * TAU / 12;
  wallSeg(68 * Math.cos(a0), 68 * Math.sin(a0), 68 * Math.cos(a1), 68 * Math.sin(a1), -32, 104, { thickness: 1, visible: false });
}
box(-70, 72, -70, 70, 73, 70, { visible: false });

// ================================================================================================ definition
export default {
  id: 'stratos',
  name: 'Stratos',
  subtitle: 'Storm-deck relay · Twilight',
  description: 'A round, wall-less relay station floating above a thunderstorm. Grapple the 74 m Spindle, run the solar sails, ride the ring bridge, and keep away from the lightning rods when the deck starts to pulse.',
  colors: ['#20124d', '#5cf2ff'],
  bounds: { min: [-72, -40, -72], max: [72, 72, 72] },
  killY: -32,
  previewCamera: { pos: [70, 30, 62], lookAt: [0, 10, 0] },
  theme: {
    sky: {
      top: '#050a26', horizon: '#ff8a6a', bottom: '#20124d', sunColor: '#ffb27a', sunSize: 1.6, stars: 1, clouds: 0,
      deck: { y: -58, lit: '#ffb09a', shade: '#2a2058', flash: '#9fd8ff' },
      planet: { dir: [0.62, 0.30, 0.72], radius: 0.17, light: [-0.6, 0.35, -0.5], a: '#e9c9a0', b: '#b7896a', ring: { inner: 1.32, outer: 2.15, tilt: 0.34, color: '#d8c3a0' } },
      aurora: { intensity: 0.75, colors: ['#25ffa8', '#2d8cff', '#b060ff'] },
    },
    sun: { dir: [-0.72, 0.13, -0.68], color: '#ffb27a', intensity: 3.0 },
    hemi: { sky: '#b8a8ff', ground: '#603048', intensity: 0.95 },
    fog: { color: '#5a3f86', near: 90, far: 420 },
    exposure: 1.05,
    envIntensity: 0.7,
    bloom: { strength: 0.7, radius: 0.55, threshold: 0.82 },
  },
  fx: {
    storm: {
      rods: [
        { pos: [0, 4.5, 0], h: 69.5, weight: 3, hazard: false },
        { pos: [43, 0, -7.5], h: 28, weight: 0.5, hazard: true, r: 3.6 },
        { pos: [43, 0, 7.5], h: 28, weight: 0.5, hazard: true, r: 3.6 },
        { pos: [53, 0, -7.5], h: 28, weight: 0.5, hazard: true, r: 3.6 },
        { pos: [53, 0, 7.5], h: 28, weight: 0.5, hazard: true, r: 3.6 },
      ],
      strikeEvery: [11, 19], sheetEvery: [3, 7], warn: 1.2, damage: 60, knockback: 16,
    },
    spinners: [
      { pos: [0, 20, 0], radius: 8.5, tube: 0.16, rps: 0.05, color: '#5cf2ff', intensity: 1.5, segments: 20 },
      { pos: [0, 32, 0], radius: 7, tube: 0.16, rps: -0.07, color: '#9a55ff', intensity: 1.5, segments: 16 },
    ],
  },
  solids,
  lights: [
    { pos: [0, 3, 0], color: '#5cf2ff', intensity: 80, distance: 30 },
    { pos: [-8, 12, -48], color: '#ffb27a', intensity: 70, distance: 28 },
    { pos: [48, 8, 0], color: '#5cf2ff', intensity: 70, distance: 28 },
    { pos: [-6.5, 8, 53], color: '#9a55ff', intensity: 75, distance: 26 },
  ],
  spawns: [
    // hub
    { pos: [-13, 0, -9], lookAt: [0, 0, 0] }, { pos: [13, 0, 9], lookAt: [0, 0, 0] },
    { pos: [9, 0, -13], lookAt: [0, 0, 0] }, { pos: [-9, 0, 13], lookAt: [0, 0, 0] },
    // arms
    { pos: [30, 0, 2.5], lookAt: [0, 0, 0] }, { pos: [-30, 0, -2.5], lookAt: [0, 0, 0] },
    { pos: [2.5, 0, -30], lookAt: [0, 0, 0] }, { pos: [-2.5, 0, 30], lookAt: [0, 0, 0] },
    // docks
    { pos: [48, 0, -9.5], lookAt: [0, 0, 0] }, { pos: [-42, 0, -8.5], lookAt: [0, 0, 0] },
    { pos: [8, 0, 41], lookAt: [0, 0, 0] }, { pos: [-8, 0, -41], lookAt: [0, 0, 0] },
    // ring
    { pos: [42.4, 4.5, 42.4], lookAt: [0, 4.5, 0] }, { pos: [-42.4, 4.5, -42.4], lookAt: [0, 4.5, 0] },
    { pos: [42.4, 4.5, -42.4], lookAt: [0, 4.5, 0] }, { pos: [-42.4, 4.5, 42.4], lookAt: [0, 4.5, 0] },
  ],
  pickups: [
    // weapons (content drop: arc / rail pads)
    { type: 'weapon', weapon: 'arc', pos: [4, 9.5, -4] },      // content drop: arc
    { type: 'weapon', weapon: 'rail', pos: [-8, 9.5, -48] },   // content drop: rail
    { type: 'weapon', weapon: 'rocket', pos: [6, 4.5, 6] },
    { type: 'weapon', weapon: 'sniper', pos: [47, 4.5, 0] },
    { type: 'weapon', weapon: 'shotgun', pos: [-48, 0, 7] },
    // health / armor
    { type: 'health', pos: [-6, 4.5, -6], amount: 50 },
    { type: 'health', pos: [2, 0, 38.5], amount: 50 },
    { type: 'health', pos: [-47, 0, 9.5], amount: 25 },
    { type: 'health', pos: [52.5, 0, 9], amount: 25 },            // inside a lightning-rod hazard zone
    { type: 'armor', pos: [-50, 4.5, 0] },
    { type: 'armor', pos: [7, 0, -42] },
    // ammo
    { type: 'ammo', pos: [27, 0, -2.5] }, { type: 'ammo', pos: [-27, 0, 2.5] },
    { type: 'ammo', pos: [2.5, 0, -30] }, { type: 'ammo', pos: [-2.5, 0, 30] },
    // grenade crates (extra = the pinned special type once the grenade types exist)
    { type: 'grenades', amount: 2, pos: [-10.5, 0, 10.5] },
    { type: 'grenades', amount: 2, pos: [10.5, 0, -10.5] },
    { type: 'grenades', amount: 2, extra: 'vortex', pos: [42.4, 4.5, -42.4] },
    { type: 'grenades', amount: 2, extra: 'vortex', pos: [-42.4, 4.5, 42.4] },
    { type: 'grenades', amount: 2, extra: 'static', pos: [-3, 0, -33] },
  ],
  jumpPads: [
    // Spindle elevators: plinth > crown
    { pos: [8.6, 4.5, 0], target: [6.1, 9.5, 0], apex: 2.5 },
    { pos: [-8.6, 4.5, 0], target: [-6.1, 9.5, 0], apex: 2.5 },
    { pos: [0, 4.5, 8.6], target: [0, 9.5, 6.1], apex: 2.5 },
    { pos: [0, 4.5, -8.6], target: [0, 9.5, -6.1], apex: 2.5 },
    // boosters onto the roost / gantry
    { pos: [6, 0, -44], target: [-7.5, 9.5, -48], apex: 3 },
    { pos: [-6, 0, 44], target: [7.5, 9.5, 48], apex: 3 },
  ],
  zones: [
    { id: 'spindle', name: 'Spindle', pos: [0, 4.5, 0], radius: 8 },
    { id: 'comms', name: 'Comms', pos: [47, 4.5, 0], radius: 6 },
    { id: 'reactor', name: 'Reactor', pos: [0, 0, 41], radius: 6 },
    { id: 'hangar', name: 'Hangar', pos: [-48, 4.5, 0], radius: 6 },
    { id: 'array', name: 'Array', pos: [0, 0, -41], radius: 6 },
  ],
};
