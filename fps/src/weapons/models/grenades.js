/**
 * Special grenade models (~0.1 m, origin at the centre, fuze / top pointing +Y): Vortex, Static, Kinetic Charge and
 * Smoke Screen. Same builder contract as models/grenade.js (the frag), one build function per type.
 */

const TAU = Math.PI * 2;

/** Vortex: a smooth violet orb held in a three-ring gimbal cradle around a dark-violet core. */
export function buildVortex(b) {
  b.use('body');
  b.sphere('paintViolet', 0.034, [0, 0, 0], { ws: 14, hs: 10 });
  // equator glow seam + polar caps
  b.torus('glowViolet', 0.0345, 0.0022, [0, 0, 0], { rot: [Math.PI / 2, 0, 0], ts: 4, rs: 18 });
  b.cyl('steelDark', { r: 0.011, len: 0.008, axis: 'y', pos: [0, 0.0375, 0], seg: 10 });
  b.cyl('steelDark', { r: 0.011, len: 0.008, axis: 'y', pos: [0, -0.0375, 0], seg: 10 });
  b.cyl('glowViolet', { r: 0.005, len: 0.004, axis: 'y', pos: [0, 0.0435, 0], seg: 8 });
  // gimbal rings (three planes)
  b.torus('steel', 0.0455, 0.0028, [0, 0, 0], { rot: [0, 0, 0], ts: 5, rs: 20 });
  b.torus('steelDark', 0.0455, 0.0028, [0, 0, 0], { rot: [Math.PI / 2, 0, 0], ts: 5, rs: 20 });
  b.torus('steel', 0.0455, 0.0028, [0, 0, 0], { rot: [0, Math.PI / 2, 0], ts: 5, rs: 20 });
  // ring nodes
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * TAU;
    b.cube('glowViolet', [0.006, 0.006, 0.006], [Math.cos(a) * 0.0455, Math.sin(a) * 0.0455, 0]);
  }
  // sticky foot pads (it adheres to the first surface it touches)
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * TAU + 0.5;
    b.cyl('rubber', { r: 0.006, len: 0.006, axis: 'y', pos: [Math.cos(a) * 0.022, -0.042, Math.sin(a) * 0.022], seg: 6 });
  }
}

/** Static: a cyan capacitor canister with two contact prongs and a coil band. */
export function buildStatic(b) {
  b.use('body');
  b.cyl('steelBlack', { r: 0.028, len: 0.07, axis: 'y', pos: [0, -0.004, 0], seg: 12 });
  b.cyl('steelDark', { r: 0.031, len: 0.008, axis: 'y', pos: [0, -0.04, 0], seg: 12 });
  b.cyl('steelDark', { r: 0.031, len: 0.008, axis: 'y', pos: [0, 0.032, 0], seg: 12 });
  // glowing capacitor bands
  b.cyl('glowCyan', { r: 0.0288, len: 0.006, axis: 'y', pos: [0, 0.014, 0], seg: 12, cap: false });
  b.cyl('glowCyan', { r: 0.0288, len: 0.006, axis: 'y', pos: [0, -0.024, 0], seg: 12, cap: false });
  b.torus('paintCyan', 0.0295, 0.0024, [0, -0.005, 0], { rot: [Math.PI / 2, 0, 0], ts: 4, rs: 14 });
  // contact prongs + arc gap
  for (const s of [-1, 1]) {
    b.cyl('steel', { r: 0.0042, len: 0.03, axis: 'y', pos: [s * 0.014, 0.05, 0], seg: 6 });
    b.cyl('steelDark', { r: 0.0065, len: 0.006, axis: 'y', pos: [s * 0.014, 0.038, 0], seg: 8 });
    b.cyl('glowCyan', { r: 0.0022, len: 0.004, axis: 'y', pos: [s * 0.014, 0.067, 0], seg: 6 });
  }
  // safety lever
  b.beam('steelDark', [0.026, 0.03, 0], [0.033, 0.0, 0], { w: 0.012, h: 0.0028, up: [1, 0, 0], bevel: 0.0008 });
  b.beam('steelDark', [0.033, 0.0, 0], [0.033, -0.034, 0], { w: 0.012, h: 0.0028, up: [1, 0, 0], bevel: 0.0008 });
}

/** Kinetic Charge: matte graphite capsule with two glowing bands and a shock-plate nose. */
export function buildKinetic(b) {
  b.use('body');
  b.lathe('poly', [[0.0, -0.052], [0.014, -0.05], [0.026, -0.043], [0.031, -0.03], [0.032, 0.0], [0.031, 0.03], [0.026, 0.043], [0.014, 0.05], [0.0, 0.052]], { seg: 12, axis: 'y' });
  // glowing bands
  b.cyl('glowGreen', { r: 0.0328, len: 0.0045, axis: 'y', pos: [0, 0.02, 0], seg: 12, cap: false });
  b.cyl('glowGreen', { r: 0.0328, len: 0.0045, axis: 'y', pos: [0, -0.02, 0], seg: 12, cap: false });
  // rib plates
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU;
    b.cube('steelDark', [0.008, 0.026, 0.004], [Math.cos(a) * 0.0325, 0, Math.sin(a) * 0.0325], { rot: [0, -a, 0] });
  }
  // top cap + fuze and glowing core lens
  b.cyl('steel', { r: 0.013, len: 0.008, axis: 'y', pos: [0, 0.0545, 0], seg: 10 });
  b.cyl('glowGreen', { r: 0.007, len: 0.005, axis: 'y', pos: [0, 0.0605, 0], seg: 8 });
  b.cyl('steelDark', { r: 0.013, len: 0.008, axis: 'y', pos: [0, -0.0545, 0], seg: 10 });
  // safety lever
  b.beam('steelDark', [0, 0.05, 0.012], [0, 0.04, 0.032], { w: 0.014, h: 0.0028, up: [0, 0, 1], bevel: 0.0008 });
  b.beam('steelDark', [0, 0.04, 0.032], [0, -0.03, 0.0335], { w: 0.014, h: 0.0028, up: [0, 0, 1], bevel: 0.0008 });
}

/** Smoke Screen: a grey cylinder with a white band, top vent and pull ring. */
export function buildSmoke(b) {
  b.use('body');
  b.cyl('polyGrey', { r: 0.0285, len: 0.09, axis: 'y', pos: [0, 0, 0], seg: 12 });
  b.cyl('paintWhite', { r: 0.0294, len: 0.02, axis: 'y', pos: [0, 0.008, 0], seg: 12, cap: false });
  b.cyl('steelDark', { r: 0.0305, len: 0.006, axis: 'y', pos: [0, -0.045, 0], seg: 12 });
  b.cyl('steelDark', { r: 0.0305, len: 0.006, axis: 'y', pos: [0, 0.045, 0], seg: 12 });
  // dome with vent slots
  b.cyl('steel', { r: 0.024, r2: 0.014, len: 0.014, axis: 'y', pos: [0, 0.055, 0], seg: 10 });
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * TAU + Math.PI / 4;
    b.cube('void', [0.004, 0.006, 0.01], [Math.cos(a) * 0.0195, 0.055, Math.sin(a) * 0.0195], { rot: [0, -a, 0] });
  }
  b.cyl('glowWhite', { r: 0.005, len: 0.004, axis: 'y', pos: [0, 0.064, 0], seg: 8 });
  // grey lower band + pull ring
  b.cyl('steelBlack', { r: 0.0292, len: 0.008, axis: 'y', pos: [0, -0.024, 0], seg: 12, cap: false });
  b.torus('steel', 0.0085, 0.0016, [0.0085, 0.066, 0.0], { rot: [0, Math.PI / 2, 0], ts: 4, rs: 10 });
  b.beam('steelDark', [0, 0.05, 0.016], [0, 0.03, 0.03], { w: 0.012, h: 0.0026, up: [0, 0, 1], bevel: 0.0008 });
  b.beam('steelDark', [0, 0.03, 0.03], [0, -0.03, 0.0305], { w: 0.012, h: 0.0026, up: [0, 0, 1], bevel: 0.0008 });
}

/** Builders by grenade type id (frag lives in models/grenade.js). */
export const GRENADE_MODEL_BUILDERS = {
  vortex: buildVortex,
  static: buildStatic,
  kinetic: buildKinetic,
  smoke: buildSmoke,
};
