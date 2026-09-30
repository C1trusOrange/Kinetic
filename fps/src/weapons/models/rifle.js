/**
 * AR-7 "Pulse" - modular pulse-cell assault rifle: gunmetal receivers, pale composite handguard and stock,
 * top rail with a holographic sight, curved cell magazine and glowing cyan energy core.
 */
import { chamferPoly, rectProfile } from './ModelKit.js';
import { addArm } from './Arms.js';
import { gripFrame, pistolGrip, triggerGuard, holoSight, screws } from './parts.js';
import { labelMaterial } from './WeaponMaterials.js';

const BORE = 0.098;
const RAKE = 0.384;
const G = gripFrame(RAKE, [-0.04, 0.0]);

export const RIFLE = {
  id: 'rifle',
  hip: [0.14, -0.19, -0.4],
  adsDistance: 0.21,
  sight: [0, 0.1565, -0.06],
  muzzle: [0, BORE, -0.615],
  ejectPort: [0.026, 0.103, -0.035],
};

/**
 * @param {import('./ModelKit.js').ModelBuilder} b
 * @param {boolean} view
 */
export function buildRifle(b, view) {
  const hi = b.hi;
  b.use('body');

  // ---------------------------------------------------------- receivers
  const lower = [[-0.108, 0.082], [-0.108, 0.046], [-0.080, 0.028], [0.046, 0.028], [0.046, 0.0], [0.104, 0.0], [0.106, 0.032], [0.132, 0.048], [0.20, 0.048], [0.20, 0.082]];
  b.ext('steelDark', chamferPoly(lower, [0.004, 0.004, 0.004, 0, 0.003, 0.004, 0.003, 0.003, 0, 0]), { width: 0.046, bevel: 0.0024 });
  const upper = [[-0.092, 0.078], [-0.092, 0.118], [-0.064, 0.125], [0.20, 0.125], [0.20, 0.078]];
  b.ext('steel', chamferPoly(upper, [0.003, 0.006, 0.004, 0.003, 0]), { width: 0.05, bevel: 0.0024 });
  // rail along the top
  b.box('rail', [0.022, 0.009, 0.535], [0, 0.1295, -0.1755], { bevel: 0.0016 });
  if (hi) {
    // forward assist + ejection port cover
    b.box('steelBlack', [0.012, 0.014, 0.022], [0.031, 0.104, 0.10], { bevel: 0.002 });
    b.box('steelBlack', [0.006, 0.02, 0.046], [0.026, 0.104, -0.012], { bevel: 0.0016 });
    b.cube('void', [0.0012, 0.014, 0.034], [0.0258, 0.104, -0.036]);
    // selector + mag release
    b.box('steelBlack', [0.006, 0.008, 0.016], [-0.0245, 0.052, 0.016], { bevel: 0.0014 });
    b.box('paintCyan', [0.004, 0.006, 0.01], [-0.0255, 0.056, 0.032], { bevel: 0.001 });
    b.cube('glowCyan', [0.001, 0.0035, 0.008], [-0.0271, 0.056, 0.032]);
  }
  screws(b, [[-0.025, 0.118, -0.08], [-0.025, 0.118, 0.07], [-0.023, 0.03, -0.06], [-0.023, 0.03, 0.02], [-0.023, 0.07, 0.19], [-0.023, 0.052, 0.19]], -1);
  // energy core window (left) + right mirror
  b.cube('cellBody', [0.0012, 0.028, 0.105], [-0.0257, 0.100, 0.024]);
  b.cube('cellBody', [0.0012, 0.028, 0.105], [0.0257, 0.100, 0.024]);
  b.box('steelBlack', [0.0016, 0.034, 0.112], [-0.0253, 0.100, 0.024], { bevel: 0.0006 });
  b.box('steelBlack', [0.0016, 0.034, 0.112], [0.0253, 0.100, 0.024], { bevel: 0.0006 });

  // ---------------------------------------------------------- handguard + barrel
  const hgRear = rectProfile(0.060, 0.066, 0.014, 0, BORE);
  const hgFront = rectProfile(0.050, 0.056, 0.012, 0, BORE);
  b.ext('polyGrey', hgRear, { axis: 'z', z0: -0.36, z1: -0.198, bevel: 0.0026 });
  b.ext('polyGrey', hgFront, { axis: 'z', z0: -0.44, z1: -0.352, bevel: 0.0026 });
  // handguard end cap + barrel
  b.cyl('steelBlack', { r: 0.0175, len: 0.02, pos: [0, BORE, -0.445], seg: 10 });
  b.cyl('steel', { r: 0.0105, len: 0.16, pos: [0, BORE, -0.5], seg: 10 });
  // muzzle brake
  b.cyl('steelBlack', { r: 0.0165, len: 0.07, pos: [0, BORE, -0.57], seg: 10 });
  b.cyl('glowCyan', { r: 0.0172, len: 0.0045, pos: [0, BORE, -0.543], seg: 10 });
  b.cyl('void', { r: 0.0068, len: 0.001, pos: [0, BORE, -0.6055], seg: 8 });
  b.cube('void', [0.0355, 0.006, 0.014], [0, BORE, -0.576]);
  // under-rail and cyan accent lines on the handguard
  b.box('rail', [0.02, 0.008, 0.15], [0, BORE - 0.0365, -0.28], { bevel: 0.0014 });
  b.cube('glowCyan', [0.0012, 0.0032, 0.14], [-0.0304, BORE + 0.01, -0.27]);
  b.cube('glowCyan', [0.0012, 0.0032, 0.14], [0.0304, BORE + 0.01, -0.27]);
  b.decal(labelMaterial('rifle-name', 'AR-7  PULSE', { w: 256, h: 40, size: 28, color: '#1a1d22', weight: '800', spacing: 3 }), [0.085, 0.0135], [-0.0304, BORE - 0.012, -0.262]);
  if (hi) {
    // vent slots
    for (let i = 0; i < 4; i++) {
      const z = -0.225 - i * 0.03;
      b.cube('void', [0.0622, 0.011, 0.0135], [0, BORE + 0.006, z]);
    }
    // front sight tower + heat rings
    b.box('steelBlack', [0.008, 0.026, 0.016], [0, BORE + 0.037, -0.418], { bevel: 0.0016 });
    b.cube('glowCyan', [0.0025, 0.004, 0.0012], [0, BORE + 0.048, -0.4095]);
    for (let i = 0; i < 3; i++) b.cyl('steelDark', { r: 0.0122, len: 0.005, pos: [0, BORE, -0.478 - i * 0.02], seg: 10 });
  }

  // ---------------------------------------------------------- pistol grip, guard, trigger
  pistolGrip(b, G, { t0: -0.075, t1: 0.078, halfDepth: 0.0215, width: 0.032, mat: 'poly' });
  triggerGuard(b, 0.004, 0.056, 0.03, 0.001, 0.0065, 0.008, 'steelDark');
  b.part('trigger', [0, 0.028, -0.032], null);
  b.box('paintCyan', [0.0055, 0.03, 0.0075], [0, 0.0125, -0.0325], { bevel: 0.0014, rot: [0.24, 0, 0] });

  // ---------------------------------------------------------- stock
  b.use('body');
  b.cyl('steelDark', { r: 0.0195, len: 0.115, pos: [0, BORE, 0.1555], seg: 10 });
  const stock = [[-0.198, 0.128], [-0.262, 0.130], [-0.334, 0.118], [-0.352, 0.116], [-0.352, 0.016], [-0.322, 0.012], [-0.262, 0.044], [-0.198, 0.062]];
  const stockHole = [[-0.226, 0.108], [-0.318, 0.100], [-0.318, 0.046], [-0.288, 0.05], [-0.226, 0.078]];
  b.ext('polyGrey', chamferPoly(stock, [0.004, 0.004, 0.004, 0.003, 0.003, 0.004, 0.005, 0.004]), { width: 0.04, bevel: 0.0026, holes: [stockHole] });
  b.box('grip', [0.042, 0.108, 0.012], [0, 0.066, 0.352], { bevel: 0.0018 });
  b.cube('glowCyan', [0.0012, 0.0034, 0.07], [-0.0206, 0.122, 0.27]);
  b.cube('glowCyan', [0.0012, 0.0034, 0.07], [0.0206, 0.122, 0.27]);

  // ---------------------------------------------------------- magazine (curved cell magazine)
  const magProfile = [[0.050, 0.036], [0.096, 0.036], [0.100, -0.03], [0.116, -0.103], [0.083, -0.105], [0.060, -0.03]];
  b.part('mag', [0, -0.03, -0.078], null);
  b.ext('poly', chamferPoly(magProfile, [0.004, 0.004, 0.004, 0.004, 0.004, 0.004]), { width: 0.028, bevel: 0.0022 });
  b.box('paintCyan', [0.032, 0.008, 0.044], [0, -0.1055, -0.1000], { bevel: 0.0022 });
  b.cube('cellBody', [0.0012, 0.058, 0.014], [-0.0146, -0.055, -0.0855], { rot: [0.17, 0, 0] });
  b.cube('cellBody', [0.0012, 0.058, 0.014], [0.0146, -0.055, -0.0855], { rot: [0.17, 0, 0] });
  if (hi) {
    for (let i = 0; i < 3; i++) b.cube('steelDark', [0.0296, 0.0028, 0.036], [0, -0.024 - i * 0.02, -0.078 - i * 0.004], { rot: [0.17, 0, 0] });
  }

  // ---------------------------------------------------------- bolt carrier (side charging knob + visible carrier in the port)
  b.part('bolt', [0, 0.1, 0.0], null);
  b.box('steelBlack', [0.009, 0.014, 0.03], [-0.029, 0.104, 0.052], { bevel: 0.0018 });
  b.box('paintCyan', [0.0035, 0.008, 0.02], [-0.0355, 0.104, 0.052], { bevel: 0.001 });
  b.box('steelDark', [0.004, 0.012, 0.03], [0.0225, 0.104, -0.036], { bevel: 0.001 });

  // ---------------------------------------------------------- holo sight
  b.use('body');
  holoSight(b, { baseY: 0.1345, z: -0.06, depth: 0.05, w: 0.04, h: 0.036 });

  b.marker('muzzle', RIFLE.muzzle).marker('sight', RIFLE.sight).marker('ejectPort', RIFLE.ejectPort);
  if (view) addRifleArms(b);
}

function addRifleArms(b) {
  // right hand: pistol grip, index finger on the trigger, thumb over the left side of the lower receiver
  const O = [0, -0.032, 0.0];
  addArm(b, {
    side: 'right', origin: O, u: [1, 0, 0], v: G.V, t: G.T, hu: 0.0195, hv: 0.0225, rr: 0.006, dir: -1, s0: -0.014, palmLen: 0.078,
    thumb: [[0.012, 0.028, -0.048], [-0.02, 0.016, -0.09], [-0.03, -0.006, -0.108]], thumbUp: [0, 1, 0],
    elbow: [0.34, -0.32, 0.50], armUp: [0.3, 1, 0],
    fingerOverride: { 0: { target: [0.004, 0.0125, -0.0275], bend: [0.008, 0, 0] } },
  });
  // left hand: C-clamp under the handguard, thumb along the left side
  addArm(b, {
    side: 'left', origin: [0, BORE, -0.318], u: [1, 0, 0], v: [0, 1, 0], t: [0, 0, 1], hu: 0.030, hv: 0.033, rr: 0.012, dir: 1,
    startUV: [0.004, -0.045], palmLen: 0.07, spacing: 0.0172,
    thumb: [[-0.03, -0.012, -0.016], [-0.038, 0.014, -0.055], [-0.036, 0.03, -0.1]], thumbUp: [-0.4, 1, 0],
    elbow: [-0.52, -0.24, 0.42], armUp: [-0.5, 1, 0],
  });
}
