import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

/**
 * Pickups: health / armor / ammo / grenades / weapon pads.
 * Floating, spinning low-poly props with emissive accents on a glowing base ring, light beams for
 * visibility, collection (feet within 1.3 m horizontally and 1.6 m vertically), respawn timers,
 * 'pickup' events and sounds.  See ARCHITECTURE.md 6.2.
 */

const WEAPON_IDS = ['pistol', 'rifle', 'shotgun', 'sniper', 'rocket'];
const TYPES = ['health', 'armor', 'ammo', 'grenades', 'weapon'];
const SOUNDS = { health: 'pickup_health', armor: 'pickup_armor', ammo: 'pickup_ammo', grenades: 'pickup_grenade', weapon: 'pickup_weapon' };
const DEFAULT_RESPAWN = { health: 20, armor: 25, ammo: 15, grenades: 20, weapon: 25 };
const TYPE_COLOR = { health: 0x2dff7a, armor: 0x38b6ff, ammo: 0xffc233, grenades: 0xff5a3c };
const WEAPON_COLOR = { pistol: 0xc4d4e4, rifle: 0x6dff8a, shotgun: 0xffb040, sniper: 0x40d0ff, rocket: 0xff5a30 };
const WEAPON_LENGTH = { pistol: 0.5, rifle: 0.95, shotgun: 1.0, sniper: 1.15, rocket: 1.05 };

const COLLECT_H = 1.3;
const COLLECT_V_UP = 1.6;
const COLLECT_V_DOWN = 1.0;
const FLOAT_Y = 0.95;

let weaponModelsPromise = null;
function loadWeaponModels() {
  if (!weaponModelsPromise) {
    weaponModelsPromise = import('../weapons/WeaponModels.js').catch(err => {
      console.warn('[pickups] WeaponModels unavailable, using placeholders:', err && err.message);
      return null;
    });
  }
  return weaponModelsPromise;
}

// ---------------------------------------------------------------------- shared assets

let ASSETS = null;

function mat(color, o = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.5, metalness: 0.1, ...o });
}

function glow(color, intensity, o = {}) {
  const c = new THREE.Color(color);
  return new THREE.MeshStandardMaterial({ color: 0x111111, emissive: c, emissiveIntensity: intensity, roughness: 0.6, ...o });
}

function shieldShape(scale = 1) {
  const s = new THREE.Shape();
  const pts = [[-0.17, 0.25], [0.17, 0.25], [0.21, 0.2], [0.21, 0.02], [0, -0.28], [-0.21, 0.02], [-0.21, 0.2]];
  pts.forEach(([x, y], i) => (i === 0 ? s.moveTo(x * scale, y * scale) : s.lineTo(x * scale, y * scale)));
  s.closePath();
  return s;
}

function beamGeometry(r0, r1, h) {
  const g = new THREE.CylinderGeometry(r1, r0, h, 18, 1, true);
  g.translate(0, h / 2, 0);
  const pos = g.attributes.position;
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const t = pos.getY(i) / h;
    const k = Math.pow(Math.max(0, 1 - t), 1.6);
    col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = k;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

function assets() {
  if (ASSETS) return ASSETS;
  const A = { geo: {}, mat: {}, beamMats: new Map() };
  const G = A.geo, M = A.mat;

  // materials
  M.white = mat(0xe7edf1, { roughness: 0.38, metalness: 0.05 });
  M.gray = mat(0x2b3138, { roughness: 0.5, metalness: 0.6 });
  M.dark = mat(0x161a1f, { roughness: 0.55, metalness: 0.7 });
  M.red = glow(0xff2a2a, 2.4);
  M.olive = mat(0x59683a, { roughness: 0.72, metalness: 0.15 });
  M.oliveDark = mat(0x3b4628, { roughness: 0.7, metalness: 0.2 });
  M.brass = mat(0xd9a441, { roughness: 0.25, metalness: 1.0 });
  M.copper = mat(0xb5652e, { roughness: 0.3, metalness: 0.9 });
  M.amber = glow(0xffb020, 2.6);
  M.blueSteel = mat(0x33507c, { roughness: 0.32, metalness: 0.75 });
  M.cyan = glow(0x3de0ff, 3.0);
  M.gren = mat(0x3d4a2a, { roughness: 0.55, metalness: 0.35 });
  M.gold = mat(0xe0b040, { roughness: 0.3, metalness: 1.0 });
  M.padTop = mat(0x1a2027, { roughness: 0.45, metalness: 0.75 });
  M.padTrim = mat(0x384250, { roughness: 0.4, metalness: 0.8 });
  M.placeholder = mat(0x8899aa, { roughness: 0.4, metalness: 0.6 });

  // base pad
  G.pad = new THREE.CylinderGeometry(0.6, 0.66, 0.07, 28);
  G.padTop = new THREE.CylinderGeometry(0.5, 0.56, 0.03, 28);
  G.ring = new THREE.RingGeometry(0.4, 0.5, 40);
  G.ring.rotateX(-Math.PI / 2);
  G.padBig = new THREE.CylinderGeometry(0.72, 0.8, 0.08, 6);
  G.padBigTop = new THREE.CylinderGeometry(0.6, 0.68, 0.03, 6);
  G.ringBig = new THREE.RingGeometry(0.5, 0.62, 6, 1);
  G.ringBig.rotateX(-Math.PI / 2);
  G.beam = beamGeometry(0.42, 0.3, 2.6);
  G.beamBig = beamGeometry(0.52, 0.36, 3.0);

  // medkit
  G.medBody = new RoundedBoxGeometry(0.46, 0.25, 0.3, 2, 0.045);
  G.medBase = new RoundedBoxGeometry(0.47, 0.09, 0.31, 2, 0.03);
  G.crossA = new THREE.BoxGeometry(0.2, 0.062, 0.014);
  G.crossB = new THREE.BoxGeometry(0.062, 0.2, 0.014);
  G.medHandle = new RoundedBoxGeometry(0.2, 0.035, 0.05, 1, 0.012);
  G.medPost = new THREE.BoxGeometry(0.035, 0.05, 0.05);
  G.medLatch = new THREE.BoxGeometry(0.05, 0.1, 0.02);

  // armor
  const ex = { depth: 0.05, bevelEnabled: true, bevelThickness: 0.022, bevelSize: 0.02, bevelSegments: 1, steps: 1 };
  G.shield = new THREE.ExtrudeGeometry(shieldShape(1), ex);
  G.shield.translate(0, 0, -0.025);
  G.shieldRim = new THREE.ExtrudeGeometry(shieldShape(0.72), { depth: 0.012, bevelEnabled: false });
  G.shieldEmblem = new THREE.ExtrudeGeometry(shieldShape(0.5), { depth: 0.012, bevelEnabled: false });

  // ammo
  G.ammoBody = new RoundedBoxGeometry(0.52, 0.26, 0.3, 2, 0.03);
  G.ammoLid = new THREE.BoxGeometry(0.535, 0.025, 0.315);
  G.ammoPlate = new THREE.BoxGeometry(0.3, 0.09, 0.012);
  G.ammoLatch = new THREE.BoxGeometry(0.045, 0.1, 0.03);
  G.bullet = new THREE.CylinderGeometry(0.022, 0.022, 0.1, 8);
  G.bulletTip = new THREE.ConeGeometry(0.022, 0.05, 8);
  G.bulletTip.translate(0, 0.075, 0);
  G.bulletBand = new THREE.CylinderGeometry(0.024, 0.024, 0.014, 8);

  // grenade crate
  G.grenCrate = new RoundedBoxGeometry(0.5, 0.16, 0.3, 2, 0.025);
  G.grenStripe = new THREE.BoxGeometry(0.34, 0.04, 0.012);
  G.grenade = new THREE.IcosahedronGeometry(0.078, 1);
  G.grenade.scale(1, 1.15, 1);
  G.grenCap = new THREE.CylinderGeometry(0.026, 0.03, 0.035, 8);
  G.grenSpoon = new THREE.BoxGeometry(0.014, 0.075, 0.03);
  G.grenRing = new THREE.TorusGeometry(0.03, 0.006, 5, 10);

  ASSETS = A;
  return A;
}

function beamMaterial(color) {
  const A = assets();
  let m = A.beamMats.get(color);
  if (!m) {
    m = new THREE.MeshBasicMaterial({
      color, vertexColors: true, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending,
      depthWrite: false, side: THREE.DoubleSide,
    });
    A.beamMats.set(color, m);
  }
  return m;
}

function mesh(geo, material, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, material);
  m.position.set(x, y, z);
  return m;
}

// ---------------------------------------------------------------------- prop builders (all return a Group centred on origin)

function buildMedkit(large) {
  const A = assets(), G = A.geo, M = A.mat;
  const g = new THREE.Group();
  g.add(mesh(G.medBase, M.gray, 0, -0.085, 0));
  g.add(mesh(G.medBody, M.white, 0, 0.06, 0));
  for (const z of [0.156, -0.156]) {
    g.add(mesh(G.crossA, M.red, 0, 0.06, z));
    g.add(mesh(G.crossB, M.red, 0, 0.06, z));
  }
  g.add(mesh(G.medHandle, M.gray, 0, 0.225, 0));
  g.add(mesh(G.medPost, M.gray, -0.085, 0.205, 0));
  g.add(mesh(G.medPost, M.gray, 0.085, 0.205, 0));
  for (const x of [-0.16, 0.16]) g.add(mesh(G.medLatch, M.gray, x, 0.0, 0.155));
  g.scale.setScalar(large ? 1.3 : 0.95);
  g.rotation.x = 0.1;
  return g;
}

function buildArmor() {
  const A = assets(), G = A.geo, M = A.mat;
  const g = new THREE.Group();
  g.add(mesh(G.shield, M.blueSteel));
  for (const s of [1, -1]) {
    const rim = mesh(G.shieldRim, M.dark, 0, 0.0, s > 0 ? 0.046 : -0.058);
    g.add(rim);
    const em = mesh(G.shieldEmblem, M.cyan, 0, -0.005, s > 0 ? 0.056 : -0.068);
    g.add(em);
  }
  g.scale.setScalar(1.25);
  return g;
}

function buildAmmo() {
  const A = assets(), G = A.geo, M = A.mat;
  const g = new THREE.Group();
  g.add(mesh(G.ammoBody, M.olive, 0, 0, 0));
  g.add(mesh(G.ammoLid, M.oliveDark, 0, 0.09, 0));
  for (const z of [0.155, -0.155]) g.add(mesh(G.ammoPlate, M.amber, 0, -0.01, z));
  for (const x of [-0.2, 0.2]) for (const z of [0.16, -0.16]) g.add(mesh(G.ammoLatch, M.dark, x, 0.03, z));
  // brass rounds standing on the lid
  for (let i = 0; i < 5; i++) {
    const x = -0.16 + i * 0.08;
    const z = i % 2 ? 0.045 : -0.045;
    g.add(mesh(G.bullet, M.brass, x, 0.155, z));
    g.add(mesh(G.bulletTip, M.copper, x, 0.155, z));
    g.add(mesh(G.bulletBand, M.copper, x, 0.115, z));
  }
  g.scale.setScalar(1.05);
  g.rotation.x = 0.08;
  return g;
}

function buildGrenades() {
  const A = assets(), G = A.geo, M = A.mat;
  const g = new THREE.Group();
  g.add(mesh(G.grenCrate, M.oliveDark, 0, -0.03, 0));
  for (const z of [0.155, -0.155]) g.add(mesh(G.grenStripe, M.red, 0, -0.03, z));
  for (let i = 0; i < 3; i++) {
    const x = -0.15 + i * 0.15;
    const gr = new THREE.Group();
    gr.add(mesh(G.grenade, M.gren, 0, 0, 0));
    gr.add(mesh(G.grenCap, M.gray, 0, 0.1, 0));
    gr.add(mesh(G.grenSpoon, M.gold, 0.03, 0.06, 0));
    const ring = mesh(G.grenRing, M.gold, -0.035, 0.125, 0);
    ring.rotation.y = Math.PI / 2;
    gr.add(ring);
    gr.position.set(x, 0.14, 0);
    gr.rotation.z = (i - 1) * 0.12;
    g.add(gr);
  }
  g.scale.setScalar(1.05);
  return g;
}

function buildPlaceholderWeapon(id) {
  const A = assets();
  const g = new THREE.Group();
  const len = WEAPON_LENGTH[id] || 0.8;
  const key = 'ph_' + id;
  if (!A.geo[key + 'a']) {
    A.geo[key + 'a'] = new THREE.BoxGeometry(0.08, 0.14, len * 0.5);
    A.geo[key + 'b'] = new THREE.BoxGeometry(0.05, 0.05, len);
  }
  g.add(mesh(A.geo[key + 'a'], A.mat.placeholder, 0, 0, 0));
  g.add(mesh(A.geo[key + 'b'], A.mat.dark, 0, 0.05, -len * 0.1));
  return g;
}

