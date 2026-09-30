/**
 * P-9 "Viper" - compact near-future service pistol. Polymer frame, angular steel slide with a glowing
 * accent line, acid-green three-dot sights, under-barrel light module.
 */
import { chamferPoly } from './ModelKit.js';
import { addArm } from './Arms.js';
import { labelMaterial } from './WeaponMaterials.js';
import { screws } from './parts.js';

const RAKE = 0.2477; // grip rake (14.2 deg)
const S = Math.sin(RAKE), C = Math.cos(RAKE);
const GRIP_T = [0, -C, S];   // down the grip (towards the heel)
const GRIP_V = [0, S, C];    // out of the back strap
const AX = [0, -0.04, 0.0015]; // grip axis point at palm height
const along = (t, x = 0, v = 0) => [x + GRIP_V[0] * v + GRIP_T[0] * t + AX[0], GRIP_V[1] * v + GRIP_T[1] * t + AX[1], GRIP_V[2] * v + GRIP_T[2] * t + AX[2]];

export const PISTOL = {
  id: 'pistol',
  hip: [0.095, -0.1, -0.3],
  adsDistance: 0.2,
  sight: [0, 0.0835, 0.056],
  muzzle: [0, 0.052, -0.162],
  ejectPort: [0.016, 0.062, -0.004],
};

/**
 * @param {import('./ModelKit.js').ModelBuilder} b
 * @param {boolean} view
 */
export function buildPistol(b, view) {
  const hi = b.hi;

  // ------------------------------------------------ frame (polymer) with trigger-guard hole
  b.use('body');
  const frame = [[0.135, 0.032], [0.135, 0.010], [0.100, 0.003], [0.078, -0.014], [0.066, -0.034], [0.024, -0.034],
    [0.0083, -0.098], [-0.0397, -0.098], [-0.0097, 0.024], [-0.048, 0.030], [-0.066, 0.032]];
  const hole = [[0.076, 0.003], [0.0685, -0.012], [0.057, -0.026], [0.026, -0.026], [0.033, 0.003]];
  b.ext('poly', chamferPoly(frame, [0.006, 0.004, 0.006, 0.006, 0.006, 0, 0.004, 0.004, 0.003, 0.004, 0.004], [5]), { width: 0.028, bevel: 0.0022, holes: [hole] });
  // grip panels (rubber knurl) both sides
  const panel = [[0.0333, 0.012], [0.0072, -0.093], [-0.0367, -0.093], [-0.0107, 0.012]];
  const panelP = chamferPoly(panel, [0.004, 0.005, 0.005, 0.004]);
  b.ext('grip', panelP, { width: 0.0036, cx: -0.0158, bevel: 0.0008 });
  b.ext('grip', panelP, { width: 0.0036, cx: 0.0158, bevel: 0.0008 });
  // accent: dust-cover fang stripe + heel plate
  b.box('paintGreen', [0.0018, 0.005, 0.05], [-0.0146, 0.0175, -0.096], { bevel: 0.0006 });
  b.box('paintGreen', [0.0018, 0.005, 0.05], [0.0146, 0.0175, -0.096], { bevel: 0.0006 });
  // front strap trigger-guard reinforcement
  b.box('steelBlack', [0.014, 0.004, 0.04], [0, -0.0325, -0.046], { bevel: 0.0012 });
  if (hi) {
    // rail slots under the dust cover + light module
    b.box('steelBlack', [0.022, 0.012, 0.03], [0, -0.004, -0.117], { bevel: 0.0022 });
    b.cube('glowCyan', [0.008, 0.005, 0.0008], [0, -0.0035, -0.1327]);
    b.cube('void', [0.0225, 0.0016, 0.0032], [0, -0.0012, -0.104]);
    screws(b, [[-0.014, 0.022, -0.02], [-0.014, 0.016, -0.11], [-0.0176, -0.02, 0.02]], -1, 0.0018);
    // hammer / beavertail detail
    b.box('steelDark', [0.008, 0.008, 0.012], [0, 0.030, 0.062], { bevel: 0.0018 });
    // frame front serial plate
    b.decal(labelMaterial('pistol-serial', 'KA-9  //  SN 00417', { w: 256, h: 40, size: 20, color: '#c9d2da', weight: '600', spacing: 1 }), [0.036, 0.0056], [-0.0142 - 0.0002, 0.0175, -0.014]);
  }

  // ------------------------------------------------ slide
  b.part('slide', [0, 0.05, -0.04], null);
  const slide = chamferPoly([[-0.070, 0.030], [-0.066, 0.061], [-0.056, 0.070], [0.128, 0.070], [0.146, 0.052], [0.146, 0.030]], [0.003, 0.003, 0.004, 0.004, 0.003, 0.003]);
  b.ext('steel', slide, { width: 0.030, bevel: 0.0026 });
  // muzzle tip / barrel + bore
  b.cyl('steel', { r: 0.0072, len: 0.016, pos: [0, 0.052, -0.153], seg: 10 });
  b.cyl('void', { r: 0.0043, len: 0.0008, pos: [0, 0.052, -0.1612], seg: 8 });
  // sides: glow line + name decal
  b.cube('glowGreen', [0.0012, 0.0017, 0.078], [-0.0152, 0.0585, -0.065]);
  b.cube('glowGreen', [0.0012, 0.0017, 0.078], [0.0152, 0.0585, -0.065]);
  b.decal(labelMaterial('pistol-name', 'P-9  VIPER', { w: 256, h: 48, size: 34, color: '#d5dde4', weight: '800', spacing: 3 }), [0.052, 0.0098], [-0.0154, 0.0455, -0.02]);
  // sights: rear posts + front post (tops at y = 0.0835 on the sight line)
  b.cube('steelBlack', [0.0072, 0.0125, 0.008], [-0.0066, 0.0772, 0.056]);
  b.cube('steelBlack', [0.0072, 0.0125, 0.008], [0.0066, 0.0772, 0.056]);
  b.cube('glowGreen', [0.0032, 0.0032, 0.0004], [-0.0066, 0.0785, 0.0517]);
  b.cube('glowGreen', [0.0032, 0.0032, 0.0004], [0.0066, 0.0785, 0.0517]);
  b.cube('steelBlack', [0.0036, 0.0125, 0.0062], [0, 0.0772, -0.118]);
  b.cube('glowGreen', [0.003, 0.003, 0.0004], [0, 0.0785, -0.1149]);
  if (hi) {
    // serrations (rear) and ejection port + chamber window
    for (let i = 0; i < 5; i++) {
      const z = 0.052 - i * 0.0068;
      b.cube('void', [0.0316, 0.0255, 0.0022], [0, 0.049, z - 0.006]);
    }
    b.cube('void', [0.0105, 0.0006, 0.05], [0.0055, 0.0703, -0.03]);
    b.cube('void', [0.0006, 0.014, 0.05], [0.0151, 0.062, -0.03]);
    // fang slots (left)
    b.cube('void', [0.0316, 0.005, 0.0055], [0, 0.0405, -0.097], { rot: [0.55, 0, 0] });
    b.cube('void', [0.0316, 0.005, 0.0055], [0, 0.0405, -0.112], { rot: [0.55, 0, 0] });
    // muzzle compensator ports
    b.box('steelDark', [0.016, 0.012, 0.012], [0, 0.0655, -0.140], { bevel: 0.0022 });
    b.cube('void', [0.0048, 0.0016, 0.0058], [0, 0.0728, -0.140]);
  }

  // ------------------------------------------------------------- trigger
  b.part('trigger', [0, 0.0, -0.052], null);
  b.box('paintGreen', [0.0055, 0.03, 0.0075], [0, -0.0105, -0.0515], { bevel: 0.0014, rot: [0.2, 0, 0] });

  // ------------------------------------------------------------- magazine
  const mc = along(0.004);
  b.part('mag', mc, null);
  b.box('steelDark', [0.025, 0.126, 0.033], mc, { bevel: 0.002, rot: [-RAKE, 0, 0] });
  b.box('paintGreen', [0.034, 0.0075, 0.045], along(0.0685), { bevel: 0.0022, rot: [-RAKE, 0, 0] });
  if (hi) b.cube('glowGreen', [0.0016, 0.006, 0.02], along(0.03, -0.0129), { rot: [-RAKE, 0, 0] });

  b.marker('muzzle', PISTOL.muzzle).marker('sight', PISTOL.sight).marker('ejectPort', PISTOL.ejectPort);

  if (view) addPistolArms(b);
}

function addPistolArms(b) {
  const common = { v: GRIP_V, t: GRIP_T, hu: 0.018, hv: 0.0232, rr: 0.006, dir: -1, s0: -0.016, spacing: 0.0185 };
  addArm(b, {
    ...common, side: 'right', origin: AX, u: [1, 0, 0], palmLen: 0.078,
    thumb: [[0.012, 0.026, -0.040], [-0.022, 0.002, -0.064], [-0.0235, -0.038, -0.066]], thumbUp: [0, 1, 0.1],
    elbow: [0.14, -0.30, 0.50],
    fingerOverride: { 0: { target: [0.006, -0.012, -0.0465], bend: [0.011, 0, -0.002] } },
    armUp: [0.3, 1, 0],
  });
  addArm(b, {
    ...common, side: 'left', origin: [0, AX[1] - 0.0, AX[2]], u: [-1, 0, 0], tShift: 0.026, off: 0.0262, palmLen: 0.07, palmOff: 0.0188,
    thumb: [[0.014, 0.022, -0.022], [0.022, -0.006, -0.040], [0.0245, -0.048, -0.042]], thumbUp: [0, 1, 0.1],
    elbow: [-0.13, -0.28, 0.48],
    armUp: [-0.3, 1, 0],
  });
}
