// "Proving Grounds": compact training arena that exercises every movement / world feature.
//
//   x: west(-) .. east(+)   z: north(-) .. south(+)   y: up.   Arena is 64 x 64 m.
//
//   Tier 1 (y 0)     concrete yard, wall-run corridor (NW), container yard (SE), sunken pit (SW)
//   Tier 2 (y 4.5)   central deck on pillars (stairs south, ramp east), catwalk bridge to the north platform
//   Tier 3 (y 16)    grapple tower (NE) with crane arm; reach it by grapple, wall-run, or the jump pad
//   Overhead         28 m gantry beam at y 12 for grapple swings
//
// Bots can reach everything except container tops / gantry (no grapple, no wall-run); the tower top
// is reachable for them through the jump pad and they can drop back down.

const solids = [];
const add = s => { solids.push(s); return s; };

const FLOOR = { mat: 'concrete', top: 'concrete_floor' };

// ---------------------------------------------------------------- ground with a sunken pit (SW)
add({ type: 'box', min: [-32, -5, -32], max: [32, 0, 8], ...FLOOR });
add({ type: 'box', min: [-32, -5, 26], max: [32, 0, 32], ...FLOOR });
add({ type: 'box', min: [-14, -5, 8], max: [32, 0, 26], ...FLOOR });
add({ type: 'box', min: [-32, -5, 8], max: [-28, 0, 26], ...FLOOR });
add({ type: 'box', min: [-28, -6, 8], max: [-14, -4, 26], mat: 'concrete_dark', top: 'concrete_floor' });
add({ type: 'ramp', pos: [-18, -2, 17], size: [8, 4, 3.6], dir: '+x', mat: 'concrete_dark', top: 'concrete_floor' });

// ---------------------------------------------------------------- boundary (visible walls + invisible extension)
add({ type: 'wall', from: [-32, -31.5], to: [32, -31.5], y0: -5, height: 15, thickness: 1, mat: 'concrete' });
add({ type: 'wall', from: [-32, 31.5], to: [32, 31.5], y0: -5, height: 15, thickness: 1, mat: 'concrete' });
add({ type: 'wall', from: [-31.5, -31], to: [-31.5, 31], y0: -5, height: 15, thickness: 1, mat: 'concrete' });
add({ type: 'wall', from: [31.5, -31], to: [31.5, 31], y0: -5, height: 15, thickness: 1, mat: 'concrete' });
add({ type: 'box', min: [-33, 10, -33], max: [33, 30, -31], visible: false });
add({ type: 'box', min: [-33, 10, 31], max: [33, 30, 33], visible: false });
add({ type: 'box', min: [-33, 10, -33], max: [-31, 30, 33], visible: false });
add({ type: 'box', min: [31, 10, -33], max: [33, 30, 33], visible: false });
// glowing bands on the boundary walls
add({ type: 'panel', pos: [0, 9.5, -30.96], size: [62, 0.35], mat: 'neon_blue' });
add({ type: 'panel', pos: [0, 9.5, 30.96], size: [62, 0.35], mat: 'neon_blue', rot: Math.PI });
add({ type: 'panel', pos: [-30.96, 9.5, 0], size: [62, 0.35], mat: 'neon_blue', rot: Math.PI / 2 });
add({ type: 'panel', pos: [30.96, 9.5, 0], size: [62, 0.35], mat: 'neon_blue', rot: -Math.PI / 2 });
for (const x of [-24, -8, 8, 24]) {
  add({ type: 'panel', pos: [x, 5, -30.96], size: [3.2, 3.2], mat: 'light_panel' });
  add({ type: 'panel', pos: [x, 5, 30.96], size: [3.2, 3.2], mat: 'light_panel', rot: Math.PI });
}

// ---------------------------------------------------------------- central deck (tier 2)
add({ type: 'box', min: [-8, 3.9, -8], max: [8, 4.5, 8], mat: 'metal_panel', top: 'concrete_floor', bottom: 'metal_dark' });
for (const sx of [-1, 1]) {
  add({ type: 'box', min: [sx * 8 - 0.15, 3.55, -8.15], max: [sx * 8 + 0.15, 3.9, 8.15], mat: 'metal_dark' });
  add({ type: 'box', min: [-8.15, 3.55, sx * 8 - 0.15], max: [8.15, 3.9, sx * 8 + 0.15], mat: 'metal_dark' });
  for (const sz of [-1, 1]) add({ type: 'pillar', pos: [sx * 6.5, 1.95, sz * 6.5], radius: 0.7, height: 3.9, sides: 10, mat: 'concrete' });
}
add({ type: 'stairs', pos: [0, 2.25, 12], size: [4, 4.5, 8], dir: '-z', mat: 'concrete', top: 'metal_grate' });
add({ type: 'ramp', pos: [12, 2.25, 0], size: [8, 4.5, 4], dir: '-x', mat: 'concrete_dark', top: 'metal_grate' });
// deck railings (gaps for the stairs, ramp and the bridge)
add({ type: 'railing', from: [-8, 4.5, -8], to: [-1.25, 4.5, -8] });
add({ type: 'railing', from: [1.25, 4.5, -8], to: [8, 4.5, -8] });
add({ type: 'railing', from: [-8, 4.5, -8], to: [-8, 4.5, 8] });
add({ type: 'railing', from: [-8, 4.5, 8], to: [-2.2, 4.5, 8] });
add({ type: 'railing', from: [2.2, 4.5, 8], to: [8, 4.5, 8] });
add({ type: 'railing', from: [8, 4.5, -8], to: [8, 4.5, -2.2] });
add({ type: 'railing', from: [8, 4.5, 2.2], to: [8, 4.5, 8] });
// hazard chevrons on the deck floor at the stair mouth, a cover crate pair on the deck
add({ type: 'box', min: [-2, 4.5, 6.2], max: [2, 4.52, 7.8], mat: 'hazard' });
add({ type: 'crate', pos: [-5.5, 5.1, -5.5], size: 1.2 });
add({ type: 'crate', pos: [-4.2, 5.1, -5.5], size: 1.2 });
add({ type: 'crate', pos: [-4.85, 6.3, -5.5], size: 1.2 });
add({ type: 'panel', pos: [0, 3.72, 8.18], size: [12, 0.16], mat: 'neon_orange' });
add({ type: 'panel', pos: [0, 3.72, -8.18], size: [12, 0.16], mat: 'neon_orange', rot: Math.PI });

// ---------------------------------------------------------------- catwalk bridge + north platform
add({ type: 'catwalk', from: [0, 4.5, -8], to: [0, 4.5, -24], width: 2.6, railings: 'both' });
add({ type: 'box', min: [-10, 0, -31], max: [10, 4.5, -24], mat: 'concrete', top: 'concrete_floor' });
add({ type: 'box', min: [-10.2, 4.25, -31], max: [10.2, 4.5, -23.8], mat: 'metal_dark', top: 'concrete_floor' });
add({ type: 'stairs', pos: [14, 2.25, -27.5], size: [8, 4.5, 3.2], dir: '-x', mat: 'concrete', top: 'metal_grate' });
add({ type: 'container', pos: [-5.2, 5.8, -28], rot: Math.PI / 2, color: 'red' });
add({ type: 'container', pos: [6.5, 5.8, -27.4], rot: 0.15, color: 'white' });
add({ type: 'railing', from: [-10, 4.5, -24], to: [-1.25, 4.5, -24] });
add({ type: 'railing', from: [1.25, 4.5, -24], to: [10, 4.5, -24] });
add({ type: 'railing', from: [10, 4.5, -24], to: [10, 4.5, -27.9] });
add({ type: 'railing', from: [-10, 4.5, -24], to: [-10, 4.5, -31] });

// ---------------------------------------------------------------- wall-run corridor (NW)
add({ type: 'wall', from: [-31, -20], to: [-10, -20], y0: 0, height: 8, thickness: 0.6, mat: 'metal_panel', top: 'hazard' });
add({ type: 'wall', from: [-31, -14.5], to: [-10, -14.5], y0: 0, height: 8, thickness: 0.6, mat: 'metal_panel', top: 'hazard' });
add({ type: 'panel', pos: [-20.5, 6.6, -19.68], size: [19, 0.3], mat: 'neon_green', rot: Math.PI });
add({ type: 'panel', pos: [-20.5, 6.6, -14.82], size: [19, 0.3], mat: 'neon_pink' });
for (const x of [-27, -20.5, -14]) {
  add({ type: 'box', min: [x - 0.3, 0, -20.45], max: [x + 0.3, 8, -20], mat: 'metal_dark' });
  add({ type: 'box', min: [x - 0.3, 0, -14.5], max: [x + 0.3, 8, -14.05], mat: 'metal_dark' });
}

// ---------------------------------------------------------------- pit rim wall (wall-run over the pit) + gantry
add({ type: 'wall', from: [-28, 26.3], to: [-14, 26.3], y0: 0, height: 7, thickness: 0.6, mat: 'concrete' });
add({ type: 'pillar', pos: [-14, 6.5, -5], radius: 0.9, height: 13, sides: 10, mat: 'concrete_dark' });
add({ type: 'pillar', pos: [14, 6.5, -5], radius: 0.9, height: 13, sides: 10, mat: 'concrete_dark' });
add({ type: 'box', min: [-14.6, 12, -5.5], max: [14.6, 12.7, -4.5], mat: 'metal_dark', top: 'metal_painted_yellow' });
add({ type: 'box', min: [-14.6, 11.4, -5.15], max: [14.6, 12, -4.85], mat: 'metal_dark' });

// ---------------------------------------------------------------- grapple tower (NE)
add({ type: 'box', min: [20, 0, -18], max: [24, 15.4, -14], mat: 'concrete_dark' });
add({ type: 'box', min: [19.9, 0, -18.1], max: [24.1, 1.2, -13.9], mat: 'hazard' });
add({ type: 'box', min: [17, 15.4, -21], max: [27, 16, -11], mat: 'metal_panel', top: 'metal_grate', bottom: 'metal_dark' });
add({ type: 'box', min: [16.85, 15.1, -21.15], max: [27.15, 15.4, -10.85], mat: 'metal_dark' });
add({ type: 'railing', from: [17, 16, -21], to: [27, 16, -21] });
add({ type: 'railing', from: [17, 16, -11], to: [27, 16, -11] });
add({ type: 'railing', from: [17, 16, -21], to: [17, 16, -17.6] });
add({ type: 'railing', from: [17, 16, -14.4], to: [17, 16, -11] });
add({ type: 'railing', from: [27, 16, -21], to: [27, 16, -11] });
add({ type: 'box', min: [21.8, 16, -15], max: [23, 19.6, -14], mat: 'metal_panel' });
add({ type: 'box', min: [21.9, 18.9, -14], max: [22.9, 19.6, -3], mat: 'metal_dark', top: 'metal_painted_yellow' });
add({ type: 'cylinder', pos: [22.4, 17.7, -3.6], radius: 0.28, height: 2.4, sides: 8, mat: 'metal_dark' });
add({ type: 'panel', pos: [22, 9, -13.96], size: [0.5, 12], mat: 'neon_orange' });
add({ type: 'panel', pos: [22, 9, -18.04], size: [0.5, 12], mat: 'neon_orange', rot: Math.PI });
add({ type: 'panel', pos: [19.96, 9, -16], size: [0.5, 12], mat: 'neon_orange', rot: -Math.PI / 2 });
add({ type: 'panel', pos: [24.04, 9, -16], size: [0.5, 12], mat: 'neon_orange', rot: Math.PI / 2 });
add({ type: 'crate', pos: [25.5, 16.6, -12.5], size: 1.2 });
add({ type: 'box', min: [24.6, 16, -20.2], max: [26.6, 16.9, -19.6], mat: 'concrete' });

// ---------------------------------------------------------------- container yard (SE)
add({ type: 'container', pos: [18, 1.3, 20], color: 'red' });
add({ type: 'container', pos: [20.5, 1.3, 20], color: 'blue' });
add({ type: 'container', pos: [19.25, 3.9, 20], rot: Math.PI / 2, color: 'green' });
add({ type: 'container', pos: [26.5, 1.3, 13], rot: Math.PI / 2, color: 'yellow' });
add({ type: 'container', pos: [24, 1.3, 25.5], rot: 0.35, color: 'orange' });
add({ type: 'crate', pos: [14.2, 0.6, 18.5] });
add({ type: 'crate', pos: [14.2, 0.6, 19.75] });
add({ type: 'crate', pos: [14.2, 1.8, 19.1] });
add({ type: 'crate', pos: [22.5, 0.6, 15.5], rot: 0.5 });
add({ type: 'crate', pos: [5, 0.6, 18] });
add({ type: 'crate', pos: [6.25, 0.6, 18.4], rot: 0.3 });
add({ type: 'crate', pos: [5.6, 1.8, 18.2], rot: 0.1 });
add({ type: 'crate', pos: [-9, 0.6, -12] });
add({ type: 'crate', pos: [-9, 0.6, 3], size: [1.8, 1.2, 1.8] });

// ---------------------------------------------------------------- cover walls, barrels, pipes, arch
add({ type: 'wall', from: [-6, 12], to: [-6, 22], y0: 0, height: 1.3, thickness: 0.5, mat: 'concrete' });
add({ type: 'wall', from: [10, -12], to: [16, -12], y0: 0, height: 1.3, thickness: 0.5, mat: 'concrete' });
add({ type: 'wall', from: [-24, -8], to: [-18, -3], y0: 0, height: 1.3, thickness: 0.5, mat: 'concrete' });
add({ type: 'wall', from: [-2, 24], to: [8, 24], y0: 0, height: 1.3, thickness: 0.5, mat: 'concrete' });
for (const [x, z] of [[27, -4], [28, -2.6], [27.4, -1.2], [-12, -27], [-13.2, -28.5]]) {
  add({ type: 'cylinder', pos: [x, 0.55, z], radius: 0.42, height: 1.1, sides: 12, mat: 'container_orange' });
}
add({ type: 'cylinder', pos: [29.6, 3.2, 8], radius: 0.28, height: 12, sides: 8, axis: 'z', mat: 'metal_rust' });
add({ type: 'arch', pos: [12, 2.75, 7], size: [6, 5.5, 1.2], thickness: 1.2, lintel: 1, mat: 'stone_blocks' });

// ---------------------------------------------------------------- lights
const lights = [
  { pos: [0, 2.9, 0], color: '#ffb46b', intensity: 38, distance: 16 },
  { pos: [-20.5, 5.5, -17.25], color: '#7fd0ff', intensity: 46, distance: 24 },
  { pos: [22, 13, -16], color: '#ff9a3c', intensity: 50, distance: 26 },
  { pos: [-21, 2.5, 17], color: '#b18cff', intensity: 34, distance: 18 },
];

export default {
  id: 'sandbox',
  name: 'Proving Grounds',
  subtitle: 'Training arena · Day',
  description: 'A clean training arena with wall-run corridors, a grapple tower, a sunken pit, ramps, stairs and every pickup. Perfect for learning the movement.',
  colors: ['#1a8f7a', '#1b2a35'],
  bounds: { min: [-32, -6, -32], max: [32, 34, 32] },
  killY: -20,
  previewCamera: { pos: [30, 38, 46], lookAt: [0, 3, -2] },
  theme: {
    sky: { top: '#2f6fd0', horizon: '#c2dbf2', bottom: '#59606a', sunColor: '#fff0d0', sunSize: 1.1, stars: false, clouds: 0.4 },
    sun: { dir: [-0.38, 0.8, 0.46], color: '#fff0dc', intensity: 2.25 },
    hemi: { sky: '#d6e2f2', ground: '#5c5040', intensity: 0.66 },
    fog: { color: '#c7dcf0', near: 90, far: 330 },
    exposure: 0.88,
    envIntensity: 0.5,
    // bloom (see Game._setupComposer): strength = the value at 100 % Glow (default setting 65 %)
    bloom: { strength: 2.4, radius: 0.8, threshold: 0.7, knee: 0.3 },
  },
  solids,
  lights,
  spawns: [
    { pos: [-26, 0, -27], lookAt: [0, 0, 0] },
    { pos: [-27, 0, -8], lookAt: [0, 0, 0] },
    { pos: [-6, 0, -14], lookAt: [0, 0, 8] },
    { pos: [14, 0, -8], lookAt: [0, 0, 0] },
    { pos: [28, 0, -8], lookAt: [0, 0, 0] },
    { pos: [28, 0, 6], lookAt: [0, 0, 0] },
    { pos: [28, 0, 29], lookAt: [0, 0, 0] },
    { pos: [8, 0, 28], lookAt: [0, 0, 0] },
    { pos: [-9, 0, 20], lookAt: [0, 0, 0] },
    { pos: [-10, 0, 29], lookAt: [0, 0, 0] },
    { pos: [-27, 0, 29], lookAt: [0, 0, 0] },
    { pos: [-20, 0, -17.25], lookAt: [-10, 0, -17.25] },
    { pos: [-2, 4.5, -3], lookAt: [0, 4.5, 8] },
    { pos: [5, 4.5, 5], lookAt: [0, 4.5, -8] },
    { pos: [-7, 4.5, -27], lookAt: [0, 4.5, 0] },
    { pos: [7, 4.5, -29], lookAt: [0, 4.5, 0] },
  ],
  pickups: [
    { type: 'health', pos: [0, 4.5, 4], amount: 50 },
    { type: 'health', pos: [-15, 0, -17.25], amount: 25 },
    { type: 'health', pos: [26, 0, 19], amount: 25 },
    { type: 'health', pos: [-25, -4, 13], amount: 25 },
    { type: 'armor', pos: [0, 4.5, -28] },
    { type: 'armor', pos: [28, 0, 28] },
    { type: 'ammo', pos: [-12, 0, 2] },
    { type: 'ammo', pos: [12, 0, 12] },
    { type: 'ammo', pos: [28, 0, -28] },
    { type: 'ammo', pos: [-2, 0, 27.5] },
    { type: 'grenades', pos: [-28, 0, -17.25], amount: 2 },
    { type: 'grenades', pos: [14, 0, 3], amount: 2 },
    { type: 'weapon', weapon: 'rocket', pos: [0, 4.5, 0] },
    { type: 'weapon', weapon: 'sniper', pos: [24, 16, -19] },
    { type: 'weapon', weapon: 'shotgun', pos: [-20, 0, -27] },
  ],
  // King of the Hill control zones, in rotation order: pos = floor centre [x, y, z], radius (m); entities count with feet within [-1.2, +3.2] m of the floor
  zones: [
    { id: 'deck', name: 'Under the Deck', pos: [0, 0, 0], radius: 6 },
    { id: 'pit', name: 'The Pit', pos: [-22, -4, 12], radius: 5.5 },
    { id: 'north', name: 'North Platform', pos: [0, 4.5, -27.5], radius: 5.5 },
    { id: 'south', name: 'South Yard', pos: [3, 0, 21], radius: 6 },
  ],
  jumpPads: [
    { pos: [12, 0, -16], target: [19.5, 16, -16], apex: 4 },
    { pos: [-25, -4, 20], target: [-25, 0, 5], apex: 3 },
  ],
};
