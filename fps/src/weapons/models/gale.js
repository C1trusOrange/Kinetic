/**
 * Gale - short, fat "impact horn": white composite housing, a wide flared funnel muzzle wrapped in three cyan rings,
 * a rear piston sleeve (kicks back on every blast), a pressure dial on top, a side cell magazine and a forward
 * handle bar for the left hand.
 * Animated parts (view model): `slide` (piston sleeve), `ring0..ring2` (funnel glow, lit progressively by
 * WeaponSystem), `rotor` (turbine inside the funnel), `dial` (pressure needle), `trigger`, `mag`.
 */
import { addArm } from './Arms.js';
import { gripFrame, pistolGrip, triggerGuard, screws } from './parts.js';
import { labelMaterial } from './WeaponMaterials.js';

const AX = 0.09;               // bore axis height
const BODY_R = 0.062;
const RAKE = 0.3;
const G = gripFrame(RAKE, [-0.02, 0.0]);
const FUN_Z = -0.255;          // funnel neck z (the funnel grows toward -Z)
const FUN_LEN = 0.245;
const BAR_Z = -0.285;          // forward handle bar
const BAR_Y = 0.0;

export const GALE = {
  id: 'gale',
  hip: [0.16, -0.215, -0.46],
  // Aim point = the top of the front blade, on the sight line y = 0.2 (level with the rear notch post tops); the marker
  // sits on it, 0.365 m from the eye at ADS (same eye position as the rear notch at 0.19 m).
  adsDistance: 0.365,
  sight: [0, 0.2, -0.225],
  muzzle: [0, AX, -0.5],
  ejectPort: null,
};

/** Outer funnel radius at distance `a` from the neck (piecewise linear through the profile below). */
const FUNNEL = [[0.05, 0], [0.056, 0.03], [0.066, 0.1], [0.076, 0.19], [0.079, FUN_LEN]];
function funnelR(a) {
  for (let i = 1; i < FUNNEL.length; i++) {
    if (a <= FUNNEL[i][1]) {
      const [r0, a0] = FUNNEL[i - 1], [r1, a1] = FUNNEL[i];
      return r0 + (r1 - r0) * (a - a0) / (a1 - a0);
    }
  }
  return FUNNEL[FUNNEL.length - 1][0];
}

/**
 * @param {import('./ModelKit.js').ModelBuilder} b
 * @param {boolean} view
 */
export function buildGale(b, view) {
  const hi = b.hi;
  const SEG = hi ? 12 : 8;      // funnel / housing tessellation (world models are lighter)
  b.use('body');

  // ---------------------------------------------------------- main housing + bands
  b.cyl('ceramic', { r: BODY_R, len: 0.26, pos: [0, AX, -0.11], seg: SEG });
  for (const z of [-0.02, -0.2]) b.cyl('steelDark', { r: BODY_R + 0.003, len: 0.016, pos: [0, AX, z], seg: SEG });
  b.cyl('steelBlack', { r: 0.058, len: 0.03, pos: [0, AX, FUN_Z + 0.005], seg: SEG });
  b.decal(labelMaterial('gale-name', 'GALE', { w: 256, h: 64, size: 50, color: '#24333f', weight: '900', spacing: 8, opacity: 0.95 }),
    [0.1, 0.03], [-BODY_R - 0.0004, AX + 0.004, -0.1], { face: 'left' });
  b.decal(labelMaterial('gale-warn', 'STAND CLEAR', { w: 256, h: 32, size: 20, color: '#c8951e', weight: '800', spacing: 3, opacity: 0.9 }),
    [0.09, 0.011], [-BODY_R - 0.0004, AX - 0.03, -0.1], { face: 'left' });
  // cyan accent strips on the flanks
  b.cube('glowCyan', [0.0012, 0.0034, 0.1], [-BODY_R - 0.0004, AX + 0.036, -0.1]);
  b.cube('glowCyan', [0.0012, 0.0034, 0.1], [BODY_R + 0.0004, AX + 0.036, -0.1]);

  // ---------------------------------------------------------- funnel (outer shell, hazard lip, inner bore)
  b.lathe('ceramic', FUNNEL.map(p => [p[0], p[1]]), { seg: SEG, axis: 'z', pos: [0, AX, FUN_Z] });
  b.lathe('hazard', [[funnelR(FUN_LEN - 0.03) + 0.0016, FUN_LEN - 0.03], [funnelR(FUN_LEN - 0.001) + 0.0016, FUN_LEN - 0.001]], { seg: SEG, axis: 'z', pos: [0, AX, FUN_Z] });
  b.lathe('steelDark', [[0.0665, 0.001], [0.0812, 0.001]], { seg: SEG, axis: 'z', pos: [0, AX, FUN_Z - FUN_LEN] });                 // lip face
  // inner bore: reversed profile so the faces look into the funnel
  b.lathe('steelBlack', [[0.0715, FUN_LEN - 0.004], [0.068, 0.19], [0.058, 0.1], [0.048, 0.03], [0.042, 0.0]], { seg: SEG, axis: 'z', pos: [0, AX, FUN_Z] });
  // three stacked cyan rings on the outside of the funnel (parts ring0..ring2: lit progressively while firing)
  [0.105, 0.165, 0.222].forEach((a, i) => {
    b.part('ring' + i, [0, AX, FUN_Z - a], null);
    b.lathe('glowCyan', [[funnelR(a - 0.0045) + 0.0016, a - 0.0045], [funnelR(a + 0.0045) + 0.0016, a + 0.0045]], { seg: SEG, axis: 'z', pos: [0, AX, FUN_Z] });
  });
  // turbine rotor inside the funnel (part rotor, spins around the bore)
  if (hi) b.part('rotor', [0, AX, FUN_Z - 0.05], null);
  if (hi) b.cyl('glowCyan', { r: 0.013, len: 0.012, pos: [0, AX, FUN_Z - 0.05], seg: 8 });
  for (let k = 0; hi && k < 3; k++) {
    const a = k * Math.PI * 2 / 3;
    b.beam('steelDark', [Math.cos(a) * 0.012, AX + Math.sin(a) * 0.012, FUN_Z - 0.05], [Math.cos(a) * 0.052, AX + Math.sin(a) * 0.052, FUN_Z - 0.05],
      { w: 0.011, h: 0.004, up: [0, 0, 1], bevel: 0.0008 });
  }
  b.use('body');

  // ---------------------------------------------------------- rear piston sleeve (slide) + shoulder brace
  b.part('slide', [0, AX, 0.1], null);
  b.cyl('steelDark', { r: 0.05, len: 0.11, pos: [0, AX, 0.078], seg: SEG });
  b.cyl('hazard', { r: 0.0506, len: 0.022, pos: [0, AX, 0.05], seg: SEG });
  b.cyl('glowCyan', { r: 0.0514, len: 0.005, pos: [0, AX, 0.104], seg: SEG, cap: false });
  b.cyl('steelBlack', { r: 0.044, len: 0.008, pos: [0, AX, 0.13], seg: SEG });
  b.use('body');
  b.box('rubber', [0.05, 0.085, 0.024], [0, AX - 0.005, 0.195], { bevel: 0.005 });
  b.box('steelDark', [0.04, 0.06, 0.01], [0, AX - 0.005, 0.18], { bevel: 0.002 });
  for (const sx of [-1, 1]) b.box('steelDark', [0.01, 0.022, 0.16], [sx * 0.04, AX - 0.03, 0.1], { bevel: 0.002 });   // brace struts

  // ---------------------------------------------------------- pressure dial (top) + notch sights
  b.cyl('polyGrey', { r: 0.025, len: 0.014, axis: 'y', pos: [0, AX + BODY_R + 0.004, 0.03], seg: SEG });
  b.cyl('steelBlack', { r: 0.02, len: 0.002, axis: 'y', pos: [0, AX + BODY_R + 0.0115, 0.03], seg: SEG });
  for (let i = 0; hi && i < 5; i++) {
    const a = -1.0 + i * 0.5;
    b.cube('glowCyan', [0.0035, 0.0016, 0.007], [Math.sin(a) * 0.017, AX + BODY_R + 0.0128, 0.03 - Math.cos(a) * 0.017 + 0.007], { rot: [0, a, 0] });
  }
  b.part('dial', [0, AX + BODY_R + 0.0132, 0.03], null);
  b.box('glowCyan', [0.0034, 0.0016, 0.02], [0, AX + BODY_R + 0.0132, 0.03 - 0.009], { bevel: 0 });
  b.use('body');
  // rear notch posts + front blade (the sight line at y = 0.2 clears the dial and the funnel): all three tops sit on
  // the sight line, each with a thin glowing tip seated on it (the front tip marks the aim point)
  for (const sx of [-1, 1]) {
    b.box('steelBlack', [0.004, 0.028, 0.008], [sx * 0.0125, 0.186, -0.05], { bevel: 0.0008 });
    b.cube('glowCyan', [0.004, 0.0014, 0.004], [sx * 0.0125, 0.2007, -0.05]);
  }
  b.box('steelBlack', [0.024, 0.024, 0.03], [0, 0.166, -0.05], { bevel: 0.002 });
  b.box('steelBlack', [0.008, 0.05, 0.012], [0, 0.175, -0.225], { bevel: 0.0012 });
  b.cube('glowCyan', [0.004, 0.0014, 0.004], [0, 0.2007, -0.225]);
  if (hi) {
    for (let i = 0; i < 4; i++) b.cube('void', [0.02, 0.0012, 0.008], [0, AX + BODY_R + 0.0006, -0.09 - i * 0.02 + 0.0]);
    screws(b, [[-BODY_R + 0.001, AX + 0.03, 0.0], [-BODY_R + 0.001, AX - 0.03, 0.0]], -1);
  }

  // ---------------------------------------------------------- pistol grip, guard, trigger
  b.box('steelBlack', [0.044, 0.04, 0.14], [0, 0.049, 0.0], { bevel: 0.003 });
  pistolGrip(b, G, { t0: -0.065, t1: 0.075, halfDepth: 0.0215, width: 0.034, mat: 'poly', panel: 'grip' });
  triggerGuard(b, 0.012, 0.064, 0.036, 0.008, 0.0065, 0.008, 'steelDark');
  b.part('trigger', [0, 0.034, -0.038], null);
  b.box('paintCyan', [0.0055, 0.03, 0.0075], [0, 0.02, -0.038], { bevel: 0.0014, rot: [0.22, 0, 0] });

  // ---------------------------------------------------------- forward handle bar (left hand wraps across X)
  b.use('body');
  b.box('steelBlack', [0.026, 0.05, 0.034], [0, 0.03, BAR_Z], { bevel: 0.003 });
  b.cyl('grip', { r: 0.0165, len: 0.13, axis: 'x', pos: [0, BAR_Y, BAR_Z], seg: 10 });
  for (const sx of [-1, 1]) b.cyl('steelDark', { r: 0.0195, len: 0.012, axis: 'x', pos: [sx * 0.07, BAR_Y, BAR_Z], seg: 10 });
  b.cube('glowCyan', [0.003, 0.003, 0.003], [0.078, BAR_Y, BAR_Z]);

  // ---------------------------------------------------------- energy cell (side-loaded, slides down on reload)
  b.part('mag', [0, 0.02, -0.11], null);
  b.cyl('steelDark', { r: 0.03, len: 0.026, axis: 'y', pos: [0, 0.022, -0.11], seg: 10 });
  b.cyl('cellBody', { r: 0.0255, len: 0.1, axis: 'y', pos: [0, -0.03, -0.11], seg: 10 });
  b.cyl('paintCyan', { r: 0.028, len: 0.012, axis: 'y', pos: [0, -0.086, -0.11], seg: 10 });
  b.use('body');

  b.marker('muzzle', GALE.muzzle).marker('sight', GALE.sight);
  if (view) addGaleArms(b);
}

function addGaleArms(b) {
  addArm(b, {
    side: 'right', origin: [0, -0.024, 0.0], u: [1, 0, 0], v: G.V, t: G.T, hu: 0.02, hv: 0.0225, rr: 0.006, dir: -1, s0: -0.014, palmLen: 0.078,
    thumb: [[0.012, 0.028, -0.048], [-0.02, 0.016, -0.09], [-0.03, -0.006, -0.108]], thumbUp: [0, 1, 0],
    elbow: [0.32, -0.34, 0.5], armUp: [0.3, 1, 0],
    fingerOverride: { 0: { target: [0.004, 0.022, -0.0335], bend: [0.008, 0, 0] } },
  });
  // left hand: overhand grip on the horizontal bar (pole runs along -X, cross-section in the (Y, Z) plane)
  addArm(b, {
    side: 'left', origin: [-0.02, BAR_Y, BAR_Z], u: [0, 1, 0], v: [0, 0, 1], t: [-1, 0, 0], hu: 0.0165, hv: 0.0165, rr: 0.0165, dir: -1, s0: 0.0, palmLen: 0.07,
    thumb: [[0.0, 0.026, 0.0], [0.0, 0.03, -0.03], [0.0, 0.018, -0.05]], thumbUp: [0, 1, 0],
    elbow: [-0.5, -0.24, 0.42], armUp: [-0.4, 1, 0],
  });
}
