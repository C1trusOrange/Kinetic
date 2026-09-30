// Sprinting into walls at angles: speed retention when sliding along a wall (ground). Flat map wall face x=-10 (left of x=-7).
import { teleport, keys, makeScenario, evs, tr, r2, hs } from './common.js';
const H = s => Math.hypot(s.vx, s.vz);
const phases = [5, 15, 30, 50, 70].map(deg => ({
  name: 'wallslide_' + deg, dur: 3.2,
  start(g) { teleport(g, -8.5, 0, 56, deg * Math.PI / 180); },
  tick(lt, dt, g, R, c) { keys(g, { forward: lt > 0.1, sprint: lt > 0.1 }); if (lt > 2.4) { c.s = c.s || []; c.s.push(g.player.speed); } },
  end(g, R, c) {
    const T = tr(g);
    const last = T[T.length - 1];
    R['wallslide_' + deg] = { expectedTangent: r2(9.6 * Math.cos(deg * Math.PI / 180)), speedLate: r2(c.s.reduce((a, b) => a + b, 0) / c.s.length), hsEnd: r2(H(last)), x: r2(last.x) };
  } }));
const S = makeScenario(phases);
export const setup = S.setup, drive = S.drive, finish = S.finish;
