// Mantling ledges of increasing height (walk into them and jump when close).
import { teleport, keys, makeScenario, installLog, evs, r2, hs } from './common.js';

let T0 = 0;
const heights = [0.4, 0.7, 1.0, 1.5, 2.0, 2.3, 2.6, 3.2];
// ledges exist for the first 7 heights; 3.2 is faked by standing next to the 2.6 one (skipped)
const phases = heights.slice(0, 7).map((h, i) => ({
  name: `ledge_${h}`, dur: 3.2,
  start(g, R, c) { teleport(g, 3.5, 0, -52 + i * 8, -Math.PI / 2); T0 = g.time; c.jumped = false; },
  tick(lt, dt, g, R, c) {
    const p = g.player;
    const jumpNow = p.position.x > 7.1 && !c.jumped;
    if (jumpNow) { c.jumped = true; c.jf = 3; }
    if (c.jf > 0) c.jf--;
    const m = evs(g, T0, 'Mantle')[0];
    const stop = m && g.time > m.t + 0.6;
    if (stop && !c.snap) c.snap = { x: p.position.x, y: p.position.y, s: hs(p), mantling: p.isMantling };
    keys(g, { forward: lt > 0.1 && !stop, jump: jumpNow || c.jf > 0 });
    if (p.isMantling) c.mant = (c.mant || 0) + dt;
  },
  end(g, R, c) {
    const p = g.player;
    const m = evs(g, T0, 'Mantle')[0];
    const s = c.snap || { x: p.position.x, y: p.position.y, s: hs(p) };
    R[`ledge_${h}`] = {
      mantle: !!m, at: m ? r2(m.t - T0) : null, dur: r2(c.mant || 0),
      y: r2(s.y), x: r2(s.x), success: s.y > h - 0.12 && s.x > 8.3, exitSpeed: r2(s.s),
    };
  },
}));

const S = makeScenario(phases, { setup: g => installLog(g) });
export const setup = S.setup;
export const drive = S.drive;
export const finish = S.finish;
