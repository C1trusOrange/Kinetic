// Runs the built-in autotest script and traces the player.
import { r2 } from './common.js';
const trace = [];
let last = -1;
export function setup(game, report) { report.custom = {}; game.autotest.duration = 20; }
export function drive(t, dt, game, report) {
  game.autotest._drive(t, dt);
  const p = game.player;
  if (t - last >= 0.5) { last = t; trace.push(`${r2(t)} pos=(${r2(p.position.x)},${r2(p.position.y)},${r2(p.position.z)}) v=(${r2(p.velocity.x)},${r2(p.velocity.y)},${r2(p.velocity.z)}) ${p.move.state} yaw=${r2(p.yaw)} alive=${p.alive}`); }
}
export function finish(game, report) { report.custom.trace = trace; }
