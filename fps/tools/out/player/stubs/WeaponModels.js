// Test-only stand-in for src/weapons/WeaponModels.js (used through the harness import map).
import * as THREE from 'three';

const mat = new THREE.MeshStandardMaterial({ color: 0x555a63, metalness: 0.8, roughness: 0.4 });
const skin = new THREE.MeshStandardMaterial({ color: 0x2d3b52, roughness: 0.8 });

export function createWeaponModel(id, { view = false } = {}) {
  const root = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.09, 0.5), mat);
  body.position.set(0, 0.02, -0.15);
  root.add(body);
  const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, 0.3), mat);
  barrel.position.set(0, 0.03, -0.5);
  root.add(barrel);
  const muzzle = new THREE.Object3D(); muzzle.position.set(0, 0.03, -0.66); root.add(muzzle);
  const sight = new THREE.Object3D(); sight.position.set(0, 0.09, -0.2); root.add(sight);
  const ejectPort = new THREE.Object3D(); ejectPort.position.set(0.04, 0.05, -0.1); root.add(ejectPort);
  const parts = {};
  for (const k of ['mag', 'slide', 'bolt', 'pump', 'trigger', 'leftHand', 'rightHand', 'leftArm', 'rightArm']) {
    const o = new THREE.Object3D(); root.add(o); parts[k] = o;
  }
  if (view) {
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.09, 0.5), skin);
    arm.position.set(0.05, -0.08, 0.2); root.add(arm);
  }
  return { root, muzzle, sight, ejectPort, hip: new THREE.Vector3(0.17, -0.2, -0.42), adsDistance: 0.2, parts };
}
export function createGrenadeModel() { return new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), mat); }
export function createRocketModel() { return new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.6, 8), mat); }
