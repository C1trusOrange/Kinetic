import { teleport, keys, makeScenario, evs, tr, r2, r3, hs } from './common.js';
const H = s => Math.hypot(s.vx, s.vz);
const cases = [['c0.5', -18, -20.3, 0.5], ['c0.35', -22.9, -24.3, 0.35], ['c0.2', -26.9, -28.3, 0.2]];
const phases = cases.map(([n, x0, xc, h]) => ({ name: n, dur: 1.6,
  start(g, R, c) { teleport(g, x0, 0, 25, Math.PI / 2); c.f = []; },
  tick(lt, dt, g, R, c) { keys(g, { forward: lt > 0.1, sprint: lt > 0.1 }); if (lt > 0.3) c.f.push([g.camera.position.y - g.player.position.y, g.player.position.y, g.player.speed, g.player.position.x]); },
  end(g, R, c) {
    const T = tr(g); const F = c.f;
    const past = F.filter(f => f[3] < xc + 0.5);
    let jerk = 0; for (let i = 1; i < F.length; i++) jerk = Math.max(jerk, Math.abs(F[i][0] - F[i - 1][0]));
    R[n] = { finalX: r2(T[T.length - 1].x), finalY: r2(T[T.length - 1].y), minSpeedNearCurb: r2(Math.min(...F.filter(f => f[3] < xc + 1.0 && f[3] > xc - 1.0).map(f => f[2]))), camOffsetFrameJump: r3(jerk), airSteps: T.filter(s => !s.g).length };
  } }));
const S = makeScenario(phases);
export const setup = S.setup, drive = S.drive, finish = S.finish;
