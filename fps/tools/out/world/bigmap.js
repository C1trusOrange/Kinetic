// Stress map: 100 x 100 m, ~600 solids, multi-level. Not part of the game.
let seed = 12345;
const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
const R = (a, b) => a + rnd() * (b - a);
const solids = [];
const spawns = [];
solids.push({ type: 'box', min: [-50, -5, -50], max: [50, 0, 50], mat: 'concrete', top: 'concrete_floor' });
for (const [f, t] of [[[-50, -50], [50, -50]], [[-50, 50], [50, 50]], [[-50, -50], [-50, 50]], [[50, -50], [50, 50]]]) {
  solids.push({ type: 'wall', from: f, to: t, y0: -5, height: 18, thickness: 1, mat: 'concrete_dark' });
}
solids.push({ type: 'box', min: [-51, 13, -51], max: [51, 40, -49], visible: false });
solids.push({ type: 'box', min: [-51, 13, 49], max: [51, 40, 51], visible: false });
solids.push({ type: 'box', min: [-51, 13, -51], max: [-49, 40, 51], visible: false });
solids.push({ type: 'box', min: [49, 13, -51], max: [51, 40, 51], visible: false });
// buildings: blocks with an upper deck reachable by ramps
for (let i = 0; i < 26; i++) {
  const x = R(-42, 42), z = R(-42, 42);
  const w = R(6, 14), d = R(6, 14), h = R(3, 5);
  const rot = rnd() < 0.3 ? R(0, 1.5) : 0;
  solids.push({ type: 'box', pos: [x, h / 2, z], size: [w, h, d], rot, mat: i % 2 ? 'brick' : 'concrete_dark', top: 'roof_gravel' });
  solids.push({ type: 'ramp', pos: [x + w / 2 + 4, h / 2, z], size: [8, h, 3], dir: '-x', mat: 'concrete' });
  if (rnd() < 0.5) solids.push({ type: 'stairs', pos: [x, h / 2, z + d / 2 + 4], size: [3, h, 8], dir: '-z', mat: 'stone_blocks' });
}
for (let i = 0; i < 150; i++) solids.push({ type: 'crate', pos: [R(-46, 46), 0.6, R(-46, 46)], size: rnd() < 0.3 ? 1.8 : 1.2, rot: R(0, 3) });
for (let i = 0; i < 60; i++) solids.push({ type: 'container', pos: [R(-46, 46), 1.3, R(-46, 46)], rot: rnd() < 0.5 ? 0 : Math.PI / 2, color: ['red', 'blue', 'green', 'yellow', 'white', 'orange'][i % 6] });
for (let i = 0; i < 60; i++) solids.push({ type: 'cylinder', pos: [R(-46, 46), 0.6, R(-46, 46)], radius: 0.5, height: 1.2, mat: 'container_orange' });
for (let i = 0; i < 40; i++) {
  const x = R(-44, 44), z = R(-44, 44);
  solids.push({ type: 'wall', from: [x, z], to: [x + R(-8, 8), z + R(-8, 8)], y0: 0, height: 2.5, thickness: 0.5, mat: 'plaster' });
}
for (let i = 0; i < 12; i++) solids.push({ type: 'catwalk', from: [R(-40, 30), 5, R(-40, 40)], to: [R(-40, 30) + 12, 5, R(-40, 40)], width: 2.5 });
for (let i = 0; i < 16; i++) spawns.push({ pos: [R(-45, 45), 0, R(-45, 45)], yaw: R(-3, 3) });

export default {
  id: 'bigmap', name: 'Big', subtitle: '', description: '', colors: ['#222', '#444'],
  bounds: { min: [-50, -6, -50], max: [50, 40, 50] }, killY: -20,
  previewCamera: { pos: [0, 70, 80], lookAt: [0, 0, 0] },
  theme: { sky: {}, sun: { dir: [-0.4, 0.8, 0.5], intensity: 2.6 } },
  solids, lights: [], spawns, pickups: [], jumpPads: [],
};
