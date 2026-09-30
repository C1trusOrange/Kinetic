/**
 * Javelin RG-2 - long low-profile rail rifle: white ceramic receiver and fore-end with amber accents, twin steel rails with a
 * cyan plasma channel between them, four glowing accelerator ring frames (part 'rings'), a flared muzzle, a rear fusion
 * cell, a reflex optic and an underslung slug magazine. View model: the ring frames / channel / cell use the view-only
 * glow materials (glowRing / glowChannel / glowCell) that WeaponSystem ramps with the charge and the remaining ammo.
 */
import { chamferPoly, rectProfile } from './ModelKit.js';
import { addArm } from './Arms.js';
import { gripFrame, pistolGrip, triggerGuard, holoSight, screws } from './parts.js';
import { labelMaterial } from './WeaponMaterials.js';

const BORE = 0.115;
const RAKE = 0.34;
const G = gripFrame(RAKE, [-0.02, 0.0]);
const OPTIC_BASE = 0.138;
const OPTIC_H = 0.034;
const OPTIC_Y = OPTIC_BASE + 0.004 + OPTIC_H / 2;   // holoSight reticle height
const RAIL_Z0 = -0.14, RAIL_Z1 = -0.90;

export const RAIL = {
  id: 'rail',
  hip: [0.17, -0.245, -0.55],
  adsDistance: 0.16,
  sight: [0, OPTIC_Y, -0.04],
  muzzle: [0, BORE, -0.968],
  ejectPort: null,
};

/**
 * @param {import('./ModelKit.js').ModelBuilder} b
 * @param {boolean} view
 */
export function buildRail(b, view) {
  const hi = b.hi;
  const ringGlow = view ? 'glowRing' : 'glowAmber';
  const channelGlow = view ? 'glowChannel' : 'glowCyan';
  const cellGlow = view ? 'glowCell' : 'glowCyan';
  b.use('body');

  // ---------------------------------------------------------- receiver (white ceramic) + amber flank strips
  const rec = [[-0.12, 0.13], [-0.12, 0.062], [-0.08, 0.054], [0.14, 0.054], [0.2, 0.062], [0.2, 0.13]];
  b.ext('paintWhite', chamferPoly(rec, [0.006, 0.004, 0.004, 0.004, 0.005, 0.006]), { width: 0.048, bevel: 0.0026 });
  b.box('steelDark', [0.034, 0.02, 0.1], [0, 0.058, -0.02], { bevel: 0.002 });
  b.cube('glowAmber', [0.0012, 0.006, 0.22], [-0.0246, 0.118, -0.03]);
  b.cube('glowAmber', [0.0012, 0.006, 0.22], [0.0246, 0.118, -0.03]);
  b.cube('glowAmber', [0.0012, 0.004, 0.09], [-0.0246, 0.07, 0.02]);
  b.cube('glowAmber', [0.0012, 0.004, 0.09], [0.0246, 0.07, 0.02]);
  b.decal(labelMaterial('rail-name', 'JAVELIN  RG-2', { w: 320, h: 40, size: 26, color: '#1a1d22', weight: '800', spacing: 3 }), [0.1, 0.0125], [-0.0248, 0.088, -0.03]);
  screws(b, [[-0.0242, 0.124, -0.1], [-0.0242, 0.124, 0.09], [-0.0242, 0.07, -0.1], [-0.0242, 0.07, 0.09]], -1);
  b.box('rail', [0.022, 0.008, 0.3], [0, 0.134, -0.06], { bevel: 0.0016 });

  // ---------------------------------------------------------- fore-end + twin rails + plasma channel
  const fore = rectProfile(0.056, 0.064, 0.012, 0, 0.0835);
  b.ext('paintWhite', fore, { axis: 'z', z0: -0.44, z1: -0.12, bevel: 0.0028 });
  b.box('steelDark', [0.05, 0.014, 0.05], [0, 0.109, -0.09], { bevel: 0.002 });
  b.cube('glowAmber', [0.0012, 0.004, 0.2], [-0.0284, 0.078, -0.28]);
  b.cube('glowAmber', [0.0012, 0.004, 0.2], [0.0284, 0.078, -0.28]);
  const railLen = RAIL_Z0 - RAIL_Z1;
  const railZ = (RAIL_Z0 + RAIL_Z1) / 2;
  for (const sx of [-1, 1]) b.box('steelBlack', [0.017, 0.026, railLen], [sx * 0.0165, BORE, railZ], { bevel: 0.0022 });
  b.box('steelDark', [0.05, 0.02, 0.64], [0, 0.098, -0.5 - 0.0], { bevel: 0.0022 });
  b.cube(channelGlow, [0.011, 0.014, 0.76], [0, BORE - 0.0005, railZ - 0.02]);

  // ---------------------------------------------------------- accelerator ring frames (animated glow, tiny jitter while charging)
  b.part('rings', [0, BORE, -0.55], null);
  const S = 0.07, T = 0.009, D = 0.016;
  for (let i = 0; i < 4; i++) {
    const z = -0.3 - i * 0.16;
    b.box('paintWhite', [S, T, D], [0, BORE + S / 2 - T / 2, z], { bevel: 0 });
    b.box('paintWhite', [S, T, D], [0, BORE - S / 2 + T / 2, z], { bevel: 0 });
    b.box('paintWhite', [T, S - 2 * T, D], [-(S / 2 - T / 2), BORE, z], { bevel: 0 });
    b.box('paintWhite', [T, S - 2 * T, D], [S / 2 - T / 2, BORE, z], { bevel: 0 });
    const inner = S - 2 * T;
    b.cube(ringGlow, [inner, 0.0018, D + 0.002], [0, BORE + inner / 2 + 0.0009, z]);
    b.cube(ringGlow, [inner, 0.0018, D + 0.002], [0, BORE - inner / 2 - 0.0009, z]);
    b.cube(ringGlow, [0.0018, inner, D + 0.002], [-inner / 2 - 0.0009, BORE, z]);
    b.cube(ringGlow, [0.0018, inner, D + 0.002], [inner / 2 + 0.0009, BORE, z]);
  }
  b.use('body');

  // ---------------------------------------------------------- flared muzzle
  b.cyl('steelBlack', { r: 0.03, r2: 0.05, len: 0.062, pos: [0, BORE, -0.93], seg: 12 });
  b.cyl('glowCyan', { r: 0.0505, len: 0.004, pos: [0, BORE, -0.9635], seg: 12 });
  b.cyl('void', { r: 0.03, len: 0.001, pos: [0, BORE, -0.9665], seg: 10 });

  // ---------------------------------------------------------- reflex optic
  holoSight(b, { baseY: OPTIC_BASE, z: -0.04, depth: 0.05, w: 0.04, h: OPTIC_H, accent: 'glowAmber' });

  // ---------------------------------------------------------- rear fusion cell + skeletal stock
  b.cyl('steelDark', { r: 0.042, len: 0.12, pos: [0, 0.092, 0.18], seg: 12 });
  b.cyl('steelBlack', { r: 0.0445, len: 0.012, pos: [0, 0.092, 0.126], seg: 12 });
  b.cyl('steelBlack', { r: 0.0445, len: 0.012, pos: [0, 0.092, 0.234], seg: 12 });
  b.cube(cellGlow, [0.0016, 0.036, 0.085], [-0.0409, 0.092, 0.18]);
  b.cube(cellGlow, [0.0016, 0.036, 0.085], [0.0409, 0.092, 0.18]);
  const stock = [[-0.24, 0.13], [-0.30, 0.13], [-0.36, 0.142], [-0.42, 0.134], [-0.43, 0.03], [-0.37, 0.036], [-0.31, 0.05], [-0.24, 0.054]];
  const hole = [[-0.29, 0.11], [-0.35, 0.114], [-0.395, 0.108], [-0.395, 0.07], [-0.34, 0.066], [-0.29, 0.076]];
  b.ext('paintWhite', chamferPoly(stock, [0.004, 0.004, 0.006, 0.005, 0.005, 0.004, 0.005, 0.004]), { width: 0.042, bevel: 0.0028, holes: [hole] });
  b.box('rubber', [0.046, 0.11, 0.016], [0, 0.084, 0.437], { bevel: 0.0022 });
  b.box('paintOrange', [0.048, 0.11, 0.006], [0, 0.084, 0.425], { bevel: 0.0016 });
  b.cube('glowAmber', [0.0012, 0.0035, 0.1], [-0.0214, 0.134, 0.33]);
  b.cube('glowAmber', [0.0012, 0.0035, 0.1], [0.0214, 0.134, 0.33]);

  // ---------------------------------------------------------- pistol grip + trigger
  pistolGrip(b, G, { t0: -0.07, t1: 0.078, halfDepth: 0.0215, width: 0.034, mat: 'polyGrey', panel: 'grip' });
  triggerGuard(b, 0.01, 0.062, 0.056, 0.026, 0.0065, 0.008, 'steelDark');
  b.part('trigger', [0, 0.054, -0.038], null);
  b.box('paintOrange', [0.0055, 0.03, 0.0075], [0, 0.038, -0.038], { bevel: 0.0014, rot: [0.22, 0, 0] });

  // ---------------------------------------------------------- underslung slug magazine
  b.part('mag', [0, 0.05, -0.09], null);
  b.box('steelDark', [0.032, 0.09, 0.064], [0, 0.0, -0.09], { bevel: 0.0024 });
  b.box('paintOrange', [0.036, 0.008, 0.07], [0, -0.049, -0.09], { bevel: 0.002 });
  b.cube('glowAmber', [0.0012, 0.05, 0.008], [-0.0166, 0.0, -0.09]);
  b.cube('glowAmber', [0.0012, 0.05, 0.008], [0.0166, 0.0, -0.09]);
  if (hi) for (let i = 0; i < 3; i++) b.cube('void', [0.0326, 0.003, 0.05], [0, 0.026 - i * 0.022, -0.09]);
  b.use('body');

  b.marker('muzzle', RAIL.muzzle).marker('sight', RAIL.sight);
  if (view) addRailArms(b);
}

function addRailArms(b) {
  addArm(b, {
    side: 'right', origin: [0, -0.024, 0.0], u: [1, 0, 0], v: G.V, t: G.T, hu: 0.02, hv: 0.0225, rr: 0.006, dir: -1, s0: -0.014, palmLen: 0.078,
    thumb: [[0.012, 0.028, -0.048], [-0.02, 0.016, -0.09], [-0.03, -0.006, -0.108]], thumbUp: [0, 1, 0],
    elbow: [0.32, -0.34, 0.5], armUp: [0.3, 1, 0],
    fingerOverride: { 0: { target: [0.004, 0.04, -0.0375], bend: [0.008, 0, 0] } },
  });
  addArm(b, {
    side: 'left', origin: [0, 0.0835, -0.27], u: [1, 0, 0], v: [0, 1, 0], t: [0, 0, 1], hu: 0.028, hv: 0.032, rr: 0.011, dir: 1,
    startUV: [0.01, -0.045], palmLen: 0.07,
    thumb: [[-0.03, -0.018, -0.02], [-0.036, 0.008, -0.058], [-0.036, 0.024, -0.096]], thumbUp: [-1, 0.3, 0],
    elbow: [-0.52, -0.24, 0.42], armUp: [-0.5, 1, 0],
  });
}
