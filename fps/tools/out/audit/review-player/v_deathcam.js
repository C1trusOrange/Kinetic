// Death cam smoothness: corpse falls at up to 55 m/s; the corpse physics steps at 60 Hz, camera is rendered every frame (240 fps here).
import * as THREE from 'three';
import { teleport, releaseAll, r2 } from './common.js';
export async function setup(game, report) {
  const R = report.custom = {};
  const p = game.player; p.god = false;
  game.autotest.duration = 1e9; game.state = 'loading';
  const DT = 1 / 240;
  teleport(game, 0, 30, 0, 0, 0);
  p.velocity.set(0, -30, 0);
  for (let i = 0; i < 30; i++) { game.input.update(); game.update(DT); game.input.endFrame(); }
  game.combat.kill(p, { attacker: null, weapon: 'fall' });
  const ys = [];
  for (let i = 0; i < 48; i++) {
    game.input.update(); game.update(DT); game.input.endFrame();
    ys.push(r2(game.camera.position.y * 100) / 100);
  }
  R.camY = ys;
  const d = []; for (let i = 1; i < ys.length; i++) d.push(r2(ys[i - 1] - ys[i]));
  R.deltaPerFrame = d;
  R.playerY = r2(p.position.y);
  report.done = true;
}
export function drive() {}
