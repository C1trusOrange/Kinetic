/**
 * Lightweight grapple rope + claw for another player's avatar (net/Avatar.js): one thin tube stretched between the
 * avatar's hand and the hook, thickened with distance so it stays readable far away, and a small claw at the end.
 * The local player's own rope stays player/Grapple.js.
 */
import * as THREE from 'three';

const _a = new THREE.Vector3();
const _q = new THREE.Quaternion();
const NEG_Z = new THREE.Vector3(0, 0, -1);

let _shared = null;
function shared() {
  if (_shared) return _shared;
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 4;
  const g = c.getContext('2d');
  g.fillStyle = '#2aa8d8';
  g.fillRect(0, 0, 64, 4);
  g.fillStyle = 'rgba(210,250,255,0.9)';
  g.fillRect(40, 0, 12, 4);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  const ropeGeo = new THREE.CylinderGeometry(1, 1, 1, 6, 1, true);
  ropeGeo.translate(0, 0.5, 0);
  ropeGeo.rotateX(-Math.PI / 2);    // along -Z, from 0 to -1
  const clawGeo = new THREE.ConeGeometry(0.05, 0.16, 6, 1);
  clawGeo.rotateX(-Math.PI / 2);
  _shared = {
    tex,
    ropeGeo,
    clawGeo,
    ropeMat: new THREE.MeshBasicMaterial({ map: tex, color: new THREE.Color(1.5, 2.1, 2.6) }),
    clawMat: new THREE.MeshStandardMaterial({ color: 0x9aa7b4, metalness: 0.8, roughness: 0.35 }),
  };
  return _shared;
}

export class AvatarRope {
  /** @param {object} game */
  constructor(game) {
    this.game = game;
    const s = shared();
    this.group = new THREE.Group();
    this.group.name = 'avatar-rope';
    this.rope = new THREE.Mesh(s.ropeGeo, s.ropeMat);
    this.rope.frustumCulled = false;
    this.claw = new THREE.Mesh(s.clawGeo, s.clawMat);
    this.group.add(this.rope, this.claw);
    this.group.visible = false;
    game.scene.add(this.group);
  }

  /**
   * Show the rope from `from` (hand) to `to` (hook / anchor).
   * @param {THREE.Vector3} from @param {THREE.Vector3} to
   */
  show(from, to) {
    _a.subVectors(to, from);
    const len = _a.length();
    if (len < 0.05) { this.hide(); return; }
    this.group.visible = true;
    _a.multiplyScalar(1 / len);
    _q.setFromUnitVectors(NEG_Z, _a);
    const cam = this.game.camera.position;
    const r = 0.006 + from.distanceTo(cam) * 0.0009;
    this.rope.position.copy(from);
    this.rope.quaternion.copy(_q);
    this.rope.scale.set(r, r, len);
    this.claw.position.copy(to);
    this.claw.quaternion.copy(_q);
    this.claw.scale.setScalar(1 + Math.min(60, to.distanceTo(cam)) / 14);
  }

  hide() {
    this.group.visible = false;
  }

  dispose() {
    if (this.group.parent) this.group.parent.remove(this.group);
    this.group.clear();
  }
}
