// Test map: every solid type in every orientation. Not part of the game.
const solids = [];
const drops = [];
const add = s => { solids.push(s); return s; };
const drop = (x, z, y, note) => drops.push({ x, z, y, note });

add({ type: 'box', min: [-40, -5, -40], max: [40, 0, 40], mat: 'concrete', top: 'concrete_floor' });

// boxes
add({ type: 'box', pos: [-30, 1, -30], size: [3, 2, 3] }); drop(-30, -30, 2, 'box');
add({ type: 'box', pos: [-25, 1, -30], size: [3, 2, 3], rot: 0.6, mat: 'brick', top: 'roof_gravel', bottom: 'metal_dark' }); drop(-25, -30, 2, 'rot box');
add({ type: 'box', min: [-22, 0, -32], max: [-18, 3, -28], mat: 'sandstone', bevel: 0.08 }); drop(-20, -30, 3, 'min/max');
// walls at angles
add({ type: 'wall', from: [-30, -22], to: [-22, -18], y0: 0, height: 2.5, thickness: 0.6, mat: 'brick' }); drop(-26, -20, 2.5, 'diag wall');
add({ type: 'wall', from: [-20, -22], to: [-20, -16], y0: 0.5, height: 2, thickness: 0.4, mat: 'plaster' });
// ramps
const dirs = ['+x', '-x', '+z', '-z'];
dirs.forEach((d, i) => {
  add({ type: 'ramp', pos: [-30 + i * 8, 1, -8], size: [6, 2, 4], dir: d, mat: 'concrete_dark', top: 'metal_grate' });
});
add({ type: 'ramp', pos: [3, 1, -8], size: [6, 2, 4], dir: '+x', rot: 0.5, mat: 'concrete' });
// stairs
dirs.forEach((d, i) => {
  add({ type: 'stairs', pos: [-30 + i * 8, 1.25, 4], size: [6, 2.5, 4.5], dir: d, mat: 'stone_blocks', top: 'stone_tiles' });
});
add({ type: 'stairs', pos: [3, 1.25, 4], size: [6, 2.5, 4.5], dir: '-z', rot: -0.4, mat: 'sandstone' });
// cylinders
add({ type: 'cylinder', pos: [-30, 1, 14], radius: 1, height: 2, sides: 12, mat: 'metal_rust' }); drop(-30, 14, 2, 'cyl');
add({ type: 'cylinder', pos: [-26, 1.5, 14], radius: 1.2, radiusTop: 0, height: 3, sides: 10, mat: 'sandstone' });
add({ type: 'cylinder', pos: [-22, 1, 14], radius: 1.2, radiusTop: 0.6, height: 2, sides: 16, mat: 'container_orange' });
add({ type: 'cylinder', pos: [-18, 1, 14], radius: 1, height: 2, sides: 6, mat: 'concrete' }); drop(-18, 14, 2, 'hex');
add({ type: 'cylinder', pos: [-13, 1, 14], radius: 0.4, height: 6, sides: 12, axis: 'x', mat: 'metal_rust' });
add({ type: 'cylinder', pos: [-8, 1, 14], radius: 0.4, height: 6, sides: 12, axis: 'z', mat: 'metal_dark' });
// pillars, arches
add({ type: 'pillar', pos: [-30, 2.5, 22], radius: 0.7, height: 5, mat: 'marble' });
add({ type: 'pillar', pos: [-26, 2.5, 22], radius: 0.9, height: 5, sides: 14, mat: 'sandstone' });
add({ type: 'arch', pos: [-20, 2.5, 22], size: [6, 5, 1.2], mat: 'stone_blocks' });
add({ type: 'arch', pos: [-12, 2.5, 22], size: [6, 5, 1.2], rot: 0.7, thickness: 1.4, lintel: 1.4, mat: 'sandstone_dark' });
// containers + crates
['red', 'blue', 'green', 'yellow', 'white', 'orange'].forEach((c, i) => add({ type: 'container', pos: [8 + i * 3.2, 1.3, -30], rot: i * 0.2, color: c }));
drop(8, -30, 2.6, 'container');
add({ type: 'crate', pos: [10, 0.6, -22] }); drop(10, -22, 1.2, 'crate');
add({ type: 'crate', pos: [12.5, 0.9, -22], size: [1.8, 1.8, 1.8], rot: 0.4 });
add({ type: 'crate', pos: [15, 0.4, -22], size: [0.8, 0.8, 1.6] });
// catwalks + railings
add({ type: 'catwalk', from: [6, 4, -14], to: [20, 4, -14], width: 2.5, railings: 'both' });
add({ type: 'catwalk', from: [24, 4, -14], to: [24, 4, -2], width: 2.5, railings: 'left' });
add({ type: 'catwalk', from: [28, 4, -2], to: [28, 4, -14], width: 2.5, railings: 'right' });
add({ type: 'catwalk', from: [32, 4, -14], to: [32, 4, -6], width: 2, railings: 'none' });
add({ type: 'railing', from: [6, 0, -10], to: [20, 0, -10] });
add({ type: 'railing', from: [22, 0, -4], to: [30, 0, 4], height: 1.2, mat: 'metal_dark' });
// panels
add({ type: 'panel', pos: [10, 1.5, 12], size: [3, 1.2], mat: 'neon_blue' });
add({ type: 'panel', pos: [14, 1.5, 12], size: [3, 1.2], mat: 'neon_pink', rot: Math.PI / 2 });
add({ type: 'panel', pos: [18, 1.5, 12], size: [3, 1.2], mat: 'light_panel', rot: 2.4 });
add({ type: 'panel', pos: [22, 1.5, 12], size: [3, 1.2], mat: 'glass_window' });
// unknown things to exercise the warnings
add({ type: 'bogus', pos: [0, 0, 0] });
add({ type: 'box', pos: [30, 1, 20], size: [2, 2, 2], mat: 'no_such_material' });
add({ type: 'ramp', pos: [30, 3, 24], size: [4, 6, 4], dir: '+q' });
add({ type: 'box', pos: [NaN, 1, 1], size: [2, 2, 2] });

export default {
  id: 'gallery', name: 'Gallery', subtitle: '', description: '', colors: ['#222', '#444'],
  bounds: { min: [-40, -6, -40], max: [40, 30, 40] }, killY: -20,
  previewCamera: { pos: [0, 50, 60], lookAt: [0, 0, 0] },
  theme: { sky: { clouds: 0.2 }, sun: { dir: [-0.4, 0.8, 0.5], intensity: 2.6 }, hemi: { intensity: 0.7 }, envIntensity: 0.6 },
  solids,
  testDrops: drops,
  lights: [],
  spawns: [{ pos: [0, 0, 30], yaw: 0 }, { pos: [4, 0, 30], yaw: 0 }],
  pickups: [
    { type: 'health', pos: [-4, 0, 30] }, { type: 'armor', pos: [-2, 0, 30] }, { type: 'ammo', pos: [0, 0, 32] },
    { type: 'grenades', pos: [2, 0, 32] }, { type: 'weapon', weapon: 'pistol', pos: [4, 0, 32] }, { type: 'weapon', weapon: 'rifle', pos: [6, 0, 32] },
    { type: 'weapon', weapon: 'nope', pos: [8, 0, 32] }, { type: 'medal', pos: [8, 0, 32] },
  ],
  jumpPads: [{ pos: [0, 0, 20], target: [10, 4, 0], apex: 3 }],
};
