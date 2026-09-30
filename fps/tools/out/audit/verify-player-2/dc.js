import * as THREE from 'three';
import { teleport, releaseAll, r2 } from './common.js';
export async function setup(game, report) {
  const R = report.custom = { deltas: [] };
  const p = game.player; game.autotest.duration = 1e9; game.state = 'loading';
  const q = new URLSearchParams(location.search);
  const hz = parseFloat(q.get('hz') || '240');
  const DT = 1 / hz;
  teleport(game, 0, 0, 0, 0, 0);
  p.move.place(new THREE.Vector3(0, 40, 0));
  p.prevPosition.copy(p.position);
  p.velocity.set(0, 0, 0);
  for (let i = 0; i < 20; i++) { game.input.update(); game.update(DT); game.input.endFrame(); }
  game.combat.kill(p, { attacker: null, weapon: 'fall', headshot: false, point: p.position.clone(), direction: new THREE.Vector3(0, 0, 0) });
  R.alive = p.alive;
  let last = game.camera.position.y;
  for (let i = 0; i < 90; i++) {
    game.input.update(); game.update(DT); game.input.endFrame();
    const y = game.camera.position.y;
    R.deltas.push(r2(last - y)); last = y;
  }
  report.done = true;
}
export function drive() {}
