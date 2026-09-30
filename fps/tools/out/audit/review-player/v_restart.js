// State across match restart / map switch: grapple attached + slide loops, then startMatch() on another map; also death -> respawn flags.
import { teleport, releaseAll, r2, loopInfo } from './common.js';
let phase = 0, t0 = 0;
export async function setup(game, report) {
  report.custom = {};
  game.player.god = true;
  game.autotest.duration = 9999;
}
export function drive(t, dt, game, report) {
  const R = report.custom, p = game.player;
  if (phase === 0 && t > 0.6) { phase = 1; t0 = t; teleport(game, 14, 0, 0, -Math.PI / 2, 0.83); }
  if (phase === 1) {
    const lt = t - t0;
    game.input.setVirtual('grapple', lt > 0.1 && lt < 0.15);
    game.input.setVirtual('crouch', lt > 0.5);
    game.input.setVirtual('forward', true);
    if (p.grapple.attached && lt > 0.7 && !R.before) {
      R.before = { state: p.move.state, sliding: p.isSliding, grapple: p.grapple.state, ...loopInfo(game), gvis: p.grapple.group.visible, speed: r2(p.speed) };
      phase = 2;
      releaseAll(game);
      game.startMatch({ mapId: 'ruins', mode: 'ffa', botCount: 0, difficulty: 'normal', scoreLimit: 0, timeLimit: 0 }).then(() => {
        R.afterSwitch = { state: game.state, map: game.world.mapId, pstate: p.move.state, sliding: p.isSliding, grapple: p.grapple.state, gvis: p.grapple.group.visible, ...loopInfo(game), alive: p.alive, anchor: !!p.grappleAnchor, charge: p.grappleCharge, crouched: p.move.crouched, h: p.height, fov: game.camera.fov };
        setTimeout(() => { report.done = true; }, 500);
      });
    }
  }
}
