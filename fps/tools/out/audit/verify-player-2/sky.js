import * as THREE from 'three';
import { teleport, releaseAll, r2 } from './common.js';
export async function setup(game, report) {
  const R = report.custom = { log: [] };
  const p = game.player; p.god = true; game.autotest.duration = 1e9; game.state = 'loading';
  const q = new URLSearchParams(location.search);
  const pitch = parseFloat(q.get('pitch') || '0.77');
  teleport(game, 0, 0, -20, 0, pitch);
  const DT = 1 / 60;
  let attachedAt = null;
  for (let i = 0; i < 100; i++) {
    const t = i * DT;
    game.input.setVirtual('grapple', t > 0.1 && t < 0.15);
    game.input.update(); game.update(DT); game.input.endFrame();
    if (p.grapple.attached && attachedAt === null) {
      attachedAt = i;
      const a = p.grapple.anchor;
      R.anchor = a.toArray().map(r2);
      R.anchorDist = r2(a.distanceTo(p.getEyePosition(new THREE.Vector3())));
      // what is at the anchor? raycast visible meshes (three.js Raycaster) along the same ray
      const eye = p.getEyePosition(new THREE.Vector3()); const dir = a.clone().sub(eye).normalize();
      const rc = new THREE.Raycaster(eye, dir, 0, 60); rc.camera = game.camera;
      const hits = rc.intersectObjects(game.scene.children, true).filter(h => h.object.visible && !(h.object.name || '').startsWith('grapple') && !(h.object.parent && (h.object.parent.name || '').startsWith('grapple')));
      R.firstVisibleHit = hits.length ? { d: r2(hits[0].distance), name: hits[0].object.name, type: hits[0].object.type } : null;
    }
    if (i % 12 === 0) R.log.push([r2(t), p.move.state + '/' + p.grapple.state, r2(p.position.y), r2(p.position.z)].join(' '));
  }
  R.hangY = r2(p.position.y);
  report.done = true;
}
export function drive() {}
