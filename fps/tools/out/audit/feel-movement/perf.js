// Cost of Player.update + updateCamera (ms/frame) while doing the expensive things: wall-run scans, grapple, slide, air.
import { teleport, keys, makeScenario, evs, tr, r2, r3, hs } from './common.js';
const F = (g, name, on) => g.input.setVirtual(name, on);
let acc = { n: 0, sum: 0, max: 0, cam: 0 };
const phases = [{ name: 'perf_mix', dur: 12,
  start(g, R, c) {
    teleport(g, -8.4, 0, 56, 0.3);
    const p = g.player; const ou = p.update.bind(p), oc = p.updateCamera.bind(p);
    p.update = dt => { const t0 = performance.now(); ou(dt); const d = performance.now() - t0; acc.n++; acc.sum += d; acc.max = Math.max(acc.max, d); };
    p.updateCamera = dt => { const t0 = performance.now(); oc(dt); acc.cam += performance.now() - t0; };
  },
  tick(lt, dt, g, R, c) {
    keys(g, { forward: true, sprint: true });
    if (lt > 0.5 && !c.j) { c.j = 1; F(g, 'jump', true); } else if (c.j === 1) { c.j = 2; F(g, 'jump', false); }
    if (lt > 4 && lt < 4.05) F(g, 'grapple', true); else F(g, 'grapple', false);
  },
  end(g, R, c) { R.perf = { frames: acc.n, avgMs: r3(acc.sum / acc.n), maxMs: r3(acc.max), camAvgMs: r3(acc.cam / acc.n) }; } }];
const S = makeScenario(phases);
export const setup = S.setup, drive = S.drive, finish = S.finish;
