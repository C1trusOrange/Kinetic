import * as THREE from 'three';
import { teleport, releaseAll, r2 } from './common.js';
export async function setup(game, report) {
  const R = report.custom = {};
  const p = game.player;
  game.autotest.duration = 1e9; game.state = 'loading';
  teleport(game, 0, 30, 0, 0, 0);
  p.velocity.set(0, 0, 0);
  for (let i = 0; i < 30; i++) { game.input.update(); game.update(1 / 60); game.input.endFrame(); }
  game.combat.kill(p, { attacker: null, weapon: 'test' });
  const ys = [];
  const alphas = [];
  for (let i = 0; i < 60; i++) {
    game.input.update(); game.update(1 / 240); game.input.endFrame();
    ys.push(game.camera.position.y);
    alphas.push(r2(p._alpha));
  }
  R.alive = p.alive; R.stepDt = null;
  R.deltas = ys.slice(1).map((y, i) => r2(y - ys[i]));
  R.posY = r2(p.position.y);
  report.done = true;
}
export function drive() {}
