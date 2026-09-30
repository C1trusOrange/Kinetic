// Movement test map (boxes + ramps only). Layout (x right, z toward the camera at yaw 0):
//   A  x -11..-3    two 14 m tall walls, 6 m apart, 120 m long (wall-run / wall-jump)
//   B  x 8..16      ledges of height 0.4 .. 2.6 for mantling (z -52 .. -4)
//   C  x 36..44     26 m tower + overhead beam for grappling
//   D  x 50..80     ramps: gentle (10 deg), steep (24 deg), downhill
//   E  x -30..-20   curbs 0.2 / 0.35 / 0.5 for step-up
//   F  x -70        0.3 m thin wall (tunnelling test)
//   G  x 20..36     low ceiling slab (crouch / stand blocking)
const S = [];
S.push({ type: 'box', min: [-90, -2, -90], max: [90, 0, 90], mat: 'concrete_floor' });
const hs = [0.3, 0.4, 0.45, 0.5, 0.55, 0.6, 0.7, 0.9];
hs.forEach((h, i) => { S.push({ type: 'box', min: [10, 0, i * 8 - 3], max: [14, h, i * 8 + 3], mat: 'hazard' }); });
S.push({ type: 'box', min: [-91, 0, -91], max: [-90, 40, 91], mat: 'concrete_dark' });
S.push({ type: 'box', min: [90, 0, -91], max: [91, 40, 91], mat: 'concrete_dark' });
S.push({ type: 'box', min: [-91, 0, -91], max: [91, 40, -90], mat: 'concrete_dark' });
S.push({ type: 'box', min: [-91, 0, 90], max: [91, 40, 91], mat: 'concrete_dark' });
export default {
  id: 'ctest',
  name: 'Movement Test',
  subtitle: 'Player test map',
  description: 'Movement test map.',
  colors: ['#123', '#345'],
  bounds: { min: [-100, -2, -100], max: [100, 40, 100] },
  killY: -30,
  previewCamera: { pos: [0, 30, 80], lookAt: [0, 5, 0] },
  theme: {
    sky: { top: '#4a78b8', horizon: '#c8d8ea', bottom: '#8090a0', sunColor: '#fff2d0', sunSize: 1 },
    sun: { dir: [-0.5, 0.75, 0.35], color: '#fff0d8', intensity: 2.6 },
    hemi: { sky: '#a8c4ff', ground: '#3a3228', intensity: 0.7 },
    fog: { color: '#a8b8cc', near: 80, far: 260 },
    exposure: 1.0, envIntensity: 0.6,
    bloom: { strength: 0.3, radius: 0.4, threshold: 0.9 },
  },
  solids: S,
  lights: [],
  spawns: [{ pos: [0, 0, 40], yaw: 0 }, { pos: [4, 0, 40], yaw: 0 }, { pos: [-4, 0, 40], yaw: 0 }],
  pickups: [],
  jumpPads: [],
};
