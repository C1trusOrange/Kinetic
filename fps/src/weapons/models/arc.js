/**
 * Tempest - white-ceramic coil gun: chunky receiver with a dorsal ammo gauge, glass plasma tube wrapped in three
 * spinning Tesla coil rings, a forked emitter with a spark gap, a rear capacitor drum and a glowing energy-cell magazine.
 * Animated parts (view model): `coil` (rings + plasma core: spun about the bore and pulsed by WeaponSystem),
 * `gauge0..gauge7` (ammo cells), `trigger`, `mag`.
 */
import { addArm } from './Arms.js';
import { gripFrame, pistolGrip, triggerGuard, holoSight, screws } from './parts.js';
import { labelMaterial } from './WeaponMaterials.js';

const AX = 0.112;            // bore axis height
const RAKE = 0.3;
const G = gripFrame(RAKE, [-0.02, 0.0]);
const COIL_Z = -0.34;        // pivot of the coil group
const FORE_Z = -0.27;        // vertical fore-grip
const HOLO_BASE = 0.178;
const HOLO_CY = HOLO_BASE + 0.004 + 0.036 / 2;

export const ARC = {
  id: 'arc',
  hip: [0.185, -0.225, -0.5],
  adsDistance: 0.16,
  sight: [0, HOLO_CY, -0.02],
  muzzle: [0, AX, -0.69],
  ejectPort: null,
  /** number of ammo-gauge cells (parts gauge0..gauge7; cells 0-1 are amber = low-ammo warning) */
  gaugeCells: 8,
};

/**
 * @param {import('./ModelKit.js').ModelBuilder} b
 * @param {boolean} view
 */
export function buildArc(b, view) {
  const hi = b.hi;
  b.use('body');

  // ---------------------------------------------------------- receiver (white ceramic) + undercarriage
  b.box('ceramic', [0.074, 0.088, 0.34], [0, AX - 0.004, 0.02], { bevel: 0.007 });
  b.box('steelDark', [0.056, 0.034, 0.3], [0, 0.047, -0.005], { bevel: 0.004 });
  // dorsal hump (gauge sits on it, the holo sight in front of the gauge)
  b.box('ceramic', [0.05, 0.02, 0.3], [0, 0.161, 0.01], { bevel: 0.005 });
  // cyan accent piping on the flanks
  b.cube('glowCyan', [0.0012, 0.0034, 0.22], [-0.0376, AX + 0.03, 0.03]);
  b.cube('glowCyan', [0.0012, 0.0034, 0.22], [0.0376, AX + 0.03, 0.03]);
  b.decal(labelMaterial('arc-name', 'TEMPEST', { w: 320, h: 64, size: 46, color: '#24333f', weight: '900', spacing: 6, opacity: 0.95 }),
    [0.13, 0.026], [-0.0374, AX - 0.012, 0.05], { face: 'left' });
  b.decal(labelMaterial('arc-warn', 'HIGH VOLTAGE', { w: 320, h: 36, size: 22, color: '#c8951e', weight: '800', spacing: 3, opacity: 0.9 }),
    [0.1, 0.011], [-0.0374, AX - 0.036, 0.09], { face: 'left' });
  if (hi) {
    for (let i = 0; i < 2; i++) b.cube('void', [0.0012, 0.02, 0.008], [0.0376, AX - 0.006, -0.06 + i * 0.03]);   // vents (right flank)
    screws(b, [[-0.0375, AX + 0.036, -0.1], [-0.0375, AX + 0.036, 0.16], [-0.0375, AX - 0.04, -0.1], [-0.0375, AX - 0.04, 0.16]], -1);
  }

  // ---------------------------------------------------------- ammo gauge (8 cells: gauge0..gauge7, rear to front)
  const gz0 = 0.026;
  for (let i = 0; i < ARC.gaugeCells; i++) {
    if (!hi && i % 2) continue;                       // world models: half the cells (parts are not animated there)
    b.part('gauge' + i, [0, 0.1745, gz0 + i * 0.019], null);
    b.cube(i < 2 ? 'glowAmber' : 'glowCyan', [0.014, 0.007, 0.0155], [0, 0.1745, gz0 + i * 0.019]);
  }
  b.use('body');

  // ---------------------------------------------------------- holo sight
  holoSight(b, { baseY: HOLO_BASE, z: -0.02, depth: 0.05, w: 0.04, h: 0.036, accent: 'glowCyan' });
  b.box('steelBlack', [0.052, 0.008, 0.078], [0, 0.174, -0.02], { bevel: 0.002 });

  // ---------------------------------------------------------- rear capacitor drum
  b.cyl('steelDark', { r: 0.052, len: 0.15, pos: [0, AX, 0.27], seg: 12 });
  b.cyl('hazard', { r: 0.0527, len: 0.024, pos: [0, AX, 0.235], seg: 12 });
  b.cyl('glowCyan', { r: 0.0536, len: 0.006, pos: [0, AX, 0.298], seg: 12, cap: false });
  b.cyl('steelBlack', { r: 0.0545, len: 0.012, pos: [0, AX, 0.196], seg: 12 });
  b.cyl('glowViolet', { r: 0.034, len: 0.004, pos: [0, AX, 0.3465], seg: 12 });
  if (hi) b.cyl('steelBlack', { r: 0.04, r2: 0.052, len: 0.014, pos: [0, AX, 0.338], seg: 12 });

  // ---------------------------------------------------------- plasma tube (glass) + collars
  b.cyl('steelBlack', { r: 0.042, len: 0.03, pos: [0, AX, -0.165], seg: 12 });
  b.cyl('lens', { r: 0.03, len: 0.3, pos: [0, AX, -0.315], seg: 12 });
  b.cyl('steelBlack', { r: 0.042, len: 0.03, pos: [0, AX, -0.475], seg: 12 });
  // rail under the tube + struts carrying the fore-grip
  b.box('steelDark', [0.03, 0.02, 0.26], [0, 0.048, FORE_Z - 0.02], { bevel: 0.003 });
  b.cube('steelBlack', [0.02, 0.026, 0.03], [0, 0.07, -0.165]);
  b.cube('steelBlack', [0.02, 0.026, 0.03], [0, 0.07, -0.475]);

  // ---------------------------------------------------------- tesla coil group (spins about the bore, glow pulses)
  b.part('coil', [0, AX, COIL_Z], null);
  b.cyl('glowViolet', { r: 0.011, len: 0.3, pos: [0, AX, -0.315], seg: 8 });                         // plasma core
  for (const dz of [-0.075, 0, 0.075]) {
    const z = COIL_Z + dz;
    b.torus('steelDark', 0.041, 0.0062, [0, AX, z], { rs: 12, ts: 4 });
    if (b.lod >= 1) b.torus('glowCyan', 0.0468, 0.0024, [0, AX, z], { rs: 12, ts: 3 });
    for (let k = 0; hi && k < 4; k++) {
      const a = Math.PI / 4 + k * Math.PI / 2 + dz * 6;
      b.cube('glowCyan', [0.011, 0.011, 0.011], [Math.cos(a) * 0.0435, AX + Math.sin(a) * 0.0435, z], { rot: [0, 0, a] });
    }
  }
  b.use('body');

  // ---------------------------------------------------------- forked emitter with spark gap
  for (const sx of [-1, 1]) {
    b.beam('steelDark', [sx * 0.03, AX, -0.485], [sx * 0.05, AX, -0.585], { w: 0.016, h: 0.024, bevel: 0, ext1: 0.004 });
    b.beam('steelDark', [sx * 0.05, AX, -0.585], [sx * 0.024, AX, -0.69], { w: 0.014, h: 0.02, bevel: 0, ext0: 0.004 });
    if (hi) b.sphere('glowCyan', 0.0105, [sx * 0.0225, AX, -0.696], { ws: 8, hs: 6 });
    else b.cube('glowCyan', [0.02, 0.02, 0.02], [sx * 0.0225, AX, -0.696]);
  }
  if (hi) b.cyl('glowViolet', { r: 0.0042, len: 0.036, axis: 'x', pos: [0, AX, -0.696], seg: 6 });
  b.cube('glowViolet', [0.006, 0.02, 0.006], [0, AX, -0.696]);
  b.box('steelBlack', [0.03, 0.012, 0.03], [0, AX - 0.028, -0.52], { bevel: 0.002 });

  // ---------------------------------------------------------- pistol grip, guard, trigger
  b.box('steelBlack', [0.04, 0.04, 0.14], [0, 0.05, 0.0], { bevel: 0.003 });
  pistolGrip(b, G, { t0: -0.065, t1: 0.075, halfDepth: 0.0215, width: 0.034, mat: 'poly', panel: 'grip' });
  triggerGuard(b, 0.012, 0.064, 0.036, 0.008, 0.0065, 0.008, 'steelDark');
  b.part('trigger', [0, 0.034, -0.038], null);
  b.box('paintCyan', [0.0055, 0.03, 0.0075], [0, 0.02, -0.038], { bevel: 0.0014, rot: [0.22, 0, 0] });

  // ---------------------------------------------------------- vertical fore-grip
  b.use('body');
  b.box('steelBlack', [0.036, 0.02, 0.06], [0, 0.048, FORE_Z], { bevel: 0.003 });
  if (hi) b.cyl('poly', { r: 0.0195, len: 0.125, axis: 'y', pos: [0, -0.0205, FORE_Z], seg: 10 });
  b.cyl('grip', { r: 0.0205, len: 0.1, axis: 'y', pos: [0, -0.0255, FORE_Z], seg: 10 });
  b.cyl('steelDark', { r: 0.0225, len: 0.01, axis: 'y', pos: [0, -0.0855, FORE_Z], seg: 10 });
  b.cube('glowCyan', [0.003, 0.003, 0.003], [0, -0.0915, FORE_Z]);

  // ---------------------------------------------------------- energy cell magazine
  b.part('mag', [0, 0.02, -0.105], null);
  b.box('steelDark', [0.038, 0.098, 0.054], [0, 0.012, -0.105], { bevel: 0.003 });
  b.cube('cellBody', [0.0012, 0.07, 0.034], [-0.0196, 0.008, -0.105]);
  b.cube('cellBody', [0.0012, 0.07, 0.034], [0.0196, 0.008, -0.105]);
  b.box('paintCyan', [0.042, 0.008, 0.06], [0, -0.042, -0.105], { bevel: 0.002 });
  b.use('body');

  b.marker('muzzle', ARC.muzzle).marker('sight', ARC.sight);
  if (view) addArcArms(b);
}

function addArcArms(b) {
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
