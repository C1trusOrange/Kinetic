import * as THREE from 'three';
import { r2 } from './common.js';
export async function setup(game, report) {
  const R = report.custom = { cases: [] };
  const p = game.player; p.god = true; game.autotest.duration = 1e9; game.state = 'loading';
  const coll = game.world.collision;
  for (const [x, y, z] of [[7, 4.5, -29], [-7, 4.5, -27]]) {
    p.spawn(new THREE.Vector3(x, y, z), 0);
    const chest = p.getChestPosition(new THREE.Vector3());
    const from = new THREE.Vector3(x, 5.5, -18);
    const dir = chest.clone().sub(from).normalize();
    const hit = game.combat.raycast(from, dir, 60, null);
    const down = coll.raycast(new THREE.Vector3(x, 9, z), new THREE.Vector3(0, -1, 0), 10);
    R.cases.push({ spawn: [x, y, z], roofBelow: down ? { y: r2(down.point.y), surface: down.surface } : null, shotFromArena: { hitEntity: hit && hit.entity ? 'PLAYER' : null, dist: hit ? r2(hit.distance) : null, toChest: r2(from.distanceTo(chest)) }, canSee: game.combat.canSee(from, chest) });
  }
  report.done = true;
}
export function drive() {}
