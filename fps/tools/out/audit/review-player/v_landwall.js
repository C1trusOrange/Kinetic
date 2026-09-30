// Landing at the foot of a tall wall while moving into it: is the landing impact (sound / dip / speed penalty) lost?
import * as THREE from 'three';
import { teleport, releaseAll, r2 } from './common.js';
export async function setup(game, report) {
  const R = report.custom = { rows: [], missed: 0, total: 0 };
  const p = game.player; p.god = true;
  game.autotest.duration = 1e9; game.state = 'loading';
  const DT = 1 / 60;
  // wall face of testmap: x = 40 (box min x = 40). player radius 0.4 -> contact when center x = 39.6
  for (let x0 = 36.0; x0 <= 39.45; x0 += 0.05) {
    for (const vx of [4, 7, 10]) {
      teleport(game, x0, 3.0, 0, -Math.PI / 2, 0);   // yaw -pi/2 faces +x
      p.velocity.set(vx, 0, 0);
      p.move.grounded = false;
      let landSpeed = null, landT = null;
      const off = game.events.on('player:land', e => { if (landSpeed === null) landSpeed = e.speed; });
      for (let i = 0; i < 60; i++) {
        game.input.setVirtual('forward', true);
        game.input.update(); game.update(DT); game.input.endFrame();
        if (landSpeed !== null) break;
      }
      off();
      R.total++;
      // fall of 3 m -> impact ~ 12 m/s; anything < 8 means the impact was swallowed
      if (landSpeed === null || landSpeed < 8) { R.missed++; if (R.rows.length < 14) R.rows.push({ x0: r2(x0), vx, landSpeed: landSpeed === null ? null : r2(landSpeed), endPos: p.position.toArray().map(r2) }); }
    }
  }
  releaseAll(game);
  report.done = true;
}
export function drive() {}
