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
// boundary
S.push({ type: 'box', min: [-91, 0, -91], max: [-90, 40, 91], mat: 'concrete_dark' });
S.push({ type: 'box', min: [90, 0, -91], max: [91, 40, 91], mat: 'concrete_dark' });
S.push({ type: 'box', min: [-91, 0, -91], max: [91, 40, -90], mat: 'concrete_dark' });
S.push({ type: 'box', min: [-91, 0, 90], max: [91, 40, 91], mat: 'concrete_dark' });
// A: wall-run walls
S.push({ type: 'box', min: [-11, 0, -60], max: [-10, 14, 60], mat: 'metal_panel' });
S.push({ type: 'box', min: [-4, 0, -60], max: [-3, 14, 60], mat: 'concrete' });
// B: ledges
const heights = [0.4, 0.7, 1.0, 1.5, 2.0, 2.3, 2.6];
heights.forEach((h, i) => {
  const zc = -52 + i * 8;
  S.push({ type: 'box', min: [8, 0, zc - 2], max: [16, h, zc + 2], mat: i % 2 ? 'concrete_dark' : 'metal_panel' });
});
// C: tower and beam
S.push({ type: 'box', min: [36, 0, -4], max: [44, 26, 4], mat: 'metal_panel' });
S.push({ type: 'box', min: [20, 14, 20], max: [44, 15, 24], mat: 'metal_dark' });
// D: ramps
S.push({ type: 'ramp', pos: [60, 1.75, 30], size: [20, 3.5, 6], dir: '+x', mat: 'concrete' });
S.push({ type: 'box', min: [70, 0, 27], max: [80, 3.5, 33], mat: 'concrete_dark' });
S.push({ type: 'ramp', pos: [60, 4.5, 45], size: [20, 9, 6], dir: '+x', mat: 'concrete' });
S.push({ type: 'ramp', pos: [60, 4.5, 60], size: [20, 9, 6], dir: '-x', mat: 'concrete' });
S.push({ type: 'box', min: [50, 0, 57], max: [70, 0.05, 63], mat: 'concrete_dark', collide: false });
// E: curbs
S.push({ type: 'box', min: [-30, 0, 20], max: [-28, 0.2, 30], mat: 'hazard' });
S.push({ type: 'box', min: [-26, 0, 20], max: [-24, 0.35, 30], mat: 'hazard' });
S.push({ type: 'box', min: [-22, 0, 20], max: [-20, 0.5, 30], mat: 'hazard' });
// F: thin wall
S.push({ type: 'box', min: [-70, 0, -10], max: [-69.7, 8, 10], mat: 'metal_dark' });
// G: low ceiling slab
S.push({ type: 'box', min: [20, 1.4, -30], max: [36, 2, -22], mat: 'metal_dark' });

export default {
  id: 'ftest',
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
