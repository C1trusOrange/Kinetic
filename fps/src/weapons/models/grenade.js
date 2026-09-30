/**
 * Frag grenade model (~0.1 m, origin at the centre, fuze pointing +Y).
 */

/**
 * @param {import('./ModelKit.js').ModelBuilder} b
 */
export function buildGrenade(b) {
  b.use('body');
  // segmented body (lathe about Y)
  b.lathe('frag', [[0.0, -0.046], [0.02, -0.0445], [0.0325, -0.036], [0.0385, -0.018], [0.0395, 0.004], [0.0365, 0.024], [0.028, 0.038], [0.0165, 0.0445], [0.0, 0.0455]], { seg: 12, axis: 'y' });
  // glowing arming band
  b.cyl('glowOrange', { r: 0.0402, len: 0.0045, axis: 'y', pos: [0, -0.0075, 0], seg: 12, cap: false });
  // fuze assembly
  b.cyl('steelDark', { r: 0.0185, len: 0.007, axis: 'y', pos: [0, 0.0455, 0], seg: 10 });
  b.cyl('steel', { r: 0.0125, len: 0.016, axis: 'y', pos: [0, 0.0555, 0], seg: 10 });
  b.cyl('steelBlack', { r: 0.0095, len: 0.006, axis: 'y', pos: [0, 0.066, 0], seg: 8 });
  b.cube('glowGreen', [0.0045, 0.002, 0.0045], [0, 0.0695, 0]);
  // safety lever (spoon) hugging the body on the +Z side
  b.beam('steelDark', [0, 0.056, 0.0125], [0, 0.048, 0.034], { w: 0.014, h: 0.0028, up: [0, 0, 1], bevel: 0.0008 });
  b.beam('steelDark', [0, 0.048, 0.034], [0, 0.022, 0.0435], { w: 0.014, h: 0.0028, up: [0, 0, 1], bevel: 0.0008 });
  b.beam('steelDark', [0, 0.022, 0.0435], [0, -0.024, 0.0425], { w: 0.014, h: 0.0028, up: [0, 0, 1], bevel: 0.0008 });
  // pull ring + pin
  b.torus('steel', 0.0088, 0.0016, [0.0085, 0.062, 0.0], { rot: [0, Math.PI / 2, 0], ts: 4, rs: 10 });
  b.cyl('steel', { r: 0.0013, len: 0.024, axis: 'x', pos: [-0.0005, 0.0555, 0], seg: 5 });
}
