// testmap4: ledge top y=1.5, slab bottom at y=2.9 (1.4 m headroom). Crouch on the ledge, release crouch: must stay crouched.
import * as THREE from 'three';
import { teleport, releaseAll, r2 } from './common.js';
export async function setup(game, report) {
  const R = report.custom = { cases: [] };
  const p = game.player; p.god = true;
  game.autotest.duration = 1e9; game.state = 'loading';
  const mv = p.move, coll = game.world.collision;
  const DT = 1 / 60;
  for (const [x, z] of [[0, 22], [-1, 22.5], [2, 24], [0.5, 23], [1, 22.5], [-2, 24]]) {
    teleport(game, x, 1.5, z, 0, 0);
    for (let i = 0; i < 30; i++) { game.input.setVirtual('crouch', true); game.input.update(); game.update(DT); game.input.endFrame(); }
    const before = { crouched: mv.crouched, h: r2(p.height) };
    for (let i = 0; i < 40; i++) { game.input.setVirtual('crouch', false); game.input.update(); game.update(DT); game.input.endFrame(); }
    const feet = p.position.clone();
    const ceil = coll.raycast(new THREE.Vector3(feet.x, feet.y + 0.02, feet.z), new THREE.Vector3(0, 1, 0), 3);
    R.cases.push({ at: [x, 1.5, z], before, after: { crouched: mv.crouched, h: r2(p.height), eyeY: r2(feet.y + p.eyeHeight), headroom: ceil ? r2(ceil.distance) : null, ceilingY: ceil ? r2(feet.y + ceil.distance) : null } });
  }
  releaseAll(game);
  report.done = true;
}
export function drive() {}
