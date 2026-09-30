// Scratch test map for gun-feel screenshots (not part of the game). Flat arena, varied surfaces at 8-40 m.
const P = new URLSearchParams(location.search);
const night = P.get('night') === '1';
const solids = [];
const add = s => { solids.push(s); return s; };
add({ type: 'box', min: [-60, -5, -60], max: [60, 0, 60], mat: 'concrete', top: 'concrete_floor' });
add({ type: 'wall', from: [-60, -59.5], to: [60, -59.5], y0: -5, height: 20, thickness: 1, mat: 'concrete' });
add({ type: 'wall', from: [-60, 59.5], to: [60, 59.5], y0: -5, height: 20, thickness: 1, mat: 'concrete' });
add({ type: 'wall', from: [-59.5, -60], to: [-59.5, 60], y0: -5, height: 20, thickness: 1, mat: 'concrete' });
add({ type: 'wall', from: [59.5, -60], to: [59.5, 60], y0: -5, height: 20, thickness: 1, mat: 'concrete' });
add({ type: 'box', min: [-61, 12, -61], max: [61, 40, 61], visible: false });
// backdrop wall at z=-30 with surface patches
add({ type: 'wall', from: [-24, -30], to: [24, -30], y0: 0, height: 6, thickness: 1, mat: 'concrete' });
add({ type: 'box', min: [-22, 0, -29.6], max: [-14, 5, -29.4], mat: 'metal_panel' });
add({ type: 'box', min: [-12, 0, -29.6], max: [-4, 5, -29.4], mat: 'brick' });
add({ type: 'box', min: [-2, 0, -29.6], max: [6, 5, -29.4], mat: 'stone_blocks' });
add({ type: 'box', min: [8, 0, -29.6], max: [16, 5, -29.4], mat: 'wood_planks' });
add({ type: 'box', min: [18, 0, -29.6], max: [23, 5, -29.4], mat: 'glass_window' });
// mid-field cover
add({ type: 'crate', pos: [-6, 0.6, -12], size: 1.2 });
add({ type: 'crate', pos: [6, 0.6, -14], size: 1.2 });
add({ type: 'container', pos: [-14, 1.3, -10], rot: 0.4, color: 'red' });
add({ type: 'container', pos: [14, 1.3, -18], rot: -0.3, color: 'blue' });
add({ type: 'box', min: [-3, 0, -46], max: [3, 2, -44], mat: 'metal_panel' });
const lights = night
  ? [{ pos: [0, 8, -10], color: '#ffae5c', intensity: 40, distance: 30 }, { pos: [-14, 6, 8], color: '#5c9cff', intensity: 40, distance: 30 }]
  : [];
export default {
  id: 'gunfeel', name: 'Gun Feel', subtitle: 'test', description: 'scratch',
  colors: ['#334455', '#ffaa44'],
  bounds: { min: [-60, -6, -60], max: [60, 40, 60] },
  killY: -20,
  previewCamera: { pos: [0, 20, 40], lookAt: [0, 0, -10] },
  theme: night ? {
    sky: { top: '#0a1024', horizon: '#3b2f55', bottom: '#120f1a', sunColor: '#ffd9a0', sunSize: 1, stars: true, clouds: 0.25 },
    sun: { dir: [-0.5, 0.7, 0.35], color: '#ffe2b8', intensity: 0.6 },
    hemi: { sky: '#8aa0ff', ground: '#2c2218', intensity: 0.35 },
    fog: { color: '#1a1830', near: 40, far: 190 },
    exposure: 1.0, envIntensity: 0.3,
    bloom: { strength: 0.55, radius: 0.4, threshold: 0.85 },
  } : {
    sky: { top: '#2f6fd0', horizon: '#c2dbf2', bottom: '#59606a', sunColor: '#fff0d0', sunSize: 1.1, stars: false, clouds: 0.4 },
    sun: { dir: [-0.38, 0.8, 0.46], color: '#fff0dc', intensity: 2.7 },
    hemi: { sky: '#d6e2f2', ground: '#5c5040', intensity: 0.7 },
    fog: { color: '#c7dcf0', near: 90, far: 330 },
    exposure: 1.0, envIntensity: 0.55,
    bloom: { strength: 0.32, radius: 0.4, threshold: 0.9 },
  },
  solids, lights,
  spawns: [
    { pos: [0, 0, 22], yaw: 0 }, { pos: [8, 0, 22], yaw: 0 }, { pos: [-8, 0, 22], yaw: 0 }, { pos: [16, 0, 22], yaw: 0 },
    { pos: [-16, 0, 22], yaw: 0 }, { pos: [0, 0, 30], yaw: 0 }, { pos: [20, 0, 10], yaw: 0 }, { pos: [-20, 0, 10], yaw: 0 },
  ],
  pickups: [],
  jumpPads: [],
};
