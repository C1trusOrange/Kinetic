// Verifier: swap in a synthetic CollisionWorld (floor top y=1.5, slab bottom y=2.9) and test real uncrouch flow.
import * as THREE from 'three';
import { CollisionWorld } from '../../../../src/world/Collision.js';
import { teleport, releaseAll, r2 } from './common.js';
function boxGeo(min, max) {
  const g = new THREE.BoxGeometry(max[0] - min[0], max[1] - min[1], max[2] - min[2]);
  g.translate((min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2);
  return g;
}
export async function setup(game, report) {
  const R = report.custom = { cases: [] };
  const p = game.player; p.god = true; game.autotest.duration = 1e9; game.state = 'loading';
  const orig = game.world.collision;
  const q = new URLSearchParams(location.search);
  const ceilY = parseFloat(q.get('ceil') || '2.9');
  const cw = new CollisionWorld();
  cw.addGeometry(boxGeo([-30, -3, -30], [30, 1.5, 30]), null, 'concrete');
  cw.addGeometry(boxGeo([-30, ceilY, -30], [30, ceilY + 1.5, 30]), null, 'concrete');
  cw.build();
  game.world.collision = cw;
  const DT = 1 / 60;
  const pts = [];
  for (let x = -3; x <= 3; x += 1.1) for (let z = -3; z <= 3; z += 1.3) pts.push([x, z]);
  let wrong = 0;
  for (const [x, z] of pts) {
    teleport(game, x, 1.5, z, 0, 0);
    releaseAll(game);
    game.input.setVirtual('crouch', true);
    for (let i = 0; i < 40; i++) { game.input.update(); game.update(DT); game.input.endFrame(); }
    const hCrouch = p.height;
    game.input.setVirtual('crouch', false);
    for (let i = 0; i < 40; i++) { game.input.update(); game.update(DT); game.input.endFrame(); }
    const eyeY = p.position.y + p.eyeHeight;
    const stood = p.height > 1.7;
    if (stood) wrong++;
    R.cases.push([x, z, r2(hCrouch), r2(p.height), stood, r2(p.position.y), r2(eyeY)]);
  }
  R.wrongStands = wrong; R.total = pts.length; R.ceilY = ceilY;
  game.world.collision = orig;
  releaseAll(game);
  report.done = true;
}
export function drive() {}
