// Player update cost while doing everything (sprint, jump, slide, wall-run, grapple) on the test map.
import * as THREE from 'three';
import { teleport, keys, makeScenario, installLog, r2 } from './common.js';

const stats = { n: 0, sum: 0, max: 0, cam: 0, steps: 0 };
const phases = [
  { name: 'run', dur: 12,
    start(g, R, c) {
      const p = g.player;
      if (!c.wrapped) {
        c.wrapped = true;
        const u = p.update.bind(p), uc = p.updateCamera.bind(p), st = p.move.step.bind(p.move);
        p.update = dt => { const t0 = performance.now(); u(dt); const d = performance.now() - t0; stats.n++; stats.sum += d; stats.max = Math.max(stats.max, d); };
        p.updateCamera = dt => { const t0 = performance.now(); uc(dt); stats.cam += performance.now() - t0; };
        p.move.step = dt => { stats.steps++; return st(dt); };
      }
      teleport(g, -7, 0, 55, 0);
    },
    tick(lt, dt, g, R, c) {
      const p = g.player;
      // sprint down the corridor, jump around, wall-run, slide, grapple now and then
      keys(g, { forward: true, sprint: lt < 8, jump: Math.floor(lt * 2) % 3 === 0 && (lt * 2) % 1 < 0.1, crouch: lt > 8 && lt < 9, left: lt > 2 && lt < 4, grapple: lt > 5 && lt < 5.05 });
      if (p.position.z < -50) teleport(g, -7, 0, 55, 0);
    },
    end(g, R, c) { R.perf = { updateCalls: stats.n, avgUpdateMs: r2(stats.sum / stats.n), maxUpdateMs: r2(stats.max), avgCameraMs: r2(stats.cam / stats.n), physicsStepsPerFrame: r2(stats.steps / stats.n) }; } },
];
const S = makeScenario(phases, { setup: g => installLog(g) });
export const setup = S.setup; export const drive = S.drive; export const finish = S.finish;
