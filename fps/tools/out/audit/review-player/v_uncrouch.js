// Crouch under a low ceiling (headroom 1.25-1.3 m) then release crouch: player must stay crouched.
import * as THREE from 'three';
import { teleport, releaseAll, r2 } from './common.js';
export async function setup(game, report) {
  const R = report.custom = { map: game.world.mapId, cases: [] };
  const p = game.player; p.god = true;
  game.autotest.duration = 1e9; game.state = 'loading';
  const mv = p.move, coll = game.world.collision;
  const DT = 1 / 60;
  const spots = [[-1.25, 20.1, 0.25], [-0.5, 20.1, 0.25], [0.25, 20.1, -1.25], [0.25, 20.1, -0.5], [0.25, 20.1, 0.25], [10, 0, 17.5]];
  for (const [x, y, z] of spots) {
    // start crouched on the spot
    teleport(game, x, y, z, 0, 0);
    for (let i = 0; i < 30; i++) { game.input.setVirtual('crouch', true); game.input.update(); game.update(DT); game.input.endFrame(); }
    const before = { crouched: mv.crouched, h: r2(p.height) };
    for (let i = 0; i < 40; i++) { game.input.setVirtual('crouch', false); game.input.update(); game.update(DT); game.input.endFrame(); }
    const hit = coll.capsuleIntersect(mv.capsule);
    const feet = p.position.clone();
    const upRay = coll.raycast(new THREE.Vector3(feet.x, feet.y + 0.02, feet.z), new THREE.Vector3(0, 1, 0), 3);
    R.cases.push({ at: [x, y, z], before, after: { crouched: mv.crouched, h: r2(p.height), eyeH: r2(p.eyeHeight), feetY: r2(feet.y), capIntersectDepth: hit ? r2(hit.depth) : 0, headroom: upRay ? r2(upRay.distance) : null, state: mv.state } });
  }
  releaseAll(game);
  report.done = true;
}
export function drive() {}
