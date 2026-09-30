import * as THREE from 'three';
import { teleport, releaseAll, r2 } from './common.js';
export async function setup(game, report) {
  const R = report.custom = { cases: [] };
  const p = game.player; p.god = true; game.autotest.duration = 1e9; game.state = 'loading';
  const mv = p.move, coll = game.world.collision;
  const DT = 1 / 60;
  for (const x of [-2.5, -1.5, -0.5, 0.3, 1.2, 2.2, 2.8]) {
    teleport(game, x, 0, 18.5, Math.PI, 0);   // yaw pi: forward = +z, toward the ledge at z=20
    releaseAll(game);
    let mantled = false; R.cur = null;
    for (let i = 0; i < 150; i++) {
      const t = i * DT;
      game.input.setVirtual('forward', t > 0.05);
      game.input.setVirtual('jump', t > 0.5 && t < 0.55);
      game.input.update(); game.update(DT); game.input.endFrame();
      if (p.isMantling) mantled = true;
      if (mantled && !p.isMantling && !R.cur) { R.cur = { x, feet: p.position.toArray().map(r2), h: r2(p.height), eyeY: r2(p.position.y + p.eyeHeight), headTop: r2(p.position.y + p.height), st: mv.state }; R.cases.push(R.cur); }
    }
    const ceil = coll.raycast(new THREE.Vector3(p.position.x, p.position.y + 0.02, p.position.z), new THREE.Vector3(0, 1, 0), 3);
    if (false) R.cases.push({ x, mantled, feet: p.position.toArray().map(r2), h: r2(p.height), eyeY: r2(p.position.y + p.eyeHeight), ceilY: ceil ? r2(p.position.y + 0.02 + ceil.distance) : null, state: mv.state });
  }
  releaseAll(game);
  report.done = true;
}
export function drive() {}
