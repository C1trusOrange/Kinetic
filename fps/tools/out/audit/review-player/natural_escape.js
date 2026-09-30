// Natural repro: grapple to just below the boundary wall top, hold forward -> auto mantle -> walk off the arena.
import * as THREE from 'three';
import { teleport, releaseAll, r2 } from './common.js';
export async function setup(game, report) {
  const R = report.custom = { log: [] };
  const p = game.player; p.god = true;
  game.autotest.duration = 1e9; game.state = 'loading';
  teleport(game, 6.1, 7.1, -29.6, 0, 0.0);
  const DT = 1 / 60;
  let lastState = '';
  for (let i = 0; i < 420; i++) {
    const t = i * DT;
    game.input.setVirtual('jump', (t > 0.3 && t < 0.33) || (t > 0.62 && t < 0.65));
    game.input.setVirtual('forward', t > 0.3);
    game.input.update(); game.update(DT); game.input.endFrame();
    const st = p.move.state + '/' + p.grapple.state;
    if (st !== lastState || i % 60 === 0) { R.log.push([r2(t), st, r2(p.position.x), r2(p.position.y), r2(p.position.z)]); lastState = st; }
    if (t > 0.2 && !R.anchor && p.grapple.attached) R.anchor = p.grapple.anchor.toArray().map(r2);
  }
  R.final = { pos: [r2(p.position.x), r2(p.position.y), r2(p.position.z)], alive: p.alive, inBounds: game.world.bounds.containsPoint(p.position), deaths: p.deaths };
  releaseAll(game);
  report.done = true;
}
export function drive() {}
