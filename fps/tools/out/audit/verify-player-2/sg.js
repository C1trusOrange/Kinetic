import { teleport, releaseAll, r2 } from './common.js';
export async function setup(game, report) {
  const R = report.custom = { samples: [] };
  const p = game.player; p.god = true; game.autotest.duration = 1e9; game.state = 'loading';
  const q = new URLSearchParams(location.search);
  const pitch = parseFloat(q.get('pitch') || '0.02');
  const DT = 1 / 60;
  teleport(game, 0, 0, 24, 0, 0);
  p.velocity.set(0, 0, -11);
  for (let i = 0; i < 180; i++) {
    const t = i * DT;
    if (i === 20) p.pitch = pitch;
    game.input.setVirtual('forward', true);
    game.input.setVirtual('sprint', true);
    game.input.setVirtual('crouch', t > 0.03);
    game.input.setVirtual('grapple', t > 0.35 && t < 0.4);
    game.input.update(); game.update(DT); game.input.endFrame();
    if (i % 9 === 0) R.samples.push([r2(t), p.move.state, p.isSliding, p.isGrappling, p.onGround, r2(p.speed), game.audio.loops.size, r2(p.rig.fovKick), r2(p.position.z), r2(p.position.y)].join(' '));
  }
  releaseAll(game);
  report.done = true;
}
export function drive() {}
