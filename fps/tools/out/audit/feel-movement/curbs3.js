import { teleport, keys, makeScenario, evs, tr, r2, r3, hs } from './common.js';
const H = s => Math.hypot(s.vx, s.vz);
const phases = [['c0.5_from_-18', -18], ['c0.5_from_-14', -14]].map(([n, x0]) => ({ name: n, dur: 1.8,
  start(g, R, c) { teleport(g, x0, 0, 25, Math.PI / 2); },
  tick(lt, dt, g, R, c) { keys(g, { forward: lt > 0.1, sprint: lt > 0.1 }); },
  end(g, R, c) {
    const T = tr(g); const i0 = T.findIndex(s => s.x < -19.3);
    R[n] = T.slice(Math.max(0, i0 - 2), i0 + 60).filter((s, k) => k % 3 === 0).map(s => [r2(s.x), r2(s.y), r2(H(s)), r2(s.vy), s.g]);
  } }));
const S = makeScenario(phases);
export const setup = S.setup, drive = S.drive, finish = S.finish;
