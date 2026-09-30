// Scratch test map: one 40x40 platform (top y=0) floating over a void, kill plane at y=-13.
const solids = [
  { type: 'box', min: [-20, -4, -20], max: [20, 0, 20], mat: 'concrete_floor', bottom: 'rock' },
  { type: 'box', min: [-21, 0, -21], max: [-20, 40, 21], visible: false },
  { type: 'box', min: [-21, 0, -21], max: [21, 40, -20], visible: false },
  { type: 'box', min: [-21, 0, 20], max: [21, 40, 21], visible: false },
];
export default {
  id: 'voidtest', name: 'VoidTest', subtitle: 'test', description: 'test', colors: ['#223', '#ccf'],
  bounds: { min: [-30, -20, -30], max: [30, 40, 30] },
  killY: -13,
  previewCamera: { pos: [30, 20, 30], lookAt: [0, 0, 0] },
  theme: {
    sky: { top: '#2f74d0', horizon: '#dff1ff', bottom: '#f3f8ff', sunColor: '#fff4d6', sunSize: 1.2, stars: false, clouds: 0.45 },
    sun: { dir: [0.55, 0.55, 0.35], color: '#fff1d8', intensity: 3.0 },
    hemi: { sky: '#b9d8ff', ground: '#e8f0e0', intensity: 1.0 },
    fog: { color: '#dcebf8', near: 70, far: 300 },
    exposure: 1.0, envIntensity: 0.7, bloom: { strength: 0.28, radius: 0.5, threshold: 0.92 },
  },
  solids,
  lights: [],
  spawns: [
    { pos: [-15, 0, 0], yaw: 0 }, { pos: [15, 0, 0], yaw: 0 }, { pos: [0, 0, -15], yaw: 0 }, { pos: [0, 0, 15], yaw: 0 },
  ],
  pickups: [],
  jumpPads: [],
};
