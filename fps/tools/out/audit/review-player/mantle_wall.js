// Mantle onto the boundary wall top -> does the player end up inside the invisible boundary volume / outside the arena?
import * as THREE from 'three';
import { teleport, keys, releaseAll, r2, hs } from './common.js';

const P = new URLSearchParams(location.search);
const CFG = {
  sandbox: { x: 0, y: 8.6, z: -30.55, yaw: 0, top: 10 },
  foundry: { x: 0, y: 14.6, z: -43.55, yaw: 0, top: 16 },
  ruins: { x: 0, y: 22.6, z: -51.55, yaw: 0, top: 24 },
  skyline: { x: 0, y: 13.6, z: -43.55, yaw: 0, top: 15 },
};

export async function setup(game, report) {
  const R = report.custom = {};
  const p = game.player;
  p.god = true;
  game.autotest.duration = 1e9;
  game.state = 'loading';
  const id = game.world.mapId;
  const c = CFG[id];
  R.map = id;
  teleport(game, c.x, c.y, c.z, c.yaw, 0);
  p.velocity.set(0, 0, 0);
  const log = [];
  const DT = 1 / 60;
  for (let i = 0; i < 240; i++) {
    game.input.setVirtual('forward', true);
    game.input.update(); game.update(DT); game.input.endFrame();
    if (i % 6 === 0 || p.move.mantling) log.push([r2(game.time), r2(p.position.x), r2(p.position.y), r2(p.position.z), p.move.state]);
  }
  R.afterMantle = { pos: [r2(p.position.x), r2(p.position.y), r2(p.position.z)], state: p.move.state, grounded: p.move.grounded };
  R.wallTop = c.top;
  R.bounds = { min: game.world.bounds.min.toArray(), max: game.world.bounds.max.toArray() };
  // now walk outwards (towards -z) for 3 s and see whether the player leaves the arena
  for (let i = 0; i < 240; i++) {
    game.input.setVirtual('forward', true);
    game.input.update(); game.update(DT); game.input.endFrame();
  }
  R.afterWalkOut = { pos: [r2(p.position.x), r2(p.position.y), r2(p.position.z)], state: p.move.state, grounded: p.move.grounded, alive: p.alive };
  R.inBounds = game.world.bounds.containsPoint(p.position);
  R.log = log.slice(0, 40);
  releaseAll(game);
  report.done = true;
}
export function drive() {}
