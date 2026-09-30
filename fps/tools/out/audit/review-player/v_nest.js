// After mantling onto the sandbox boundary wall top: is the player hittable from inside the arena? Can the player shoot out?
import * as THREE from 'three';
import { teleport, releaseAll, r2 } from './common.js';
export async function setup(game, report) {
  const R = report.custom = {};
  const p = game.player; p.god = true;
  game.autotest.duration = 1e9; game.state = 'loading';
  const coll = game.world.collision;
  teleport(game, 6.1, 7.1, -29.6, 0, 0);
  const DT = 1 / 60;
  let mantled = false;
  for (let i = 0; i < 90; i++) {
    const t = i * DT;
    game.input.setVirtual('jump', (t > 0.3 && t < 0.33) || (t > 0.62 && t < 0.65));
    game.input.setVirtual('forward', t > 0.3);
    game.input.update(); game.update(DT); game.input.endFrame();
    if (p.move.mantling) mantled = true;
    if (mantled && !p.move.mantling) break;
  }
  releaseAll(game);
  for (let i = 0; i < 10; i++) { game.input.update(); game.update(DT); game.input.endFrame(); }
  R.feet = p.position.toArray().map(r2); R.state = p.move.state;
  // shots from the arena towards the player's chest / head
  const chest = p.getChestPosition(new THREE.Vector3());
  const tests = [];
  for (const [name, from] of [['arena_low', new THREE.Vector3(chest.x, 10.5, -10)], ['arena_high', new THREE.Vector3(chest.x, 25, -5)], ['arena_ground', new THREE.Vector3(chest.x, 1.7, -20)], ['above', new THREE.Vector3(chest.x, 40, -31.5)]]) {
    const dir = chest.clone().sub(from).normalize();
    const hit = game.combat.raycast(from, dir, 80, null);
    tests.push({ name, from: from.toArray().map(r2), hitEntity: hit && hit.entity ? (hit.entity.isPlayer ? 'PLAYER' : 'bot') : null, hitDist: hit ? r2(hit.distance) : null, dist: r2(from.distanceTo(chest)), canSee: game.combat.canSee(from, chest) });
  }
  R.shotsAtPlayer = tests;
  // player shooting out into the arena
  const eye = p.getEyePosition(new THREE.Vector3());
  const outDir = new THREE.Vector3(0.0, -0.05, 1).normalize();
  const out = game.combat.raycast(eye, outDir, 80, p);
  R.playerShootsOut = out ? { dist: r2(out.distance), surface: out.surface, point: out.point.toArray().map(r2) } : null;
  R.canSeeOut = game.combat.canSee(eye, new THREE.Vector3(eye.x, 1.7, -10));
  report.done = true;
}
export function drive() {}
