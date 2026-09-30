// Runs the built-in autotest script; when the player dies, prints the recent trace and the ground below.
import { r2 } from './common.js';
const hist = [];
let last = -1, reported = false;
export function setup(game, report) { report.custom = {}; game.autotest.duration = 22; }
export function drive(t, dt, game, report) {
  game.autotest._drive(t, dt);
  const p = game.player;
  if (t - last >= 0.1) { last = t; hist.push([r2(t), r2(p.position.x), r2(p.position.y), r2(p.position.z), r2(p.velocity.x), r2(p.velocity.y), r2(p.velocity.z), p.move.state]); if (hist.length > 40) hist.shift(); }
  if (!p.alive && !reported) {
    reported = true;
    report.custom.death = hist.slice(-25);
    report.custom.spawn = game.world.spawnPoints.map(s => s.position.toArray().map(r2));
    const c = game.world.collision;
    const pos = p.position;
    // probe the world under the death position
    const h = c.raycast(new (p.position.constructor)(pos.x, 50, pos.z), new (p.position.constructor)(0, -1, 0), 200);
    report.custom.groundUnderDeath = h ? [r2(h.point.y), h.surface] : null;
  }
}
export function finish(game, report) {}
