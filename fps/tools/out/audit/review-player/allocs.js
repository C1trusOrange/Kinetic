// Count collision queries per frame during ground running / air / wall-run, and time player.update.
import * as THREE from 'three';
import { teleport, releaseAll, r2 } from './common.js';

export async function setup(game, report) {
  const R = report.custom = {};
  const p = game.player; p.god = true;
  game.autotest.duration = 1e9; game.state = 'loading';
  const coll = game.world.collision;
  const cnt = { raycast: 0, probeGround: 0, resolveCapsule: 0, moveCapsule: 0 };
  for (const k of Object.keys(cnt)) { const o = coll[k].bind(coll); coll[k] = (...a) => { cnt[k]++; return o(...a); }; }
  const DT = 1 / 60;
  const run = (name, secs, setup, drive) => {
    setup();
    for (const k of Object.keys(cnt)) cnt[k] = 0;
    const heap0 = performance.memory ? performance.memory.usedJSHeapSize : 0;
    let tot = 0, worst = 0;
    const N = Math.round(secs / DT);
    for (let i = 0; i < N; i++) {
      drive(i * DT);
      game.input.update();
      const t0 = performance.now();
      game.player.update(DT);
      const dtm = performance.now() - t0; tot += dtm; worst = Math.max(worst, dtm);
      game.time += DT;
      game.player.updateCamera(DT);
      game.input.endFrame();
    }
    R[name] = { perFrame: Object.fromEntries(Object.entries(cnt).map(([k, v]) => [k, r2(v / N)])), avgMs: r2(tot / N), worstMs: r2(worst), heapDeltaKB: performance.memory ? Math.round((performance.memory.usedJSHeapSize - heap0) / 1024) : null };
  };
  run('idle', 2, () => teleport(game, 0, 0, 20, 0, 0), t => releaseAll(game));
  run('running', 3, () => teleport(game, 0, 0, 24, 0, 0), t => { game.input.setVirtual('forward', true); game.input.setVirtual('sprint', true); });
  run('airborne', 2, () => { teleport(game, 0, 8, 20, 0, 0); }, t => { game.input.setVirtual('forward', true); });
  run('wallrun', 1.5, () => { teleport(game, -30, 0, -17, -Math.PI / 2, 0); game.player.velocity.set(11, 0, 0); }, t => { game.input.setVirtual('forward', true); game.input.setVirtual('sprint', true); game.input.setVirtual('jump', t < 0.05); game.input.addLook(0, 0); });
  R.states = p.move.state;
  releaseAll(game);
  report.done = true;
}
export function drive() {}
