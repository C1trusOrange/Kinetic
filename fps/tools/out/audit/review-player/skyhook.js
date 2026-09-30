// Grapple onto the invisible boundary volume: does the anchor sit on visible geometry?
import * as THREE from 'three';
import { teleport, releaseAll, r2 } from './common.js';
export async function setup(game, report) {
  const R = report.custom = {};
  const p = game.player; p.god = true;
  game.autotest.duration = 1e9; game.state = 'loading';
  const id = game.world.mapId; R.map = id;
  const cfg = { foundry: { x: 0, y: 0, z: -20, pitch: 0.77 }, sandbox: { x: 0, y: 0, z: 0, pitch: 0.95 }, ruins: { x: 0, y: 0, z: -30, pitch: 0.95 }, skyline: { x: 0, y: 0, z: -25, pitch: 0.75 } }[id];
  teleport(game, cfg.x, cfg.y, cfg.z, 0, cfg.pitch);
  const DT = 1 / 60;
  for (let i = 0; i < 30; i++) {
    game.input.setVirtual('grapple', i > 2 && i < 5);
    game.input.update(); game.update(DT); game.input.endFrame();
    if (p.grapple.attached && !R.att) {
      R.att = true;
      R.anchor = p.grapple.anchor.toArray().map(r2);
      R.eye = p.getEyePosition(new THREE.Vector3()).toArray().map(r2);
      // visible geometry test along the same ray
      const dir = p.getAimDirection(new THREE.Vector3());
      const rc = new THREE.Raycaster(new THREE.Vector3().fromArray(R.eye), dir, 0, 200);
      const objs = [];
      game.scene.traverse(o => { if (o.isMesh && o.visible && !(o.name || '').startsWith('grapple')) objs.push(o); });
      const hits = rc.intersectObjects(objs, false);
      const dAnchor = new THREE.Vector3().fromArray(R.anchor).distanceTo(new THREE.Vector3().fromArray(R.eye));
      R.anchorDist = r2(dAnchor);
      R.firstVisibleHit = hits.length ? { dist: r2(hits[0].distance), obj: hits[0].object.name || hits[0].object.type, y: r2(hits[0].point.y) } : null;
      R.visibleHitsBeforeAnchor = hits.filter(h => h.distance < dAnchor + 0.2).length;
    }
  }
  releaseAll(game);
  report.done = true;
}
export function drive() {}
