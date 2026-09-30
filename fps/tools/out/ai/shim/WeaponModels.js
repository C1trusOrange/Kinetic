// Scratch shim (AI engineer): real WeaponModels where available, placeholder boxes for weapons not written yet.
import * as THREE from 'three';
import * as real from '/src/weapons/WeaponModels.js?real=1';

const mat = new THREE.MeshStandardMaterial({ color: 0x3a4048, roughness: 0.5, metalness: 0.6 });
const LEN = { pistol: 0.32, rifle: 0.8, shotgun: 0.95, sniper: 1.15, rocket: 0.9 };

function mock(id, view) {
  const len = LEN[id] || 0.7;
  const root = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.12, len), mat);
  body.position.set(0, 0.04, -len * 0.4);
  root.add(body);
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0.06, -len * 0.95);
  root.add(muzzle);
  const sight = new THREE.Object3D();
  sight.position.set(0, 0.12, -0.05);
  root.add(sight);
  const hand = () => new THREE.Object3D();
  const parts = { mag: hand(), slide: hand(), bolt: hand(), pump: hand(), trigger: hand(), leftHand: hand(), rightHand: hand(), leftArm: hand(), rightArm: hand() };
  for (const k in parts) root.add(parts[k]);
  return { root, muzzle, sight, ejectPort: null, hip: new THREE.Vector3(0.17, -0.2, -0.42), adsDistance: 0.2, parts, id, view, triangles: 12, mocked: true };
}

export function createWeaponModel(id, opts = {}) {
  try {
    return real.createWeaponModel(id, opts);
  } catch (e) {
    return mock(id, !!opts.view);
  }
}
export const createGrenadeModel = real.createGrenadeModel;
export const createRocketModel = real.createRocketModel;
