// Ramps / stairs smoothness and speed. Sandbox: stairs at x -2..2 z 16->8 (rises toward -z, 4.5 m), ramp x 16->8 at z -2..2.
import { teleport, keys, makeScenario, evs, tr, r2, r3, hs, stats, firstT } from './common.js';

const F = (g, name, on) => g.input.setVirtual(name, on);
const H = s => Math.hypot(s.vx, s.vz);
const seriesEvery = (T, dtS, f) => { const out = []; if (!T.length) return out; let next = T[0].t; for (const s of T) if (s.t >= next) { out.push(f(s)); next += dtS; } return out; };
function pulse(g, c, name, lt, when, hold = 1) {
  const k = '_p_' + name + when;
  if (lt >= when && !c[k]) { c[k] = 1; c[k + 'f'] = 0; F(g, name, true); return; }
  if (c[k] === 1) { c[k + 'f']++; if (c[k + 'f'] >= hold) { c[k] = 2; F(g, name, false); } }
}

function smooth(g, c, name, R) {
  const T = tr(g);
  let toggles = 0; for (let i = 1; i < T.length; i++) if (T[i].g !== T[i - 1].g) toggles++;
  const fr = g.__frames.filter(f => f.t > c.T0 + 0.6);
  const cys = fr.map(f => f.cy);
  const mean = cys.reduce((a, b) => a + b, 0) / cys.length;
  // per-frame world camera y change vs player y change
  let maxDev = 0; for (const v of cys) maxDev = Math.max(maxDev, Math.abs(v - mean));
  R[name] = { groundToggles: toggles, camOffsetMean: r2(mean), camOffsetMaxDev: r3(maxDev), speedMax: stats(T, H).max, vyRange: stats(T, s => s.vy), yEnd: r2(T[T.length - 1].y), zEnd: r2(T[T.length - 1].z), xEnd: r2(T[T.length - 1].x), tookAirFrames: T.filter(s => !s.g).length };
}

const phases = [
  { name: 'stairs_up_sprint', dur: 3.2,
    start(g) { teleport(g, 0, 0, 22, 0); },
    tick(lt, dt, g, R, c) { keys(g, { forward: lt > 0.1, sprint: lt > 0.1 }); },
    end(g, R, c) { smooth(g, c, 'stairs_up_sprint', R); } },
  { name: 'ramp_up_sprint', dur: 3.2,
    start(g) { teleport(g, 22, 0, 0, Math.PI / 2); },
    tick(lt, dt, g, R, c) { keys(g, { forward: lt > 0.1, sprint: lt > 0.1 }); },
    end(g, R, c) { smooth(g, c, 'ramp_up_sprint', R); } },
  { name: 'stairs_down_sprint', dur: 3.2,
    start(g) { teleport(g, 0, 4.5, 6, Math.PI); },
    tick(lt, dt, g, R, c) { keys(g, { forward: lt > 0.1, sprint: lt > 0.1 }); },
    end(g, R, c) { smooth(g, c, 'stairs_down_sprint', R); } },
  { name: 'ramp_down_sprint', dur: 3.2,
    start(g) { teleport(g, 7, 4.5, 0, -Math.PI / 2); },
    tick(lt, dt, g, R, c) { keys(g, { forward: lt > 0.1, sprint: lt > 0.1 }); },
    end(g, R, c) { smooth(g, c, 'ramp_down_sprint', R); } },
  { name: 'ramp_up_sprint_jump_at_crest', dur: 3.5,
    start(g) { teleport(g, 22, 0, 0, Math.PI / 2); },
    tick(lt, dt, g, R, c) {
      keys(g, { forward: lt > 0.1, sprint: lt > 0.1 });
      // launch off the top of the ramp (x=8, y=4.5) by jumping near crest
      if (!c.j && g.player.position.y > 4.0) { c.j = 1; F(g, 'jump', true); } else if (c.j === 1) { c.j = 2; F(g, 'jump', false); }
      c.maxY = Math.max(c.maxY || 0, g.player.position.y);
    },
    end(g, R, c) { R.ramp_up_sprint_jump_at_crest = { maxY: r2(c.maxY), jumpHs: evs(g, 'Jump').map(e => r2(e.speed)) }; } },
  // sprint off the crest without jumping: is there any air pop?
  { name: 'ramp_crest_sprint_no_jump', dur: 3,
    start(g) { teleport(g, 22, 0, 0, Math.PI / 2); },
    tick(lt, dt, g, R, c) { keys(g, { forward: lt > 0.1, sprint: lt > 0.1 }); c.maxY = Math.max(c.maxY || 0, g.player.position.y); },
    end(g, R, c) { const T = tr(g); R.ramp_crest_sprint_no_jump = { maxY: r2(c.maxY), airFrames: T.filter(s => !s.g).length, airSeconds: r2(T.filter(s => !s.g).length / 120), lands: evs(g, 'Land').map(e => r2(e.a)) }; } },
];

const S = makeScenario(phases);
export const setup = S.setup;
export const drive = S.drive;
export const finish = S.finish;
