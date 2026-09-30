export default {
  id: 'auditsun', name: 'AuditSun', subtitle: 'test', description: 'audit',
  colors: ['#222', '#888'],
  bounds: { min: [-50, -6, -10], max: [50, 20, 10] },
  killY: -20,
  previewCamera: { pos: [0, 30, 30], lookAt: [0, 0, 0] },
  theme: {
    sky: { top: '#3f7fd6', horizon: '#bcd7ee', bottom: '#4f5560', sunColor: '#fff1d6' },
    sun: { dir: [0.02, 1, 0.02], color: '#fff0dc', intensity: 2.7 },
    hemi: { sky: '#bcd7ee', ground: '#3a3128', intensity: 0.7 },
    fog: { color: '#c7dcf0', near: 90, far: 330 },
    exposure: 1.0, envIntensity: 0.7,
    bloom: { strength: 0.3, radius: 0.4, threshold: 0.9 },
  },
  solids: [
    { type: 'box', min: [-50, -1, -10], max: [50, 0, 10], mat: 'concrete_floor' },
    { type: 'box', min: [-48, 0, -2], max: [-44, 6, 2], mat: 'brick' },
    { type: 'box', min: [44, 0, -2], max: [48, 6, 2], mat: 'brick' },
    { type: 'box', min: [-2, 0, -2], max: [2, 6, 2], mat: 'brick' },
  ],
  lights: [{ pos: [0, 6, 0], color: '#ffffff', intensity: 40, distance: 30 }],
  spawns: [{ pos: [-10, 0, -5], yaw: 0 }, { pos: [10, 0, -5], yaw: 0 }, { pos: [-10, 0, 5], yaw: 0 }, { pos: [10, 0, 5], yaw: 0 }, { pos: [-14, 0, 0], yaw: 0 }, { pos: [14, 0, 5], yaw: 0 }, { pos: [-14, 0, 5], yaw: 0 }, { pos: [14, 0, -5], yaw: 0 }],
  pickups: [], jumpPads: [],
};
