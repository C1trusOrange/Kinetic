// Flat 60x60 open arena for grenade tests (theme / lights borrowed from the sandbox).
import sandbox from '/src/world/maps/sandbox.js';

const FLOOR = { mat: 'concrete', top: 'concrete_floor' };
const solids = [
  { type: 'box', min: [-30, -5, -30], max: [30, 0, 30], ...FLOOR },
  { type: 'wall', from: [-30.5, -30], to: [-30.5, 30], y0: -5, height: 15, thickness: 1, mat: 'concrete' },
  { type: 'wall', from: [30.5, -30], to: [30.5, 30], y0: -5, height: 15, thickness: 1, mat: 'concrete' },
  { type: 'wall', from: [-30, -30.5], to: [30, -30.5], y0: -5, height: 15, thickness: 1, mat: 'concrete' },
  { type: 'wall', from: [-30, 30.5], to: [30, 30.5], y0: -5, height: 15, thickness: 1, mat: 'concrete' },
  { type: 'box', min: [-31, 10, -31], max: [31, 30, -30], visible: false },
  { type: 'box', min: [-31, 10, 30], max: [31, 30, 31], visible: false },
  { type: 'box', min: [-31, 10, -31], max: [-30, 30, 31], visible: false },
  { type: 'box', min: [30, 10, -31], max: [31, 30, 31], visible: false },
  { type: 'panel', pos: [0, 6, -29.96], size: [40, 0.35], mat: 'neon_blue' },
  { type: 'panel', pos: [-29.96, 6, 0], size: [40, 0.35], mat: 'neon_blue', rot: Math.PI / 2 },
  { type: 'panel', pos: [29.96, 6, 0], size: [40, 0.35], mat: 'neon_blue', rot: -Math.PI / 2 },
  { type: 'crate', pos: [22, 0.6, 22], size: 1.2 },
  { type: 'crate', pos: [-22, 0.6, 22], size: 1.2 },
];
const spawns = [];
for (const [x, z] of [[-22, -22], [22, -22], [-22, 22], [22, 22], [0, -25], [0, 25], [-25, 0], [25, 0]]) spawns.push({ pos: [x, 0, z], yaw: 0 });

export default {
  ...sandbox,
  id: 'gtest',
  name: 'Grenade Test',
  bounds: { min: [-32, -6, -32], max: [32, 34, 32] },
  solids,
  spawns,
  pickups: [],
  jumpPads: [],
};
