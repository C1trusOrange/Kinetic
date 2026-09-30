// Night / density-fog theme test. Not part of the game.
export default {
  id: 'night', name: 'Night', subtitle: '', description: '', colors: ['#222', '#444'],
  bounds: { min: [-30, -6, -30], max: [30, 30, 30] }, killY: -20,
  previewCamera: { pos: [0, 30, 40], lookAt: [0, 0, 0] },
  theme: {
    sky: { top: '#050a1c', horizon: '#3b2f55', bottom: '#120f1a', sunColor: '#ffd9a0', sunSize: 1, stars: true, clouds: 0.25 },
    sun: { dir: [-0.5, 0.35, 0.35], color: '#ffe2b8', intensity: 1.6 },
    hemi: { sky: '#8aa0ff', ground: '#2c2218', intensity: 0.5 },
    fog: { color: '#241f38', density: 0.012 },
    exposure: 1.0, envIntensity: 0.6,
    bloom: { strength: 0.55, radius: 0.4, threshold: 0.85 },
  },
  solids: [
    { type: 'box', min: [-30, -5, -30], max: [30, 0, 30], mat: 'asphalt' },
    { type: 'box', pos: [0, 2, -10], size: [10, 4, 4], mat: 'brick' },
    { type: 'pillar', pos: [8, 3, 4], radius: 0.6, height: 6, mat: 'stone_blocks' },
    { type: 'panel', pos: [0, 2, -7.9], size: [6, 1], mat: 'neon_pink', rot: 0 },
    { type: 'container', pos: [-8, 1.3, 6], color: 'blue' },
  ],
  lights: [{ pos: [0, 4, -4], color: '#ff5fb0', intensity: 60, distance: 20 }],
  spawns: [{ pos: [0, 0, 10], yaw: 0 }], pickups: [{ type: 'health', pos: [3, 0, 3] }], jumpPads: [],
};
