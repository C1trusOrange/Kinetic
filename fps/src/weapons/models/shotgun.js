/**
 * Breacher 12 - pump-action riot shotgun: walnut stock and pump, steel receiver with orange accent panels
 * and a glowing shell counter, heat-shielded barrel and a toothed breaching crown.
 */
import { chamferPoly } from './ModelKit.js';
import { addArm } from './Arms.js';
import { gripFrame, pistolGrip, triggerGuard, screws } from './parts.js';
import { labelMaterial } from './WeaponMaterials.js';

const BORE = 0.095;
const MAG_Y = 0.062;
const RAKE = 0.30;
const G = gripFrame(RAKE, [-0.03, 0.0]);
const SIGHT_Y = 0.131;

export const SHOTGUN = {
  id: 'shotgun',
  hip: [0.14, -0.19, -0.4],
  adsDistance: 0.17,
  sight: [0, SIGHT_Y, 0.05],
  muzzle: [0, BORE, -0.64],
  ejectPort: [0.024, 0.098, -0.02],
};

/**
 * @param {import('./ModelKit.js').ModelBuilder} b
 * @param {boolean} view
 */
export function buildShotgun(b, view) {
  const hi = b.hi;
  b.use('body');

  // ---------------------------------------------------------- receiver
  const rec = [[-0.09, 0.112], [-0.09, 0.056], [-0.05, 0.046], [0.10, 0.046], [0.16, 0.05], [0.16, 0.118], [-0.03, 0.118]];
  b.ext('steel', chamferPoly(rec, [0.005, 0.004, 0.004, 0.003, 0.004, 0.006, 0.006]), { width: 0.044, bevel: 0.0024 });
  // accent panels on the receiver flanks (painted, chipped) + top spine
  b.box('paintOrange', [0.0016, 0.036, 0.13], [-0.0228, 0.088, 0.0], { bevel: 0.0006 });
  b.box('paintOrange', [0.0016, 0.036, 0.13], [0.0228, 0.088, 0.0], { bevel: 0.0006 });
  b.box('steelBlack', [0.026, 0.006, 0.20], [0, 0.119, -0.005], { bevel: 0.0018 });
  // shell counter LEDs (left + right)
  for (let i = 0; i < 6; i++) {
    b.cube('glowOrange', [0.0012, 0.006, 0.0075], [-0.0242, 0.1, 0.05 - i * 0.0125]);
    b.cube('glowOrange', [0.0012, 0.006, 0.0075], [0.0242, 0.1, 0.05 - i * 0.0125]);
  }
  b.decal(labelMaterial('sg-name', 'BREACHER 12', { w: 256, h: 40, size: 28, color: '#141414', weight: '800', spacing: 3 }), [0.075, 0.0125], [-0.0238, 0.072, -0.03]);
  screws(b, [[-0.022, 0.108, -0.075], [-0.022, 0.108, 0.075], [-0.022, 0.058, -0.075], [-0.022, 0.058, 0.075]], -1);
  if (hi) {
    // ejection port (right) + loading gate + slide release
    b.cube('void', [0.0012, 0.016, 0.05], [0.0224, 0.104, -0.02]);
    b.cube('void', [0.0446, 0.0016, 0.05], [0, 0.0462, -0.06]);
    b.box('steelBlack', [0.006, 0.01, 0.018], [-0.0245, 0.058, -0.09 + 0.16 * 0.5], { bevel: 0.0014 });
    b.box('paintOrange', [0.008, 0.005, 0.008], [0, 0.1235, 0.0], { bevel: 0.0012 });
    b.decal(labelMaterial('sg-cal', '12 GA  //  3"', { w: 128, h: 32, size: 20, color: '#dfe3e8', weight: '700', spacing: 2 }), [0.034, 0.0085], [-0.0238, 0.048, -0.04]);
  }

  // ---------------------------------------------------------- barrel, tube, shield, sights
  b.cyl('steel', { r: 0.0125, len: 0.5, pos: [0, BORE, -0.36], seg: 10 });
  b.cyl('steelDark', { r: 0.0125, len: 0.34, pos: [0, MAG_Y, -0.31], seg: 10 });
  b.cyl('paintOrange', { r: 0.0158, len: 0.022, pos: [0, MAG_Y, -0.487], seg: 10 });
  // barrel clamp / bridge
  b.box('steelBlack', [0.032, 0.05, 0.016], [0, (BORE + MAG_Y) / 2, -0.43], { bevel: 0.0022 });
  // heat shield with vent slots
  b.box('steelBlack', [0.032, 0.006, 0.3], [0, BORE + 0.0135, -0.31], { bevel: 0.0022 });
  if (hi) {
    for (let i = 0; i < 9; i++) b.cube('void', [0.0203, 0.0012, 0.0085], [0, BORE + 0.0168, -0.19 - i * 0.03]);
  }
  // crown with breaching teeth
  b.cyl('steelBlack', { r: 0.0178, len: 0.034, pos: [0, BORE, -0.623], seg: 10 });
  b.cyl('void', { r: 0.0098, len: 0.001, pos: [0, BORE, -0.6405], seg: 10 });
  for (let i = 0; i < 6; i++) {
    const a = i / 6 * Math.PI * 2;
    b.cube('paintOrange', [0.0052, 0.0052, 0.012], [Math.cos(a) * 0.0186, BORE + Math.sin(a) * 0.0186, -0.6375]);
  }
  // front bead sight
  b.box('steelBlack', [0.0046, 0.02, 0.007], [0, 0.1177, -0.588], { bevel: 0.0008 });
  b.sphere('glowOrange', 0.0033, [0, 0.1277, -0.588], { ws: 6, hs: 4 });
  // rear ghost-ring
  b.box('steelBlack', [0.016, 0.0064, 0.014], [0, 0.1205, 0.05], { bevel: 0.0014 });
  b.torus('steelBlack', 0.0072, 0.002, [0, SIGHT_Y, 0.05], { ts: 4, rs: 10 });
  b.box('steelBlack', [0.0052, 0.008, 0.008], [-0.0082, 0.1235, 0.05], { bevel: 0.0008 });
  b.box('steelBlack', [0.0052, 0.008, 0.008], [0.0082, 0.1235, 0.05], { bevel: 0.0008 });

  // ---------------------------------------------------------- pistol grip + trigger
  pistolGrip(b, G, { t0: -0.065, t1: 0.078, halfDepth: 0.0215, width: 0.034, mat: 'poly', panel: 'wood' });
  triggerGuard(b, 0.006, 0.06, 0.046, 0.014, 0.0065, 0.008, 'steelDark');
  b.part('trigger', [0, 0.044, -0.034], null);
  b.box('paintOrange', [0.0055, 0.03, 0.0075], [0, 0.028, -0.034], { bevel: 0.0014, rot: [0.22, 0, 0] });

  // ---------------------------------------------------------- stock
  b.use('body');
  const stock = [[-0.085, 0.106], [-0.2, 0.102], [-0.29, 0.094], [-0.352, 0.09], [-0.362, 0.026], [-0.29, 0.03], [-0.2, 0.05], [-0.085, 0.06]];
  b.ext('wood', chamferPoly(stock, [0.004, 0.005, 0.006, 0.004, 0.005, 0.006, 0.005, 0.004]), { width: 0.04, bevel: 0.0028 });
  // butt pad + steel tang
  b.box('rubber', [0.042, 0.078, 0.014], [0, 0.0625, 0.365], { bevel: 0.0026 });
  b.box('steelDark', [0.018, 0.01, 0.09], [0, 0.108, 0.125], { bevel: 0.002 });
  if (hi) {
    b.torus('steelDark', 0.0085, 0.0018, [-0.021, 0.038, 0.31], { rot: [0, Math.PI / 2, 0], ts: 4, rs: 8 });
    b.cube('paintOrange', [0.0014, 0.02, 0.05], [-0.0207, 0.088, 0.25], {});
    b.cube('paintOrange', [0.0014, 0.02, 0.05], [0.0207, 0.088, 0.25], {});
  }

  // ---------------------------------------------------------- pump (wood forend on the magazine tube)
  b.part('pump', [0, MAG_Y, -0.27], null);
  b.box('wood', [0.054, 0.052, 0.155], [0, MAG_Y - 0.001, -0.27], { bevel: 0.0055 });
  b.box('steelDark', [0.06, 0.058, 0.012], [0, MAG_Y - 0.001, -0.3475], { bevel: 0.0026 });
  b.box('steelDark', [0.06, 0.058, 0.012], [0, MAG_Y - 0.001, -0.1925], { bevel: 0.0026 });
  b.cube('glowOrange', [0.0012, 0.004, 0.06], [-0.0282, MAG_Y + 0.008, -0.27]);
  b.cube('glowOrange', [0.0012, 0.004, 0.06], [0.0282, MAG_Y + 0.008, -0.27]);
  // action bars running back into the receiver
  b.box('steelDark', [0.006, 0.01, 0.1], [-0.024, MAG_Y + 0.012, -0.15], { bevel: 0.0012 });
  b.box('steelDark', [0.006, 0.01, 0.1], [0.024, MAG_Y + 0.012, -0.15], { bevel: 0.0012 });
  if (hi) {
    for (let i = 0; i < 6; i++) b.cube('void', [0.0546, 0.0012, 0.006], [0, MAG_Y - 0.0272, -0.32 + i * 0.0215]);
    for (let i = 0; i < 6; i++) b.cube('void', [0.0012, 0.03, 0.0032], [-0.0273, MAG_Y - 0.004, -0.325 + i * 0.0215]);
  }

  b.marker('muzzle', SHOTGUN.muzzle).marker('sight', SHOTGUN.sight).marker('ejectPort', SHOTGUN.ejectPort);
  if (view) addShotgunArms(b);
}

function addShotgunArms(b) {
  addArm(b, {
    side: 'right', origin: [0, -0.03, 0.0], u: [1, 0, 0], v: G.V, t: G.T, hu: 0.02, hv: 0.0225, rr: 0.006, dir: -1, s0: -0.014, palmLen: 0.078,
    thumb: [[0.012, 0.028, -0.048], [-0.02, 0.016, -0.09], [-0.03, -0.006, -0.108]], thumbUp: [0, 1, 0],
    elbow: [0.34, -0.32, 0.5], armUp: [0.3, 1, 0],
    fingerOverride: { 0: { target: [0.004, 0.0295, -0.0315], bend: [0.008, 0, 0] } },
  });
  addArm(b, {
    side: 'left', origin: [0, MAG_Y, -0.268], u: [1, 0, 0], v: [0, 1, 0], t: [0, 0, 1], hu: 0.027, hv: 0.026, rr: 0.011, dir: 1,
    startUV: [0.01, -0.04], palmLen: 0.07,
    thumb: [[-0.028, -0.014, -0.02], [-0.034, 0.006, -0.058], [-0.034, 0.02, -0.096]], thumbUp: [-1, 0.3, 0],
    elbow: [-0.52, -0.24, 0.42], armUp: [-0.5, 1, 0],
  });
}
