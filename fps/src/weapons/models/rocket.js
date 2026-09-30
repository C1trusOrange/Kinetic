/**
 * Hammer - shoulder-fired rocket launcher (olive composite tube, hazard band, red warning lights, loaded warhead)
 * and the in-flight rocket projectile model.
 */
import * as THREE from 'three';
import { addArm } from './Arms.js';
import { gripFrame, pistolGrip, triggerGuard, holoSight, screws } from './parts.js';
import { labelMaterial } from './WeaponMaterials.js';

const AXIS_Y = 0.118;
const TUBE_R = 0.056;
const RAKE = 0.3;
const G = gripFrame(RAKE, [-0.02, 0.0]);
const FORE_Z = -0.30;   // fore-grip position
const HOLO_BASE = AXIS_Y + TUBE_R + 0.012;
const HOLO_CY = HOLO_BASE + 0.004 + 0.032 / 2;

export const ROCKET = {
  id: 'rocket',
  hip: [0.19, -0.245, -0.5],
  adsDistance: 0.2,
  sight: [0, HOLO_CY, -0.02],
  muzzle: [0, AXIS_Y, -0.56],
  ejectPort: null,
};

/**
 * @param {import('./ModelKit.js').ModelBuilder} b
 * @param {boolean} view
 */
export function buildRocketLauncher(b, view) {
  const hi = b.hi;
  b.use('body');

  // ---------------------------------------------------------- launch tube
  b.cyl('paintOlive', { r: TUBE_R, len: 0.84, pos: [0, AXIS_Y, -0.13], seg: 14 });
  // rear blast cone + inner void
  b.cyl('steelBlack', { r: 0.078, r2: TUBE_R + 0.004, len: 0.085, pos: [0, AXIS_Y, 0.3325], seg: 14 });
  b.cyl('void', { r: 0.062, len: 0.002, pos: [0, AXIS_Y, 0.374], seg: 12 });
  b.cyl('glowOrange', { r: 0.0785, len: 0.005, pos: [0, AXIS_Y, 0.3695], seg: 14, cap: false });
  // front lip
  b.cyl('steelDark', { r: 0.0605, len: 0.03, pos: [0, AXIS_Y, -0.535], seg: 14 });
  // reinforcement bands
  for (const z of [0.16, -0.06, -0.30]) b.cyl('steelDark', { r: 0.0588, len: 0.014, pos: [0, AXIS_Y, z], seg: 14 });
  // hazard band + name
  b.cyl('hazard', { r: 0.0568, len: 0.075, pos: [0, AXIS_Y, -0.41], seg: 14 });
  b.decal(labelMaterial('rk-name', 'HAMMER', { w: 320, h: 72, size: 56, color: '#eee9cf', weight: '900', spacing: 6, opacity: 0.95 }), [0.16, 0.0365], [-TUBE_R - 0.0004, AXIS_Y + 0.008, 0.02], { face: 'left' });
  b.decal(labelMaterial('rk-warn', 'CAUTION  BACKBLAST', { w: 384, h: 36, size: 22, color: '#f0d24a', weight: '800', spacing: 3, opacity: 0.95 }), [0.13, 0.0122], [-TUBE_R - 0.0004, AXIS_Y - 0.026, 0.19], { face: 'left' });
  // rail + holographic sight
  b.box('steelBlack', [0.032, 0.012, 0.34], [0, AXIS_Y + TUBE_R + 0.004, -0.06], { bevel: 0.0022 });
  b.box('rail', [0.02, 0.008, 0.3], [0, AXIS_Y + TUBE_R + 0.01, -0.06], { bevel: 0.0014 });
  holoSight(b, { baseY: HOLO_BASE, z: -0.02, depth: 0.05, w: 0.036, h: 0.032, accent: 'glowRed' });
  // warning lights (front) and status LEDs
  for (let i = 0; i < 3; i++) b.cube('glowRed', [0.007, 0.0045, 0.009], [-0.02 + i * 0.02, AXIS_Y + TUBE_R + 0.0025, -0.3]);
  b.box('steelBlack', [0.014, 0.016, 0.03], [0.0, AXIS_Y + TUBE_R + 0.006, -0.3], { bevel: 0.0016 });
  // electronics pod on the left with a status screen
  b.box('steelDark', [0.024, 0.05, 0.11], [-0.062, AXIS_Y - 0.03, -0.09], { bevel: 0.0026 });
  b.cube('glowGreen', [0.0012, 0.008, 0.06], [-0.0747, AXIS_Y - 0.018, -0.09]);
  b.cube('glowRed', [0.0012, 0.008, 0.012], [-0.0747, AXIS_Y - 0.04, -0.062]);
  b.cube('glowAmber', [0.0012, 0.008, 0.012], [-0.0747, AXIS_Y - 0.04, -0.09]);
  screws(b, [[-0.074, AXIS_Y - 0.008, -0.14], [-0.074, AXIS_Y - 0.052, -0.14], [-0.074, AXIS_Y - 0.008, -0.04], [-0.074, AXIS_Y - 0.052, -0.04]], -1, 0.0019);
  if (hi) {
    b.cube('glowGreen', [0.0012, 0.008, 0.012], [-0.0747, AXIS_Y - 0.04, -0.118]);
    // mirrored pod hardware on the right + vent grille
    b.box('steelDark', [0.02, 0.04, 0.09], [0.06, AXIS_Y - 0.035, -0.09], { bevel: 0.0022 });
    for (let i = 0; i < 4; i++) b.cube('void', [0.0212, 0.0024, 0.07], [0.06, AXIS_Y - 0.048 + i * 0.01, -0.09]);
    // tube seam lines
    for (let i = 0; i < 2; i++) b.cyl('steelBlack', { r: 0.0572, len: 0.004, pos: [0, AXIS_Y, 0.09 - i * 0.02], seg: 14 });
  }

  // ---------------------------------------------------------- grip housing, pistol grip, trigger
  b.box('steelBlack', [0.04, 0.05, 0.16], [0, 0.056, -0.0], { bevel: 0.003 });
  pistolGrip(b, G, { t0: -0.065, t1: 0.075, halfDepth: 0.0215, width: 0.034, mat: 'poly', panel: 'grip' });
  triggerGuard(b, 0.012, 0.064, 0.036, 0.008, 0.0065, 0.008, 'steelDark');
  b.part('trigger', [0, 0.034, -0.038], null);
  b.box('paintOrange', [0.0055, 0.03, 0.0075], [0, 0.02, -0.038], { bevel: 0.0014, rot: [0.22, 0, 0] });

  // ---------------------------------------------------------- fore-grip (vertical, rubber)
  b.use('body');
  b.box('steelBlack', [0.036, 0.02, 0.06], [0, 0.048, FORE_Z], { bevel: 0.003 });
  b.cyl('poly', { r: 0.0195, len: 0.125, axis: 'y', pos: [0, -0.0205, FORE_Z], seg: 10 });
  b.cyl('grip', { r: 0.0205, len: 0.1, axis: 'y', pos: [0, -0.0255, FORE_Z], seg: 10 });
  b.cyl('steelDark', { r: 0.0225, len: 0.01, axis: 'y', pos: [0, -0.0855, FORE_Z], seg: 10 });
  b.cube('glowOrange', [0.003, 0.003, 0.003], [0, -0.0915, FORE_Z]);

  // ---------------------------------------------------------- shoulder pad (rear)
  b.box('rubber', [0.05, 0.05, 0.02], [0, AXIS_Y - 0.075, 0.13], { bevel: 0.004 });
  b.box('steelDark', [0.04, 0.03, 0.06], [0, AXIS_Y - 0.06, 0.15], { bevel: 0.003 });

  // ---------------------------------------------------------- loaded warhead (animatable: hide after firing)
  b.part('mag', [0, AXIS_Y, -0.5], null); // the loaded round (also exposed as parts.rocket)
  b.lathe('paintOlive', [[0, -0.02], [0.045, -0.02], [0.05, 0.02], [0.05, 0.08], [0.036, 0.13], [0.018, 0.16], [0.0, 0.17]], { seg: 12, axis: 'z', pos: [0, AXIS_Y, -0.545], rot: [0, 0, 0] });
  b.cyl('glowRed', { r: 0.0505, len: 0.006, pos: [0, AXIS_Y, -0.6], seg: 12, cap: false });
  b.sphere('glowRed', 0.008, [0, AXIS_Y, -0.716], { ws: 6, hs: 4 });

  b.marker('muzzle', ROCKET.muzzle).marker('sight', ROCKET.sight);
  if (view) addLauncherArms(b);
}

function addLauncherArms(b) {
  addArm(b, {
    side: 'right', origin: [0, -0.024, 0.0], u: [1, 0, 0], v: G.V, t: G.T, hu: 0.02, hv: 0.0225, rr: 0.006, dir: -1, s0: -0.014, palmLen: 0.078,
    thumb: [[0.012, 0.028, -0.048], [-0.02, 0.016, -0.09], [-0.03, -0.006, -0.108]], thumbUp: [0, 1, 0],
    elbow: [0.32, -0.34, 0.5], armUp: [0.3, 1, 0],
    fingerOverride: { 0: { target: [0.004, 0.022, -0.0335], bend: [0.008, 0, 0] } },
  });
  // left hand wraps the vertical fore-grip (mirrored copy of the right-hand wrap)
  addArm(b, {
    side: 'left', origin: [0, -0.0205, FORE_Z], u: [-1, 0, 0], v: [0, 0, 1], t: [0, -1, 0], hu: 0.0205, hv: 0.0205, rr: 0.01, dir: -1, s0: -0.012, palmLen: 0.076,
    thumb: [[0.012, 0.022, -0.05], [-0.016, 0.006, -0.062], [-0.024, -0.02, -0.064]], thumbUp: [0, 1, 0],
    elbow: [-0.5, -0.24, 0.4], armUp: [-0.4, 1, 0],
  });
}

/**
 * Rocket projectile: olive body, warhead band, four fins, glowing nozzle and an additive exhaust flame.
 * @param {import('./ModelKit.js').ModelBuilder} b
 */
export function buildRocketProjectile(b) {
  b.use('body');
  const R = 0.042;
  // body + ogive nose
  b.cyl('paintOlive', { r: R, len: 0.24, pos: [0, 0, 0.12], seg: 10 });
  b.lathe('steelBlack', [[R, -0.015], [R, 0.0], [0.038, 0.06], [0.022, 0.12], [0, 0.165]], { seg: 10, axis: 'z', pos: [0, 0, 0] });
  b.sphere('glowRed', 0.009, [0, 0, -0.166], { ws: 6, hs: 4 });
  b.cyl('hazard', { r: R + 0.0012, len: 0.05, pos: [0, 0, 0.035], seg: 10 });
  b.cyl('paintOrange', { r: R + 0.001, len: 0.014, pos: [0, 0, 0.13], seg: 10 });
  // nozzle
  b.cyl('steelBlack', { r: 0.046, r2: 0.034, len: 0.06, pos: [0, 0, 0.27], seg: 10 });
  b.cyl('glowOrange', { r: 0.032, len: 0.004, pos: [0, 0, 0.3], seg: 10 });
  // fins
  const fin = [[-0.19, R - 0.004], [-0.30, R - 0.004], [-0.30, R + 0.058], [-0.262, R + 0.058]]; // (forward, out)
  for (let k = 0; k < 4; k++) {
    b.ext('steelDark', fin, { width: 0.005, bevel: 0.0008, rot: [0, 0, k * Math.PI / 2] });
  }
  // warning lights on the body
  b.cube('glowRed', [0.008, 0.008, 0.012], [0, R + 0.001, 0.02]);
  b.cube('glowRed', [0.008, 0.008, 0.012], [0, -R - 0.001, 0.02]);
  b.marker('flame', [0, 0, 0.3]);
}

/**
 * Additive exhaust flame geometry: cones pointing +Z with their base at z = 0, vertex-coloured from a hot core to a
 * black (= invisible under additive blending) tip.
 * @returns {THREE.BufferGeometry[]}
 */
export function flameGeometry(len = 0.3, r = 0.036) {
  const parts = [];
  const mk = (rr, ll, c0, c1) => {
    const g = new THREE.ConeGeometry(rr, ll, 8, 2, true);
    g.rotateX(Math.PI / 2);        // apex -> +Z
    g.translate(0, 0, ll / 2);
    const pos = g.attributes.position;
    const col = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const t = Math.min(1, Math.max(0, pos.getZ(i) / ll));
      const k = Math.pow(1 - t, 1.3);
      col[i * 3] = c0[0] * k + c1[0] * (1 - k);
      col[i * 3 + 1] = c0[1] * k + c1[1] * (1 - k);
      col[i * 3 + 2] = c0[2] * k + c1[2] * (1 - k);
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    return g.toNonIndexed();
  };
  parts.push(mk(r, len, [1.0, 0.5, 0.1], [0, 0, 0]));
  parts.push(mk(r * 0.55, len * 0.62, [1.0, 0.92, 0.7], [0, 0, 0]));
  return parts;
}
