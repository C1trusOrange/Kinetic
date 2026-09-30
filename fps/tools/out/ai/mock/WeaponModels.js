// Light mock of WeaponModels for AI-only tests (isolation from parallel work).
import * as THREE from 'three';
const mat = new THREE.MeshStandardMaterial({ color: 0x333840 });
export function createWeaponModel(id) {
  const root = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.1, 0.6), mat);
  body.position.set(0, 0.05, -0.2);
  root.add(body);
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0.07, -0.5);
  root.add(muzzle);
  const sight = new THREE.Object3D();
  root.add(sight);
  return { root, muzzle, sight, ejectPort: null, hip: new THREE.Vector3(), adsDistance: 0.2, parts: {} };
}
export function createGrenadeModel() { return new THREE.Group(); }
export function createRocketModel() { return new THREE.Group(); }
