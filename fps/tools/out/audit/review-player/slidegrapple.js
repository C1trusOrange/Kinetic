// Slide, then grapple along the ground: is the slide state (loop, roll, FOV) left stale while the rope drags the player?
import { teleport, releaseAll, r2, hs } from './common.js';
export async function setup(game, report) {
  const R = report.custom = { samples: [] };
  const p = game.player; p.god = true;
  game.autotest.duration = 1e9; game.state = 'loading';
  const DT = 1 / 60;
  teleport(game, 0, 0, 12, 0, 0);
  p.velocity.set(0, 0, -11);
  for (let i = 0; i < 240; i++) {
    const t = i * DT;
    game.input.setVirtual('forward', true);
    game.input.setVirtual('sprint', t < 5);
    game.input.setVirtual('crouch', t > 0.03);
    game.input.setVirtual('grapple', t > 0.35 && t < 0.4);
    game.input.update(); game.update(DT); game.input.endFrame();
    if (i % 12 === 0 && t > 0.0) R.samples.push({ t: r2(t), state: p.move.state, sl: p.isSliding, gp: p.isGrappling, grounded: p.onGround, speed: r2(p.speed), loops: game.audio.loops.size, fovKick: r2(p.rig.fovKick), fov: r2(game.camera.fov), gs: p.grapple.state, y: r2(p.position.y) });
  }
  releaseAll(game);
  report.done = true;
}
export function drive() {}
