// Frame-rate independence: compare position at equal physics step counts across frame rates.
import { teleport, releaseAll, r2 } from './common.js';
export async function setup(game, report) {
  const R = report.custom = { runs: {} };
  const p = game.player; p.god = true;
  game.autotest.duration = 1e9; game.state = 'loading';
  for (const fps of [240, 60, 20]) {
    const DT = 1 / fps;
    teleport(game, -25, 0, 0, -Math.PI / 2, 0);
    game.time = 0;
    let steps = 0;
    const orig = p.move.step.bind(p.move);
    p.move.step = (dt) => { steps++; orig(dt); };
    const rec = [];
    const N = Math.round(0.6 * fps);
    for (let i = 0; i < N; i++) {
      game.input.setVirtual('forward', true);
      game.input.setVirtual('sprint', true);
      game.input.update(); game.update(DT); game.input.endFrame();
      rec.push([i, steps, r2(p.position.x + 25), r2(p.velocity.x)]);
    }
    p.move.step = orig;
    R.runs[fps] = { total: steps, first: rec.slice(0, 6), last: rec.slice(-3) };
    releaseAll(game);
    for (let i = 0; i < 30; i++) { game.input.update(); game.update(1 / 60); game.input.endFrame(); }
  }
  report.done = true;
}
export function drive() {}
