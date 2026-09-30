/**
 * Longbow - long-range bolt-action rail rifle: sand composite furniture, fluted heavy barrel with a triple-baffle
 * brake, big variable scope with violet-coated glass, side bolt with a glowing knob.
 */
import { chamferPoly, rectProfile } from './ModelKit.js';
import { addArm } from './Arms.js';
import { gripFrame, pistolGrip, triggerGuard, screws } from './parts.js';
import { labelMaterial } from './WeaponMaterials.js';

const BORE = 0.10;
const RAKE = 0.34;
const G = gripFrame(RAKE, [-0.02, 0.0]);
const SCOPE_Y = 0.176;
const SCOPE_Z0 = -0.14;   // objective end (front)
const SCOPE_Z1 = 0.115;   // ocular end (rear)

export const SNIPER = {
  id: 'sniper',
  hip: [0.17, -0.245, -0.52],
  adsDistance: 0.11,
  sight: [0, SCOPE_Y, SCOPE_Z1 + 0.04],
  muzzle: [0, BORE, -0.87],
  ejectPort: [0.026, 0.108, 0.0],
};

/**
 * @param {import('./ModelKit.js').ModelBuilder} b
 * @param {boolean} view
 */
export function buildSniper(b, view) {
  const hi = b.hi;
  b.use('body');

  // ---------------------------------------------------------- receiver
  const rec = [[-0.10, 0.132], [-0.10, 0.062], [-0.06, 0.054], [0.14, 0.054], [0.22, 0.062], [0.22, 0.132]];
  b.ext('steelBlack', chamferPoly(rec, [0.005, 0.004, 0.004, 0.004, 0.004, 0.005]), { width: 0.048, bevel: 0.0024 });
  b.box('rail', [0.024, 0.008, 0.36], [0, 0.136, -0.05], { bevel: 0.0016 });
  b.cube('void', [0.0012, 0.02, 0.09], [0.0246, 0.108, 0.0]);
  b.box('paintTan', [0.0016, 0.03, 0.12], [-0.0248, 0.098, -0.12], { bevel: 0.0006 });
  b.decal(labelMaterial('sn-name', 'LONGBOW  //  .338 EM', { w: 384, h: 40, size: 26, color: '#ded6c2', weight: '700', spacing: 3 }), [0.1, 0.0105], [-0.0257, 0.098, -0.12]);
  b.cube('glowViolet', [0.0012, 0.0035, 0.06], [-0.0251, 0.126, -0.03]);
  screws(b, [[-0.024, 0.126, -0.09], [-0.024, 0.126, 0.08], [-0.024, 0.07, -0.09], [-0.024, 0.07, 0.08]], -1);

  // ---------------------------------------------------------- fore-end, barrel, brake, bipod
  const fore = rectProfile(0.056, 0.064, 0.012, 0, 0.0835);
  b.ext('polyTan', fore, { axis: 'z', z0: -0.42, z1: -0.10, bevel: 0.0028 });
  b.box('polyTan', [0.052, 0.014, 0.05], [0, 0.109, -0.075], { bevel: 0.002 });
  b.cube('glowViolet', [0.0012, 0.004, 0.2], [-0.0284, 0.09, -0.26]);
  b.cube('glowViolet', [0.0012, 0.004, 0.2], [0.0284, 0.09, -0.26]);
  b.cyl('steel', { r: 0.0142, len: 0.5, pos: [0, BORE, -0.6], seg: 12 });
  b.cyl('steelDark', { r: 0.0198, len: 0.13, pos: [0, BORE, -0.485], seg: 12 });
  if (hi) {
    for (let i = 0; i < 5; i++) b.cube('void', [0.0012, 0.008, 0.016], [-0.0199, BORE, -0.43 - i * 0.022], {});
    for (let i = 0; i < 3; i++) b.cyl('steelBlack', { r: 0.0165, len: 0.008, pos: [0, BORE, -0.62 - i * 0.05], seg: 10 });
  }
  // muzzle brake: main body with side ports and glow ring
  b.cyl('steelBlack', { r: 0.0235, len: 0.09, pos: [0, BORE, -0.825], seg: 12 });
  b.cyl('glowViolet', { r: 0.0242, len: 0.005, pos: [0, BORE, -0.792], seg: 12 });
  b.cyl('void', { r: 0.009, len: 0.001, pos: [0, BORE, -0.8705], seg: 8 });
  if (hi) {
    for (let i = 0; i < 3; i++) {
      b.cube('void', [0.0512, 0.011, 0.0085], [0, BORE, -0.808 - i * 0.02]);
      b.cube('void', [0.011, 0.0512, 0.0085], [0, BORE, -0.808 - i * 0.02]);
    }
  } else {
    b.cube('void', [0.0512, 0.011, 0.03], [0, BORE, -0.825]);
  }
  // folded bipod
  b.box('steelDark', [0.036, 0.012, 0.024], [0, 0.041, -0.38], { bevel: 0.0022 });
  if (hi) {
    b.box('steelBlack', [0.006, 0.01, 0.2], [-0.02, 0.034, -0.29], { bevel: 0.0012, rot: [0, 0, 0] });
    b.box('steelBlack', [0.006, 0.01, 0.2], [0.02, 0.034, -0.29], { bevel: 0.0012 });
    b.cube('rubber', [0.008, 0.012, 0.03], [-0.02, 0.034, -0.4]);
    b.cube('rubber', [0.008, 0.012, 0.03], [0.02, 0.034, -0.4]);
  }

  // ---------------------------------------------------------- scope
  const sz = (SCOPE_Z0 + SCOPE_Z1) / 2;
  // mounts
  for (const z of [-0.09, 0.04]) {
    b.box('steelBlack', [0.034, 0.02, 0.022], [0, 0.148, z], { bevel: 0.002 });
    b.cyl('steelBlack', { r: 0.0205, len: 0.014, pos: [0, SCOPE_Y, z], seg: 12 });
  }
  b.cyl('steelBlack', { r: 0.0166, len: SCOPE_Z1 - SCOPE_Z0, pos: [0, SCOPE_Y, sz], seg: 12 });
  // objective bell (front) and ocular bell (rear)
  b.cyl('steelBlack', { r: 0.0166, r2: 0.0262, len: 0.06, pos: [0, SCOPE_Y, SCOPE_Z0 - 0.03], seg: 12 });
  b.cyl('lensDark', { r: 0.0234, len: 0.002, pos: [0, SCOPE_Y, SCOPE_Z0 - 0.0605], seg: 12 });
  b.cyl('glowViolet', { r: 0.0264, len: 0.004, pos: [0, SCOPE_Y, SCOPE_Z0 - 0.056], seg: 12 });
  b.cyl('steelBlack', { r: 0.0225, r2: 0.0166, len: 0.04, pos: [0, SCOPE_Y, SCOPE_Z1 + 0.02], seg: 12 });
  b.cyl('lensDark', { r: 0.0182, len: 0.0016, pos: [0, SCOPE_Y, SCOPE_Z1 + 0.0395], seg: 12 });
  b.cyl('glowViolet', { r: 0.0229, len: 0.0035, pos: [0, SCOPE_Y, SCOPE_Z1 + 0.036], seg: 12 });
  // turrets
  b.cyl('steelDark', { r: 0.0088, len: 0.016, axis: 'y', pos: [0, SCOPE_Y + 0.0225, -0.025], seg: 10 });
  b.cyl('steelDark', { r: 0.0088, len: 0.016, axis: 'x', pos: [0.0225, SCOPE_Y, -0.025], seg: 10 });
  b.cyl('steelDark', { r: 0.0072, len: 0.014, axis: 'x', pos: [-0.0215, SCOPE_Y, -0.025], seg: 10 });
  b.cyl('paintViolet', { r: 0.0091, len: 0.004, axis: 'y', pos: [0, SCOPE_Y + 0.0315, -0.025], seg: 10 });
  b.decal(labelMaterial('sn-scope', 'LB-8x  ZOOM', { w: 256, h: 32, size: 22, color: '#cfd6e6', weight: '700', spacing: 2 }), [0.06, 0.0075], [-0.0169, SCOPE_Y, -0.05], { face: 'left' });

  // ---------------------------------------------------------- pistol grip + trigger
  pistolGrip(b, G, { t0: -0.07, t1: 0.078, halfDepth: 0.0215, width: 0.034, mat: 'polyTan', panel: 'grip' });
  triggerGuard(b, 0.01, 0.062, 0.056, 0.026, 0.0065, 0.008, 'steelDark');
  b.part('trigger', [0, 0.054, -0.038], null);
  b.box('paintViolet', [0.0055, 0.03, 0.0075], [0, 0.038, -0.038], { bevel: 0.0014, rot: [0.22, 0, 0] });

  // ---------------------------------------------------------- stock (skeletal thumbhole with cheek riser)
  b.use('body');
  const stock = [[-0.10, 0.128], [-0.2, 0.128], [-0.25, 0.146], [-0.335, 0.146], [-0.40, 0.138], [-0.41, 0.03], [-0.34, 0.036], [-0.27, 0.05], [-0.2, 0.052], [-0.1, 0.062]];
  const hole = [[-0.15, 0.108], [-0.23, 0.11], [-0.30, 0.104], [-0.3, 0.078], [-0.23, 0.076], [-0.155, 0.083]];
  b.ext('polyTan', chamferPoly(stock, [0.004, 0.004, 0.006, 0.005, 0.005, 0.004, 0.006, 0.004, 0.004, 0.004]), { width: 0.046, bevel: 0.0028, holes: [hole] });
  b.box('grip', [0.044, 0.108, 0.014], [0, 0.084, 0.415], { bevel: 0.0022 });
  b.box('paintViolet', [0.046, 0.108, 0.006], [0, 0.084, 0.4], { bevel: 0.0016 });
  b.cube('glowViolet', [0.0012, 0.0035, 0.1], [-0.0234, 0.138, 0.3]);
  b.cube('glowViolet', [0.0012, 0.0035, 0.1], [0.0234, 0.138, 0.3]);

  // ---------------------------------------------------------- magazine
  b.part('mag', [0, 0.05, -0.09], null);
  b.box('steelDark', [0.032, 0.09, 0.064], [0, 0.0, -0.09], { bevel: 0.0024 });
  b.box('paintViolet', [0.036, 0.008, 0.07], [0, -0.049, -0.09], { bevel: 0.002 });
  if (hi) for (let i = 0; i < 3; i++) b.cube('void', [0.0326, 0.003, 0.05], [0, 0.026 - i * 0.022, -0.09]);

  // ---------------------------------------------------------- bolt (pivot on the bore axis at the back of the receiver)
  b.part('bolt', [0, BORE, 0.02], null);
  b.cyl('steelDark', { r: 0.0118, len: 0.09, pos: [0, BORE, 0.075], seg: 10 });
  b.cyl('steelBlack', { r: 0.0148, len: 0.02, pos: [0, BORE, 0.126], seg: 10 });
  // handle on the LEFT side (the side the player sees): rotating the bolt part about Z by a negative angle lifts it
  b.limb('steelDark', [-0.008, BORE - 0.002, 0.03], [-0.058, BORE - 0.018, 0.038], 0.0068, 0.0068, { seg: 6 });
  b.sphere('paintViolet', 0.0125, [-0.066, BORE - 0.022, 0.04], { ws: 8, hs: 6 });
  if (hi) b.torus('glowViolet', 0.011, 0.0022, [-0.066, BORE - 0.022, 0.04], { rot: [0, Math.PI / 2 + 0.3, 0], ts: 4, rs: 10 });

  b.marker('muzzle', SNIPER.muzzle).marker('sight', SNIPER.sight).marker('ejectPort', SNIPER.ejectPort);
  if (view) addSniperArms(b);
}

function addSniperArms(b) {
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
