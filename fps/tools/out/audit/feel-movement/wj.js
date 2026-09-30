// Wall-jump output direction relative to the view + travel. Flat map, corridor walls x=-10 / x=-4 (6 m apart).
import { applyExp } from './exps.js';
import { teleport, keys, makeScenario, evs, tr, r2, r3, hs } from './common.js';
const F = (g, name, on) => g.input.setVirtual(name, on);
function pulse(g, c, name, lt, when, hold = 1) {
  const k = '_p_' + name + when;
  if (lt >= when && !c[k]) { c[k] = 1; c[k + 'f'] = 0; F(g, name, true); return; }
  if (c[k] === 1) { c[k + 'f']++; if (c[k + 'f'] >= hold) { c[k] = 2; F(g, name, false); } }
}
const DEG = 180 / Math.PI;
const mk = (name, look) => ({ name, dur: 4,
  start(g, R, c) { teleport(g, -8.4, 0, 56, 0.3); },
  tick(lt, dt, g, R, c) {
    const p = g.player;
    keys(g, { forward: lt > 0.05, sprint: lt > 0.05 });
    pulse(g, c, 'jump', lt, 0.5);
    if (p.isWallRunning) c.wr = (c.wr || 0) + dt;
    if (c.wr > 0.45 && !c.wj) { c.wj = 1; if (look) p.yaw -= look; c.yawAt = p.yaw; F(g, 'jump', true); } else if (c.wj === 1) { c.wj = 2; F(g, 'jump', false); }
  },
  end(g, R, c) {
    const T = tr(g);
    const wj = evs(g, 'Jump').find(e => e.a === 'wall');
    if (!wj) { R[name] = { none: true }; return; }
    const seg = T.filter(s => s.t >= wj.t);
    const s1 = seg[2] || seg[0];
    const vh = Math.hypot(s1.vx, s1.vz);
    const velYaw = Math.atan2(-s1.vx, -s1.vz);
    const p = g.player;
    let off = (velYaw - c.yawAt) * DEG; while (off > 180) off -= 360; while (off < -180) off += 360;
    const nextRun = evs(g, 'WallRunStart').filter(e => e.t > wj.t)[0];
    R[name] = { hsAfter: r2(vh), vyAfter: r2(s1.vy), angleOffViewDeg: r2(off), outwardSpeed: r2(Math.abs(s1.vx + 0)), nextWallRun: nextRun ? { dt: r2(nextRun.t - wj.t), y: r2(nextRun.y) } : null, x_0_15: seg.filter((s, k) => k % 18 === 0).slice(0, 8).map(s => r2(s.x)) };
  } });
const phases = [mk('wj_view_into_wall_0.3', 0), mk('wj_view_along_wall', 0.3), mk('wj_view_toward_far_wall', 0.7)];
const S = makeScenario(phases, { setup: g => applyExp(g) });
export const setup = S.setup, drive = S.drive, finish = S.finish;
