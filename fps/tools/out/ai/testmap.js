// AI test arena: 80x80, ground floor with a 12x12 pit (kill plane), a raised platform with stairs + ramp,
// a wall with a doorway, cover, a jumpable curb and a couple of drops. Used by tools/out/ai/harness.html
// and by the game via mapfile=tools/out/ai/testmap.js
export default {
  id: 'ai_test',
  name: 'AI Test Arena',
  subtitle: 'AI verification',
  description: 'Scratch map for the AI engineer.',
  colors: ['#203040', '#40a0ff'],
  bounds: { min: [-40, -20, -40], max: [40, 24, 40] },
  killY: -15,
  previewCamera: { pos: [45, 30, 45], lookAt: [0, 0, 0] },
  theme: {
    sky: { top: '#5b86c9', horizon: '#d6e4f5', bottom: '#8f9aa5', sunColor: '#fff2d0', sunSize: 1 },
    sun: { dir: [-0.4, 0.8, 0.35], color: '#fff0d8', intensity: 2.6 },
    hemi: { sky: '#bcd4ff', ground: '#4a4034', intensity: 0.8 },
    fog: { color: '#a9bcd6', near: 80, far: 240 },
    exposure: 1.0, envIntensity: 0.7,
    bloom: { strength: 0.3, radius: 0.4, threshold: 0.9 },
  },
  solids: [
    // floor pieces around a pit at x -28..-16, z 12..24
    { type: 'box', min: [-40, -1, -40], max: [40, 0, 12], mat: 'concrete_floor' },
    { type: 'box', min: [-40, -1, 24], max: [40, 0, 40], mat: 'concrete_floor' },
    { type: 'box', min: [-40, -1, 12], max: [-28, 0, 24], mat: 'concrete_floor' },
    { type: 'box', min: [-16, -1, 12], max: [40, 0, 24], mat: 'concrete_floor' },
    // boundary walls
    { type: 'box', min: [-41, -20, -41], max: [41, 12, -40], mat: 'concrete_dark' },
    { type: 'box', min: [-41, -20, 40], max: [41, 12, 41], mat: 'concrete_dark' },
    { type: 'box', min: [-41, -20, -40], max: [-40, 12, 40], mat: 'concrete_dark' },
    { type: 'box', min: [40, -20, -40], max: [41, 12, 40], mat: 'concrete_dark' },
    // raised platform (tier 2) north-east, top at y=4
    { type: 'box', min: [10, 0, -32], max: [32, 4, -10], mat: 'metal_panel' },
    // stairs up the south face: rises toward -z, from y=0 at z=-2 to y=4 at z=-10
    { type: 'stairs', pos: [20, 2, -6], size: [4, 4, 8], dir: '-z', mat: 'concrete' },
    // ramp on the west side: rises toward +x, from x=2 to x=10
    { type: 'ramp', pos: [6, 2, -20], size: [8, 4, 4], dir: '+x', mat: 'metal_dark' },
    // wall with a 3 m doorway (x -14..-11)
    { type: 'box', min: [-30, 0, 4.75], max: [-14, 4, 5.25], mat: 'brick' },
    { type: 'box', min: [-11, 0, 4.75], max: [6, 4, 5.25], mat: 'brick' },
    // central cover
    { type: 'cylinder', pos: [0, 1.5, 0], radius: 1.3, height: 3, mat: 'concrete_dark' },
    { type: 'crate', pos: [6, 0.6, 3], size: 1.2 },
    { type: 'crate', pos: [-6, 0.6, -3], size: 1.2 },
    { type: 'box', min: [-9, 0, -12], max: [-5, 2.2, -11], mat: 'container_red' },
    { type: 'box', min: [8, 0, 10], max: [14, 1.1, 12], mat: 'crate' }, // 1.1 m curb: needs a jump link
    { type: 'box', min: [-3, 0, 14], max: [3, 2.4, 15], mat: 'concrete' },
    { type: 'box', min: [-3, 0, 30], max: [3, 2.4, 31], mat: 'concrete' },
    { type: 'box', min: [24, 0, 20], max: [25, 3, 32], mat: 'concrete' },
    // low platform west, top at y=2.0 reached by a ramp, with a drop-off on the far side
    { type: 'box', min: [-38, 0, -30], max: [-24, 2, -14], mat: 'metal_dark' },
    { type: 'ramp', pos: [-20, 1, -22], size: [8, 2, 4], dir: '-x', mat: 'concrete' },
    // pillars
    { type: 'pillar', pos: [-14, 3, -22], radius: 0.6, height: 6 },
    { type: 'pillar', pos: [30, 3, 6], radius: 0.6, height: 6 },
    { type: 'pillar', pos: [14, 3, 30], radius: 0.6, height: 6 },
  ],
  lights: [],
  spawns: [
    { pos: [0, 0, 34], yaw: 0 }, { pos: [-34, 0, 34], yaw: -0.8 }, { pos: [34, 0, 34], yaw: 0.8 },
    { pos: [-34, 0, -8], yaw: -1.6 }, { pos: [34, 0, -2], yaw: 1.6 }, { pos: [0, 0, -34], yaw: 3.14 },
    { pos: [20, 4, -24], yaw: 3.14 }, { pos: [-30, 2, -22], yaw: -1.6 }, { pos: [-20, 0, -30], yaw: 3 },
    { pos: [12, 0, 4], yaw: 0 }, { pos: [-10, 0, 20], yaw: 0 }, { pos: [30, 0, 16], yaw: 1.6 },
  ],
  pickups: [
    { type: 'health', pos: [0, 0, -20], amount: 50 },
    { type: 'health', pos: [-30, 2, -22], amount: 25 },
    { type: 'health', pos: [28, 0, 30], amount: 50 },
    { type: 'armor', pos: [20, 4, -20], amount: 50 },
    { type: 'ammo', pos: [-8, 0, 25], amount: 1 },
    { type: 'ammo', pos: [14, 0, -2], amount: 1 },
    { type: 'grenades', pos: [-34, 0, 4], amount: 2 },
    { type: 'weapon', weapon: 'rocket', pos: [0, 0, 8] },
    { type: 'weapon', weapon: 'sniper', pos: [28, 4, -14] },
    { type: 'weapon', weapon: 'shotgun', pos: [-6, 0, -8] },
  ],
  jumpPads: [],
};
