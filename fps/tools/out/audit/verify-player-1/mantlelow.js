import * as THREE from 'three';
import { teleport, releaseAll, r2 } from './common.js';
export async function setup(game, report) {
  const R = report.custom = { cases: [] };
  const p = game.player; p.god = true;
  game.autotest.duration = 1e9; game.state = 'loading';
  const mv = p.move, coll = game.world.collision;
  const DT = 1 / 60;
  for (const x of [0, -1, 1, 2, -2]) {
    teleport(game, x, 0, 18.4, Math.PI, 0);
    let mantled = false, minState = [];
    for (let i = 0; i < 120; i++) {
      const t = i * DT;
      game.input.setVirtual('forward', t > 0.1);
      game.input.setVirtual('jump', t > 0.1 && t < 0.15);
      game.input.update(); game.update(DT); game.input.endFrame();
      if (mv.mantling) mantled = true;
    }
    const feet = p.position.clone();
    const ceil = coll.raycast(new THREE.Vector3(feet.x, feet.y + 0.02, feet.z), new THREE.Vector3(0, 1, 0), 3);
    R.cases.push({ x, mantled, feet: feet.toArray().map(r2), h: r2(p.height), eyeY: r2(feet.y + p.eyeHeight), ceilingY: ceil ? r2(feet.y + ceil.distance) : null, state: mv.state });
    releaseAll(game);
    for (let i = 0; i < 10; i++) { game.input.update(); game.update(DT); game.input.endFrame(); }
  }
  report.done = true;
}
export function drive() {}
