/**
 * VX-3 Slipstream - compact "wind-cut" SMG: short boxy gunmetal receiver with a white charging cover, forward-swept shroud
 * with a three-fin vent muzzle, low reflex sight, vertical fore-grip, forward-raked orange banana magazine with an amber
 * cell window and a skeletal two-rod stock. A six-segment LED bar on the shroud (view model: parts gauge0..gauge5, unique
 * `glowGauge` material) shows the momentum that feeds the weapon's damage bonus.
 */
import { chamferPoly } from './ModelKit.js';
import { addArm } from './Arms.js';
import { gripFrame, pistolGrip, triggerGuard, holoSight, screws } from './parts.js';
import { labelMaterial } from './WeaponMaterials.js';

const BORE = 0.074;
const RAKE = 0.35;
const G = gripFrame(RAKE, [-0.036, 0.0]);
const SIGHT_Y = 0.1295;   // = holoSight cy for baseY 0.1125, h 0.026
const FORE_Z = -0.215;     // fore-grip centre
const SEGMENTS = 6;

export const SMG = {
  id: 'smg',
  hip: [0.15, -0.18, -0.38],
  adsDistance: 0.15,
  sight: [0, SIGHT_Y, -0.03],
  muzzle: [0, BORE, -0.40],
  ejectPort: [0.025, 0.098, -0.03],
};

/**
 * @param {import('./ModelKit.js').ModelBuilder} b
 * @param {boolean} view
 */
export function buildSmg(b, view) {
  const hi = b.hi;
  b.use('body');

  // ---------------------------------------------------------- receiver + charging cover + rail
  const lower = [[-0.10, 0.092], [-0.10, 0.052], [-0.08, 0.030], [0.155, 0.030], [0.16, 0.040], [0.16, 0.092]];
  b.ext('steelDark', chamferPoly(lower, [0.004, 0.004, 0.004, 0.003, 0.003, 0.003]), { width: 0.044, bevel: 0.0024 });
  b.box('steelBlack', [0.048, 0.02, 0.03], [0, 0.058, 0.086], { bevel: 0.002 });                      // rear block (stock hinge)
  b.cube('glowAmber', [0.0012, 0.004, 0.05], [-0.0226, 0.045, -0.02]);                                 // receiver accent line
  b.cube('glowAmber', [0.0012, 0.004, 0.05], [0.0226, 0.045, -0.02]);
  screws(b, [[-0.0222, 0.084, 0.06], [-0.0222, 0.084, -0.09], [-0.0222, 0.04, -0.06], [-0.0222, 0.04, 0.05]], -1);
  b.box('rail', [0.02, 0.007, 0.21], [0, 0.1085, -0.03], { bevel: 0.0014 });
  if (hi) {
    // ejection-port slot and selector
    b.cube('void', [0.0012, 0.012, 0.034], [0.0234, 0.1, -0.03]);
    b.box('steelBlack', [0.006, 0.008, 0.016], [-0.0245, 0.07, 0.03], { bevel: 0.0014 });
    b.box('paintOrange', [0.004, 0.006, 0.01], [-0.0256, 0.07, 0.046], { bevel: 0.001 });
  }

  // top charging cover (part 'slide': kicks back on every shot)
  b.part('slide', [0, 0.098, -0.02], null);
  b.box('paintWhite', [0.046, 0.016, 0.17], [0, 0.098, -0.02], { bevel: 0.0026 });
  b.box('paintOrange', [0.0472, 0.004, 0.02], [0, 0.098, -0.09], { bevel: 0.0012 });
  if (hi) {
    for (let i = 0; i < 3; i++) b.cube('void', [0.0472, 0.0026, 0.004], [0, 0.098, 0.03 + i * 0.016]);
  }
  b.use('body');

  // ---------------------------------------------------------- shroud, barrel, slipstream muzzle
  const shroud = [[0.15, 0.098], [0.15, 0.036], [0.27, 0.046], [0.292, 0.064], [0.292, 0.086], [0.27, 0.098]];
  b.ext('steelDark', chamferPoly(shroud, [0.003, 0.003, 0.003, 0.003, 0.003, 0.003]), { width: 0.036, bevel: 0.0022 });
  const plate = [[0.162, 0.096], [0.162, 0.05], [0.245, 0.055], [0.266, 0.07], [0.266, 0.096]];
  const plateC = chamferPoly(plate, [0.003, 0.003, 0.003, 0.003, 0.003]);
  b.ext('paintWhite', plateC, { width: 0.0016, cx: -0.0188, bevel: 0.0006 });
  b.ext('paintWhite', plateC, { width: 0.0016, cx: 0.0188, bevel: 0.0006 });
  b.cube('glowAmber', [0.0012, 0.003, 0.09], [-0.0203, 0.052, -0.21]);
  b.cube('glowAmber', [0.0012, 0.003, 0.09], [0.0203, 0.052, -0.21]);
  b.decal(labelMaterial('smg-name', 'VX-3  SLIPSTREAM', { w: 320, h: 40, size: 26, color: '#1a1d22', weight: '800', spacing: 2 }), [0.09, 0.0115], [-0.0206, 0.066, -0.214]);
  b.cyl('steel', { r: 0.0095, len: 0.056, pos: [0, BORE, -0.318], seg: 10 });
  b.cyl('steelBlack', { r: 0.0158, len: 0.062, pos: [0, BORE, -0.37], seg: 10 });
  b.cyl('glowAmber', { r: 0.0164, len: 0.004, pos: [0, BORE, -0.342], seg: 10 });
  b.cyl('void', { r: 0.0058, len: 0.001, pos: [0, BORE, -0.4005], seg: 8 });
  for (let i = 0; i < 3; i++) {
    const a = i * (Math.PI * 2 / 3);
    const dx = Math.sin(a), dy = Math.cos(a);
    b.box('steelBlack', [0.0032, 0.0125, hi ? 0.05 : 0.045], [dx * 0.0205, BORE + dy * 0.0205, -0.37], { rot: [0, 0, -a], bevel: 0 });
  }

  // ---------------------------------------------------------- vertical fore-grip (left hand)
  b.box('poly', [0.037, 0.115, 0.045], [0, -0.0215, FORE_Z], { bevel: 0.004 });
  b.box('steelBlack', [0.042, 0.012, 0.05], [0, 0.03, FORE_Z], { bevel: 0.002 });
  b.box('paintOrange', [0.041, 0.008, 0.049], [0, -0.083, FORE_Z], { bevel: 0.002 });
  b.cube('grip', [0.0034, 0.085, 0.032], [-0.0188, -0.02, FORE_Z]);
  b.cube('grip', [0.0034, 0.085, 0.032], [0.0188, -0.02, FORE_Z]);

  // ---------------------------------------------------------- pistol grip, guard, trigger
  pistolGrip(b, G, { t0: -0.07, t1: 0.078, halfDepth: 0.0215, width: 0.032, mat: 'polyGrey' });
  triggerGuard(b, 0.004, 0.056, 0.03, 0.001, 0.0065, 0.008, 'steelDark');
  b.part('trigger', [0, 0.028, -0.032], null);
  b.box('paintOrange', [0.0055, 0.03, 0.0075], [0, 0.0125, -0.0325], { bevel: 0.0014, rot: [0.24, 0, 0] });

  // ---------------------------------------------------------- skeletal two-rod stock
  b.use('body');
  for (const sx of [-1, 1]) {
    b.limb('steelDark', [sx * 0.017, 0.086, 0.1], [sx * 0.017, 0.07, 0.30], 0.0052, 0.0052, { seg: 6 });
  }
  b.box('steelBlack', [0.048, 0.012, 0.014], [0, 0.079, 0.15], { bevel: 0.0016 });
  b.box('rubber', [0.05, 0.09, 0.016], [0, 0.062, 0.31], { bevel: 0.003 });
  b.box('paintOrange', [0.052, 0.008, 0.018], [0, 0.104, 0.31], { bevel: 0.0014 });

  // ---------------------------------------------------------- forward-raked banana magazine
  const magProfile = [[0.066, 0.034], [0.108, 0.034], [0.118, -0.03], [0.14, -0.098], [0.104, -0.1], [0.084, -0.03]];
  b.part('mag', [0, -0.03, -0.09], null);
  b.ext('paintOrange', chamferPoly(magProfile, [0.004, 0.004, 0.004, 0.004, 0.004, 0.004]), { width: 0.027, bevel: 0.0022 });
  b.box('steelBlack', [0.031, 0.008, 0.05], [0, -0.1035, -0.122], { bevel: 0.002, rot: [-0.3, 0, 0] });
  b.cube('glowAmber', [0.0012, 0.05, 0.009], [-0.0141, -0.03, -0.103], { rot: [0.24, 0, 0] });          // cell window
  b.cube('glowAmber', [0.0012, 0.05, 0.009], [0.0141, -0.03, -0.103], { rot: [0.24, 0, 0] });
  if (hi) for (let i = 0; i < 3; i++) b.cube('steelDark', [0.0276, 0.003, 0.034], [0, -0.005 - i * 0.022, -0.093 - i * 0.008], { rot: [0.24, 0, 0] });

  // ---------------------------------------------------------- reflex sight (on the body, not on the cover)
  b.use('body');
  holoSight(b, { baseY: 0.1125, z: -0.03, depth: 0.04, w: 0.034, h: 0.026, accent: 'glowAmber' });

  // ---------------------------------------------------------- momentum gauge on the shroud's left flank
  for (let i = 0; i < SEGMENTS; i++) {
    const z = -0.172 - i * 0.0165;
    b.use('body');
    if (hi) b.cube('void', [0.0014, 0.008, 0.0146], [-0.0199, 0.084, z]);
    b.part('gauge' + i, [-0.0205, 0.084, z], null);
    b.cube(view ? 'glowGauge' : 'glowAmber', [0.0012, 0.006, 0.012], [-0.0206, 0.084, z]);
  }
  b.use('body');

  b.marker('muzzle', SMG.muzzle).marker('sight', SMG.sight).marker('ejectPort', SMG.ejectPort);
  if (view) addSmgArms(b);
}

function addSmgArms(b) {
  // right hand: pistol grip, index finger on the trigger
  addArm(b, {
    side: 'right', origin: [0, -0.028, 0.0], u: [1, 0, 0], v: G.V, t: G.T, hu: 0.0195, hv: 0.0225, rr: 0.006, dir: -1, s0: -0.014, palmLen: 0.078,
    thumb: [[0.012, 0.028, -0.048], [-0.02, 0.016, -0.09], [-0.03, -0.006, -0.108]], thumbUp: [0, 1, 0],
    elbow: [0.34, -0.32, 0.5], armUp: [0.3, 1, 0],
    fingerOverride: { 0: { target: [0.004, 0.0125, -0.0275], bend: [0.008, 0, 0] } },
  });
  // left hand: wrapped around the vertical fore-grip (pole runs down along Y, palm on the rear face)
  addArm(b, {
    side: 'left', origin: [0, -0.025, FORE_Z], u: [-1, 0, 0], v: [0, 0, 1], t: [0, -1, 0], hu: 0.0185, hv: 0.0225, rr: 0.006, dir: -1, s0: -0.016,
    spacing: 0.0185, tShift: 0.006, off: 0.0262, palmLen: 0.07, palmOff: 0.0188,
    thumb: [[0.014, 0.022, -0.022], [0.022, 0.004, -0.04], [0.0245, -0.03, -0.042]], thumbUp: [0, 1, 0.1],
    elbow: [-0.5, -0.3, 0.42], armUp: [-0.4, 1, 0],
  });
}
