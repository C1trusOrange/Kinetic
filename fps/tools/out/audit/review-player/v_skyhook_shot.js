// Grapple at the sky near the boundary: does the hook attach to invisible collision geometry? Keep it attached for a screenshot.
import * as THREE from 'three';
import { teleport, r2 } from './common.js';
let phase = 0, t0 = 0;
export async function setup(game, report) {
  report.custom = {};
  game.player.god = true;
  game.autotest.duration = 6;
}
export function drive(t, dt, game, report) {
  const R = report.custom, p = game.player;
  if (phase === 0 && t > 0.5) {
    phase = 1; t0 = t;
    const id = game.world.mapId;
    const cfg = { foundry: { x: 0, y: 0, z: -20, pitch: 0.77 }, sandbox: { x: 0, y: 0, z: 0, pitch: 0.95 }, ruins: { x: 0, y: 0, z: -30, pitch: 0.95 }, skyline: { x: 0, y: 0, z: -25, pitch: 0.75 } }[id];
    teleport(game, cfg.x, cfg.y, cfg.z, 0, cfg.pitch);
  }
  if (phase === 1) {
    const lt = t - t0;
    game.input.setVirtual('grapple', lt > 0.1 && lt < 0.15);
    if (p.grapple.attached && !R.att) {
      R.att = true;
      R.anchor = p.grapple.anchor.toArray().map(r2);
      const eye = p.getEyePosition(new THREE.Vector3());
      const dir = p.getAimDirection(new THREE.Vector3());
      const rc = new THREE.Raycaster(eye, dir, 0, 200);
      const objs = [];
      game.scene.traverse(o => { if (o.isMesh && o.visible && !(o.name || '').startsWith('grapple')) objs.push(o); });
      const hits = rc.intersectObjects(objs, false);
      R.anchorDist = r2(p.grapple.anchor.distanceTo(eye));
      R.visibleHitBeforeAnchor = hits.filter(h => h.distance < R.anchorDist + 0.3).length;
      R.firstVisible = hits.length ? { d: r2(hits[0].distance), y: r2(hits[0].point.y) } : null;
    }
    // freeze the player in place so the screenshot shows the hook in the sky
    if (p.grapple.attached && lt > 0.9) { p.velocity.set(0, 0, 0); p.grapple.time = 0; }
  }
}
