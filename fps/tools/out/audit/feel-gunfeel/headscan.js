// Which hitbox part does a zero-spread ray register when aimed at different heights on a standing dummy?
import * as THREE from 'three';
import { Entity } from '/src/core/Entity.js';

export async function setup(game, report) {
  const out = report.custom = { front: {}, side45: {} };
  const dummy = new Entity(game);
  dummy.alive = true; dummy.id = 998; dummy.team = 998;
  game.entities.push(dummy);
  const realRay = game.world.raycast.bind(game.world);
  game.world.raycast = () => null;
  const eye = new THREE.Vector3(0, 1.66, 0);
  const dir = new THREE.Vector3();
  for (const dist of [10, 30]) {
    dummy.position.set(0, 0, -dist);
    dummy.height = 1.8;
    out.front[dist] = {};
    for (let y = 0.2; y <= 1.9; y += 0.05) {
      dir.set(0, y - 1.66, -dist).normalize();
      const h = game.combat.raycast(eye, dir, 300, null);
      out.front[dist][y.toFixed(2)] = h && h.entity ? h.part : '-';
    }
  }
  // lateral offset scan at head height (how far off-center in x still registers head)
  dummy.position.set(0, 0, -15);
  out.lateralAtHead = {};
  for (let x = -0.4; x <= 0.401; x += 0.05) {
    dir.set(x, 1.62 - 1.66, -15).normalize();
    const h = game.combat.raycast(eye, dir, 300, null);
    out.lateralAtHead[x.toFixed(2)] = h && h.entity ? h.part : '-';
  }
  game.world.raycast = realRay;
  game.entities.splice(game.entities.indexOf(dummy), 1);
  game.autotest.duration = 0.5;
}
export function drive() {}
export function finish() {}
