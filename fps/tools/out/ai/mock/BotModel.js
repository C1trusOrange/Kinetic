// Light mock of BotModel for AI-only tests.
import * as THREE from 'three';
export class BotModel {
  constructor({ color = 0xff4444 } = {}) {
    this.root = new THREE.Group();
    const m = new THREE.MeshStandardMaterial({ color });
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.6, 1.8, 0.4), m);
    body.position.y = 0.9;
    this.root.add(body);
    this.eye = new THREE.Object3D(); this.eye.position.y = 1.66; this.root.add(this.eye);
    this.weaponSocket = new THREE.Object3D(); this.weaponSocket.position.set(0.25, 1.2, -0.3); this.root.add(this.weaponSocket);
    this.weapon = null;
  }
  setWeapon(w) { if (this.weapon) this.weaponSocket.remove(this.weapon.root); this.weapon = w; this.weaponSocket.add(w.root); }
  getMuzzleWorldPosition(out) { return (this.weapon ? this.weapon.muzzle : this.weaponSocket).getWorldPosition(out); }
  update() {}
  flashHit() {}
  setVisible(v) { this.root.visible = v; }
  breakApart() { return []; }
  dispose() {}
}
