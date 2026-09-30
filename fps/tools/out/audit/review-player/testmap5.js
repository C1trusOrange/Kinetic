import sandbox from '../../../../src/world/maps/sandbox.js';
const solids = [];
const add = s => solids.push(s);
add({ type: 'box', min: [-40, -5, -40], max: [40, 0, 40], mat: 'concrete', top: 'concrete_floor' });
add({ type: 'box', min: [-41, -5, -41], max: [41, 60, -40], mat: 'concrete' });
add({ type: 'box', min: [-41, -5, 40], max: [41, 60, 41], mat: 'concrete' });
add({ type: 'box', min: [-41, -5, -41], max: [-40, 60, 41], mat: 'concrete' });
add({ type: 'box', min: [40, -5, -41], max: [41, 60, 41], mat: 'concrete' });
// free-standing pillar with 4 vertical edges (corners) and a rotated one
add({ type: 'box', min: [0, 0, 0], max: [2, 4, 2], mat: 'concrete_dark' });
for (let i = 0; i < 6; i++) add({ type: 'box', min: [-30 + i * 8, 0, 10], max: [-26 + i * 8, 0.5 + i * 0.35, 14], mat: 'concrete_dark' });
add({ type: 'box', pos: [15, 2, 0], size: [2, 4, 2], rot: 0.6, mat: 'concrete_dark' });
export default {
  ...sandbox,
  id: 'testmap5', name: 'Test', bounds: { min: [-40, -6, -40], max: [40, 40, 40] }, killY: -20,
  solids, lights: [], pickups: [], jumpPads: [],
  spawns: [{ pos: [-30, 0, 30], yaw: 0 }, { pos: [-30, 0, 20], yaw: 0 }, { pos: [30, 0, 30], yaw: 0 }, { pos: [30, 0, -30], yaw: 0 }],
};
