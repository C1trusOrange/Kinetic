// Flat test arena with steps of several heights for bot jump tests.
const solids = [];
solids.push({ type: 'box', min: [-40, -5, -40], max: [40, 0, 40], mat: 'concrete', top: 'concrete_floor' });
const heights = [1.3, 1.4, 1.5, 1.6, 1.7];
heights.forEach((h, k) => {
  const z0 = -30 + k * 12;
  solids.push({ type: 'box', min: [10, 0, z0 - 3], max: [30, h, z0 + 3], mat: 'crate', top: 'concrete_floor' });
});
solids.push({ type: 'wall', from: [-40, -40], to: [40, -40], y0: -5, height: 30, thickness: 1 });
solids.push({ type: 'wall', from: [-40, 40], to: [40, 40], y0: -5, height: 30, thickness: 1 });
solids.push({ type: 'wall', from: [-40, -40], to: [-40, 40], y0: -5, height: 30, thickness: 1 });
solids.push({ type: 'wall', from: [40, -40], to: [40, 40], y0: -5, height: 30, thickness: 1 });
export default {
  id: 'jumptest', name: 'Jump Test', subtitle: 'test', description: 'test', colors: ['#111', '#333'],
  bounds: { min: [-40, -6, -40], max: [40, 30, 40] }, killY: -20,
  previewCamera: { pos: [0, 20, 40], lookAt: [0, 0, 0] },
  theme: {
    sky: { top: '#2f6fd0', horizon: '#c2dbf2', bottom: '#59606a', sunColor: '#fff0d0', sunSize: 1.1, stars: false, clouds: 0.1 },
    sun: { dir: [-0.38, 0.8, 0.46], color: '#fff0dc', intensity: 2.7 },
    hemi: { sky: '#d6e2f2', ground: '#5c5040', intensity: 0.7 },
    fog: { color: '#c7dcf0', near: 90, far: 330 }, exposure: 1.0, envIntensity: 0.55, bloom: { strength: 0.3, radius: 0.4, threshold: 0.9 },
  },
  solids, lights: [],
  spawns: [{ pos: [-30, 0, -30], yaw: 0 }, { pos: [-30, 0, 30], yaw: 0 }, { pos: [-30, 0, 0], yaw: 0 }, { pos: [-20, 0, 0], yaw: 0 }, { pos: [-20, 0, 20], yaw: 0 }, { pos: [-20, 0, -20], yaw: 0 }, { pos: [0, 0, 30], yaw: 0 }, { pos: [0, 0, -35], yaw: 0 }],
  pickups: [], jumpPads: [],
};
