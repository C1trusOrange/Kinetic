// Stand-in for src/weapons/WeaponModels.js used by the weapons test harness (same contract, simple boxes).
import * as THREE from 'three';

const M = {
  gun: new THREE.MeshStandardMaterial({ color: 0x3b4048, metalness: 0.85, roughness: 0.35 }),
  dark: new THREE.MeshStandardMaterial({ color: 0x1c1e22, metalness: 0.6, roughness: 0.5 }),
  poly: new THREE.MeshStandardMaterial({ color: 0x2b2e33, metalness: 0.1, roughness: 0.8 }),
  wood: new THREE.MeshStandardMaterial({ color: 0x7a4a26, metalness: 0.0, roughness: 0.7 }),
  sleeve: new THREE.MeshStandardMaterial({ color: 0x2b3542, metalness: 0.1, roughness: 0.85 }),
  glove: new THREE.MeshStandardMaterial({ color: 0x16181c, metalness: 0.2, roughness: 0.6 }),
  accent: new THREE.MeshStandardMaterial({ color: 0x102030, emissive: 0x3de0ff, emissiveIntensity: 1.5 }),
  rocket: new THREE.MeshStandardMaterial({ color: 0x8c9098, metalness: 0.7, roughness: 0.4 }),
  glow: new THREE.MeshBasicMaterial({ color: 0xff9a3c }),
};

function box(parent, w, h, d, x, y, z, mat = M.gun, rx = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.rotation.x = rx;
  parent.add(m);
  return m;
}
function cyl(parent, r, len, x, y, z, mat = M.gun, seg = 10) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, seg).rotateX(Math.PI / 2), mat);
  m.position.set(x, y, z);
  parent.add(m);
  return m;
}
function group(parent, x, y, z) { const g = new THREE.Group(); g.position.set(x, y, z); parent.add(g); return g; }

const CFG = {
  pistol: { hip: [0.16, -0.17, -0.36], ads: 0.24, hand: [0, -0.03, -0.02], left: [0.0, -0.09, 0.02] },
  rifle: { hip: [0.17, -0.2, -0.42], ads: 0.22, hand: [0, -0.06, 0.02], left: [0.0, -0.05, -0.34] },
  shotgun: { hip: [0.18, -0.21, -0.44], ads: 0.24, hand: [0, -0.06, 0.02], left: [0.0, -0.05, -0.36] },
  sniper: { hip: [0.18, -0.21, -0.44], ads: 0.26, hand: [0, -0.06, 0.02], left: [0.0, -0.05, -0.38] },
  rocket: { hip: [0.2, -0.24, -0.42], ads: 0.24, hand: [0, -0.06, 0.02], left: [0.0, -0.04, -0.38] },
};

export function createWeaponModel(id, { view = false } = {}) {
  const c = CFG[id];
  const root = new THREE.Group();
  const parts = {};
  let muzzleZ = -0.5, sightY = 0.1, sightZ = -0.1;
  if (id === 'pistol') {
    const slide = group(root, 0, 0.045, -0.06); box(slide, 0.03, 0.036, 0.2, 0, 0, 0, M.gun); parts.slide = slide;
    box(root, 0.028, 0.04, 0.18, 0, 0.01, -0.06, M.dark);
    box(root, 0.03, 0.11, 0.045, 0, -0.06, 0.03, M.poly, 0.15);
    const mag = group(root, 0, -0.1, 0.035); box(mag, 0.026, 0.07, 0.035, 0, 0, 0, M.dark); parts.mag = mag;
    box(root, 0.006, 0.014, 0.01, 0, 0.073, -0.15, M.gun); box(root, 0.02, 0.012, 0.012, 0, 0.07, 0.02, M.gun);
    parts.trigger = group(root, 0, -0.01, -0.02); box(parts.trigger, 0.008, 0.026, 0.008, 0, -0.012, 0, M.dark);
    muzzleZ = -0.17; sightY = 0.075; sightZ = -0.02;
  } else if (id === 'rifle') {
    box(root, 0.05, 0.075, 0.42, 0, 0.02, -0.16, M.gun);
    box(root, 0.045, 0.06, 0.3, 0, 0.0, -0.5, M.poly);
    cyl(root, 0.012, 0.35, 0, 0.03, -0.72, M.dark);
    box(root, 0.04, 0.09, 0.22, 0, -0.005, 0.2, M.poly);
    const mag = group(root, 0, -0.1, -0.08); box(mag, 0.03, 0.14, 0.06, 0, -0.02, 0, M.dark, 0.1); parts.mag = mag;
    const bolt = group(root, 0.03, 0.03, -0.06); box(bolt, 0.012, 0.02, 0.04, 0, 0, 0, M.dark); parts.bolt = bolt;
    box(root, 0.035, 0.09, 0.05, 0, -0.08, 0.06, M.poly, 0.3);
    box(root, 0.04, 0.035, 0.09, 0, 0.078, -0.15, M.dark); box(root, 0.036, 0.03, 0.005, 0, 0.09, -0.195, M.accent);
    box(root, 0.02, 0.02, 0.05, 0.03, 0.01, -0.53, M.dark);
    parts.trigger = group(root, 0, -0.03, -0.03);
    muzzleZ = -0.9; sightY = 0.11; sightZ = -0.12;
  } else if (id === 'shotgun') {
    box(root, 0.055, 0.075, 0.34, 0, 0.02, -0.12, M.gun);
    cyl(root, 0.017, 0.62, 0, 0.035, -0.5, M.dark); cyl(root, 0.017, 0.5, 0, -0.008, -0.45, M.dark);
    box(root, 0.05, 0.08, 0.3, 0, -0.01, 0.25, M.wood);
    const pump = group(root, 0, -0.008, -0.36); box(pump, 0.06, 0.05, 0.17, 0, 0, 0, M.wood); parts.pump = pump;
    box(root, 0.035, 0.09, 0.05, 0, -0.08, 0.05, M.poly, 0.3);
    box(root, 0.008, 0.012, 0.01, 0, 0.078, -0.78, M.gun); box(root, 0.02, 0.012, 0.012, 0, 0.065, -0.1, M.gun);
    parts.trigger = group(root, 0, -0.03, -0.02);
    muzzleZ = -0.82; sightY = 0.09; sightZ = -0.5;
  } else if (id === 'sniper') {
    box(root, 0.05, 0.08, 0.5, 0, 0.02, -0.2, M.gun);
    cyl(root, 0.013, 0.5, 0, 0.03, -0.72, M.dark);
    box(root, 0.045, 0.1, 0.32, 0, -0.01, 0.28, M.poly);
    cyl(root, 0.03, 0.3, 0, 0.115, -0.2, M.dark, 14); box(root, 0.02, 0.05, 0.02, 0, 0.09, -0.3, M.gun); box(root, 0.02, 0.05, 0.02, 0, 0.09, -0.08, M.gun);
    const bolt = group(root, 0.03, 0.03, -0.04); box(bolt, 0.05, 0.012, 0.012, 0.03, 0, 0, M.gun); box(bolt, 0.02, 0.02, 0.02, 0.06, 0.0, 0, M.dark); parts.bolt = bolt;
    const mag = group(root, 0, -0.07, -0.1); box(mag, 0.03, 0.08, 0.07, 0, 0, 0, M.dark); parts.mag = mag;
    box(root, 0.035, 0.09, 0.05, 0, -0.08, 0.08, M.poly, 0.3);
    parts.trigger = group(root, 0, -0.03, -0.03);
    muzzleZ = -0.98; sightY = 0.115; sightZ = -0.2;
  } else {
    cyl(root, 0.075, 0.95, 0, 0.06, -0.3, M.rocket, 14); cyl(root, 0.09, 0.12, 0, 0.06, -0.8, M.dark, 14);
    box(root, 0.04, 0.05, 0.16, 0, 0.16, -0.22, M.dark); box(root, 0.035, 0.09, 0.05, 0, -0.03, 0.02, M.poly, 0.3);
    cyl(root, 0.02, 0.2, 0, -0.03, -0.32, M.dark);
    const mag = group(root, 0, 0.06, -0.72); cyl(mag, 0.055, 0.2, 0, 0, 0, M.glow); parts.mag = mag;
    box(root, 0.006, 0.03, 0.006, 0, 0.19, -0.7, M.gun);
    parts.trigger = group(root, 0, -0.04, -0.02);
    muzzleZ = -0.87; sightY = 0.19; sightZ = -0.4;
  }
  const muzzle = new THREE.Object3D(); muzzle.position.set(0, id === 'pistol' ? 0.05 : 0.035, muzzleZ); root.add(muzzle);
  const sight = new THREE.Object3D(); sight.position.set(0, sightY, sightZ); root.add(sight);
  const ejectPort = new THREE.Object3D(); ejectPort.position.set(0.03, 0.05, id === 'pistol' ? -0.05 : -0.1); root.add(ejectPort);
  if (view) {
    const rh = group(root, c.hand[0], c.hand[1], c.hand[2]); box(rh, 0.075, 0.09, 0.1, 0, 0, 0, M.glove); parts.rightHand = rh;
    const ra = group(root, 0.03, -0.11, 0.3); box(ra, 0.08, 0.075, 0.55, 0, 0, 0, M.sleeve); ra.rotation.x = -0.3; ra.rotation.y = -0.15; parts.rightArm = ra;
    const lh = group(root, c.left[0], c.left[1], c.left[2]); box(lh, 0.08, 0.06, 0.11, 0, 0, 0, M.glove); box(lh, 0.07, 0.02, 0.05, 0, 0.03, -0.02, M.gun); parts.leftHand = lh;
    const la = group(root, c.left[0] - 0.05, c.left[1] - 0.09, c.left[2] + 0.28); box(la, 0.085, 0.075, 0.55, 0, 0, 0, M.sleeve); la.rotation.x = -0.3; la.rotation.y = 0.35; parts.leftArm = la;
  }
  return { root, muzzle, sight, ejectPort, hip: new THREE.Vector3().fromArray(c.hip), adsDistance: c.ads, parts, id, view };
}

export function createGrenadeModel() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.045, 10, 8), new THREE.MeshStandardMaterial({ color: 0x4a5a3a, roughness: 0.5, metalness: 0.5 }));
  g.add(body);
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.03, 8), M.dark);
  cap.position.y = 0.05;
  g.add(cap);
  return g;
}

export function createRocketModel() {
  const g = new THREE.Group();
  g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.5, 10).rotateX(Math.PI / 2), M.rocket));
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.14, 10).rotateX(-Math.PI / 2), M.dark);
  nose.position.z = -0.32; g.add(nose);
  const tail = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), M.glow); tail.position.z = 0.27; g.add(tail);
  return g;
}
