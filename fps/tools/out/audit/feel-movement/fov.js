// FOV / camera state sampling across movement states. Flat map.
import { teleport, keys, makeScenario, evs, tr, r2, r3, hs } from './common.js';
const F = (g, name, on) => g.input.setVirtual(name, on);
const seriesEvery = (T, dtS, f) => { const out = []; if (!T.length) return out; let next = T[0].t; for (const s of T) if (s.t >= next) { out.push(f(s)); next += dtS; } return out; };
function pulse(g, c, name, lt, when, hold = 1) {
  const k = '_p_' + name + when;
  if (lt >= when && !c[k]) { c[k] = 1; c[k + 'f'] = 0; F(g, name, true); return; }
  if (c[k] === 1) { c[k + 'f']++; if (c[k + 'f'] >= hold) { c[k] = 2; F(g, name, false); } }
}
const phases = [
  { name: 'fov_idle_sprint', dur: 3,
    start(g) { teleport(g, 0, 0, 40, 0); },
    tick(lt, dt, g, R, c) { keys(g, { forward: lt > 0.5, sprint: lt > 0.5 }); },
    end(g, R, c) {
      const fr = g.__frames;
      R.fov_idle_sprint = { base: r2(g.getBaseFov()), fovEvery0_25: seriesEvery(fr, 0.25, f => r2(f.fov)) };
    } },
  { name: 'fov_slide', dur: 3.2,
    start(g) { teleport(g, 0, 0, 40, 0); },
    tick(lt, dt, g, R, c) { keys(g, { forward: lt > 0.1, sprint: lt > 0.1 && lt < 1.0, crouch: lt >= 1.0 && lt < 2.6 }); },
    end(g, R, c) {
      const T = tr(g), fr = g.__frames;
      R.fov_slide = { fovEvery0_2: seriesEvery(fr, 0.2, f => r2(f.fov)), speedEvery0_2: seriesEvery(T, 0.2, s => r2(Math.hypot(s.vx, s.vz))) };
    } },
  { name: 'fov_grapple', dur: 4,
    start(g) { teleport(g, 6, 0, 0, -Math.PI / 2, 0.5); },
    tick(lt, dt, g, R, c) { pulse(g, c, 'grapple', lt, 0.3); },
    end(g, R, c) {
      const T = tr(g), fr = g.__frames;
      R.fov_grapple = { fovEvery0_2: seriesEvery(fr, 0.2, f => r2(f.fov)), speed3dEvery0_2: seriesEvery(T, 0.2, s => r2(Math.hypot(s.vx, s.vy, s.vz))), kick: seriesEvery(fr, 0.2, f => r2(f.fovKick)) };
    } },
];
const S = makeScenario(phases);
export const setup = S.setup, drive = S.drive, finish = S.finish;
