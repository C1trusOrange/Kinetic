// Mantle onto the boundary wall top: capsule ends up inside the invisible boundary volume and the player walks out of the arena.
import * as THREE from 'three';
import { teleport, releaseAll, r2 } from './common.js';
export async function setup(game, report) {
  const R = report.custom = { log: [] };
  const p = game.player; p.god = true;
  game.autotest.duration = 1e9; game.state = 'loading';
  const coll = game.world.collision;
  const CFG = {
    sandbox: { x: 6.1, y: 7.1, z: -29.6 },
    foundry: { x: 0, y: 13.1, z: -43.0 },
    ruins: { x: 0, y: 21.1, z: -51.0 },
    skyline: { x: 0, y: 12.1, z: -43.0 },
  };
  const id = game.world.mapId; R.map = id;
  const c = CFG[id];
  teleport(game, c.x, c.y, c.z, 0, 0);
  const DT = 1 / 60;
  let mantled = false, settled = false;
  for (let i = 0; i < 420; i++) {
    const t = i * DT;
    game.input.setVirtual('jump', (t > 0.3 && t < 0.33) || (t > 0.62 && t < 0.65));
    game.input.setVirtual('forward', t > 0.3);
    game.input.update(); game.update(DT); game.input.endFrame();
    if (p.move.mantling) mantled = true;
    if (mantled && !p.move.mantling && !settled) {
      settled = true;
      const feet = p.position.clone();
      const up = coll.raycast(feet.clone().add(new THREE.Vector3(0, 0.05, 0)), new THREE.Vector3(0, 1, 0), 4);
      const hit = coll.capsuleIntersect(p.move.capsule);
      R.afterMantle = { t: r2(t), feet: feet.toArray().map(r2), state: p.move.state, capIntersectDepth: hit ? r2(hit.depth) : 0, upRay: up ? { d: r2(up.distance), n: up.normal.toArray().map(r2) } : null, inBounds: game.world.bounds.containsPoint(feet) };
      // what solids cover this point? report solids of the def whose box contains the capsule
      R.solidsHere = game.world.def.solids.filter(s => s.min && s.max && feet.x >= s.min[0] && feet.x <= s.max[0] && feet.y >= s.min[1] - 0.01 && feet.y <= s.max[1] && feet.z >= s.min[2] && feet.z <= s.max[2]).map(s => ({ min: s.min, max: s.max, visible: s.visible !== false }));
    }
    if (i % 30 === 0) R.log.push([r2(t), p.move.state, r2(p.position.x), r2(p.position.y), r2(p.position.z)]);
  }
  R.final = { pos: p.position.toArray().map(r2), alive: p.alive, deaths: p.deaths, inBounds: game.world.bounds.containsPoint(p.position) };
  releaseAll(game);
  report.done = true;
}
export function drive() {}
