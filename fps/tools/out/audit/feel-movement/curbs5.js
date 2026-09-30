import { teleport, keys, makeScenario, evs, tr, r2, r3, hs } from './common.js';
const H = s => Math.hypot(s.vx, s.vz);
const phases = [0.3, 0.5].map((h, i) => ({ name: 'h' + h, dur: 1.6,
  start(g, R, c) { teleport(g, -4, 0, [0, 3 * 8][i], -Math.PI / 2); },
  tick(lt, dt, g, R, c) { keys(g, { forward: lt > 0.1, sprint: lt > 0.1 }); },
  end(g, R, c) {
    const T = tr(g); const i0 = T.findIndex(s => s.x > 9.4);
    R['h' + h] = T.slice(Math.max(0, i0 - 2), i0 + 26).map(s => [r3(s.x), r3(s.y), r2(H(s)), r2(s.vy), s.g]);
  } }));
const S = makeScenario(phases);
export const setup = S.setup, drive = S.drive, finish = S.finish;
