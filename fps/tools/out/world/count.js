export default {
  id: 'count', name: 'Count', bounds: { min: [-20, -6, -20], max: [20, 30, 20] }, killY: -20, theme: {},
  solids: [
    { type: 'box', min: [-20, -5, -20], max: [20, 0, 20] },
    { type: 'container', pos: [0, 1.3, 0], color: 'red' },
    { type: 'railing', from: [5, 0, 5], to: [15, 0, 5] },
    { type: 'catwalk', from: [-15, 3, -10], to: [-5, 3, -10] },
    { type: 'pillar', pos: [10, 2.5, -10], radius: 0.7, height: 5 },
    { type: 'crate', pos: [-10, 0.6, 10] },
    { type: 'cylinder', pos: [10, 0.6, 10], radius: 0.5, height: 1.2 },
    { type: 'arch', pos: [0, 2.5, 12], size: [6, 5, 1.2] },
    { type: 'stairs', pos: [-10, 1.25, 0], size: [3, 2.5, 6], dir: '+z' },
  ],
  spawns: [], pickups: [], jumpPads: [], lights: [],
};
