import sandbox from '../../../../src/world/maps/sandbox.js';
const solids = [];
const add = s => solids.push(s);
add({ type: 'box', min: [-40, -5, -40], max: [40, 0, 40], mat: 'concrete', top: 'concrete_floor' });
add({ type: 'box', min: [-41, -5, -41], max: [41, 60, -40], mat: 'concrete' });
add({ type: 'box', min: [-41, -5, 40], max: [41, 60, 41], mat: 'concrete' });
add({ type: 'box', min: [-41, -5, -41], max: [-40, 60, 41], mat: 'concrete' });
add({ type: 'box', min: [40, -5, -41], max: [41, 60, 41], mat: 'concrete' });
// low tunnel (interior height 1.5, width 2.7) x 0..12
add({ type: 'box', min: [0, 0, -1.85], max: [12, 3, -1.35], mat: 'concrete_dark' });
add({ type: 'box', min: [0, 0, 1.35], max: [12, 3, 1.85], mat: 'concrete_dark' });
add({ type: 'box', min: [0, 1.5, -1.85], max: [12, 3, 1.85], mat: 'metal_dark' });
// crouch-height-only tunnel: ceiling at 1.3 (crouch 1.15 fits, stand no)
add({ type: 'box', min: [20, 0, -1.85], max: [30, 3, -1.35], mat: 'concrete_dark' });
add({ type: 'box', min: [20, 0, 1.35], max: [30, 3, 1.85], mat: 'concrete_dark' });
add({ type: 'box', min: [20, 1.3, -1.85], max: [30, 3, 1.85], mat: 'metal_dark' });
// ledge 1.5 high with LOW ceiling above (1.0 clearance)
add({ type: 'box', min: [-3, 0, 20], max: [3, 1.5, 26], mat: 'concrete' });
add({ type: 'box', min: [-3, 2.9, 20], max: [3, 3.9, 26], mat: 'metal_dark' });
add({ type: 'box', min: [-3, 1.5, 26], max: [3, 3.9, 26.5], mat: 'metal_dark' });
// ledge 1.5 high with HIGH ceiling (clearance 2.1)
add({ type: 'box', min: [10, 0, 20], max: [16, 1.5, 26], mat: 'concrete' });
add({ type: 'box', min: [10, 3.6, 20], max: [16, 4.6, 26], mat: 'metal_dark' });
// 0.7 gap between two blocks
add({ type: 'box', min: [-12, 0, -14], max: [-9, 3, -10], mat: 'concrete' });
add({ type: 'box', min: [-8.3, 0, -14], max: [-5.3, 3, -10], mat: 'concrete' });
// thick slab hanging above a low ledge (interior-hole style): ledge 1.2 high, slab of 2.0 thickness starting 1.0 above the ledge
add({ type: 'box', min: [-20, 0, 20], max: [-14, 1.2, 26], mat: 'concrete' });
add({ type: 'box', min: [-20, 2.2, 20], max: [-14, 4.2, 26], mat: 'metal_dark' });

// sloped floor under a flat ceiling: ramp 14.7 deg rising toward +x, ceiling at y=3.0 above x in [-30,-22]
add({ type: 'ramp', pos: [-26, 1.05, -30], size: [8, 2.1, 3], dir: '+x', mat: 'concrete_dark' });
add({ type: 'box', min: [-30, 3.0, -31.5], max: [-22, 4.0, -28.5], mat: 'metal_dark' });
add({ type: 'box', min: [-30, 0, -31.8], max: [-22, 4.0, -31.5], mat: 'concrete_dark' });
add({ type: 'box', min: [-30, 0, -28.5], max: [-22, 4.0, -28.2], mat: 'concrete_dark' });

export default {
  ...sandbox,
  id: 'testmap4', name: 'Test', bounds: { min: [-40, -6, -40], max: [40, 40, 40] }, killY: -20,
  solids, lights: [], pickups: [], jumpPads: [],
  spawns: [{ pos: [-30, 0, 30], yaw: 0 }, { pos: [-30, 0, 20], yaw: 0 }, { pos: [30, 0, 30], yaw: 0 }, { pos: [30, 0, -30], yaw: 0 }],
};
