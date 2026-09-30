// Wall-run + wall-jump in the sandbox corridor (north wall inner face z=-19.7, south wall inner face z=-14.8, x from -10 to -31).
import { teleport, keys, makeScenario, evs, tr, r2, r3, hs, stats, firstT } from './common.js';

const F = (g, name, on) => g.input.setVirtual(name, on);
function pulse(g, c, name, lt, when, hold = 1) {
  const k = '_p_' + name + when;
  if (lt >= when && !c[k]) { c[k] = 1; c[k + 'f'] = 0; F(g, name, true); return; }
  if (c[k] === 1) { c[k + 'f']++; if (c[k + 'f'] >= hold) { c[k] = 2; F(g, name, false); } }
}
const H = s => Math.hypot(s.vx, s.vz);
const seriesEvery = (T, dtS, f) => { const out = []; if (!T.length) return out; let next = T[0].t; for (const s of T) if (s.t >= next) { out.push(f(s)); next += dtS; } return out; };

// approach: start (x,z), yaw offset toward north wall (rad, positive = toward wall), jump time
function runCase(name, o) {
  return {
    name, dur: o.dur || 5.5,
    start(g, R, c) {
      // yaw pi/2 = heading -x. turning right (yaw decreasing) heads toward -z (north wall)
      if (o.flat) teleport(g, (o.side === -1 ? -5.6 : -8.4), o.y ?? 0, 56, (o.ang ?? 0.3) * (o.side ?? 1));
      else teleport(g, o.x ?? -11, 0, o.z ?? -16.6, Math.PI / 2 - (o.ang ?? 0.3) * (o.side ?? 1));
      c.maxRoll = 0; c.rollAtMid = null;
    },
    tick(lt, dt, g, R, c) {
      const p = g.player;
      keys(g, { forward: lt > 0.05, sprint: lt > 0.05 && !o.noSprint, crouch: false });
      pulse(g, c, 'jump', lt, o.jump ?? 0.5);
      if (o.doubleAt) pulse(g, c, 'jump', lt, o.doubleAt);
      if (o.wallJumpAfter != null) {
        if (p.isWallRunning) { c.wr = (c.wr || 0) + dt; }
        if (c.wr >= o.wallJumpAfter && !c.wj) { c.wj = 1; F(g, 'jump', true); }
        else if (c.wj === 1) { c.wj = 2; F(g, 'jump', false); }
      }
      if (p.isWallRunning) {
        c.maxRoll = Math.max(c.maxRoll, Math.abs(g.camera.rotation.z));
        if ((c.wrT = (c.wrT || 0) + dt) > 0.6 && c.rollAtMid == null) { c.rollAtMid = g.camera.rotation.z; c.fovMid = g.camera.fov; c.baseFov = g.getBaseFov(); }
      }
    },
    end(g, R, c) {
      const T = tr(g);
      const ws = evs(g, 'WallRunStart'), we = evs(g, 'WallRunEnd');
      const jumps = evs(g, 'Jump');
      const out = { wallRuns: ws.length };
      if (ws.length) {
        const s0 = ws[0], e0 = we.find(e => e.t > s0.t);
        const seg = T.filter(s => s.t >= s0.t && (!e0 || s.t <= e0.t));
        out.startAfterJump = jumps.length ? r2(s0.t - jumps[0].t) : null;
        out.startY = r2(s0.y); out.startSpeed = r2(s0.speed); out.startVy = r2(s0.vy);
        out.dur = e0 ? r2(e0.t - s0.t) : 'running'; out.endReason = e0 ? e0.a : null; out.endY = e0 ? r2(e0.y) : null;
        out.distance = e0 ? r2(Math.hypot(e0.x - s0.x, e0.z - s0.z)) : null;
        out.speedSeries = seriesEvery(seg, 0.25, s => r2(H(s)));
        out.vySeries = seriesEvery(seg, 0.25, s => r2(s.vy));
        out.ySeries = seriesEvery(seg, 0.25, s => r2(s.y));
        out.speedMinMax = stats(seg, H);
        out.rollMidDeg = c.rollAtMid != null ? r2(c.rollAtMid * 180 / Math.PI) : null;
        out.fovMid = c.fovMid ? r2(c.fovMid) : null; out.baseFov = c.baseFov ? r2(c.baseFov) : null;
        const fr = g.__frames.filter(f => f.t >= s0.gt - 0.3);
        out.rollDeg_every0_1 = seriesEvery(fr, 0.1, f => r2(f.roll * 180 / Math.PI)).slice(0, 25);
      }
      out.jumps = jumps.map(e => ({ t: r2(e.t - T[0].t), type: e.a, hs: r2(e.speed), vy: r2(e.vy), y: r2(e.y) }));
      // wall jump: velocities right after
      const wj = jumps.find(e => e.a === 'wall');
      if (wj) {
        const seg = T.filter(s => s.t >= wj.t);
        const first = seg[1] || seg[0];
        let apex = -1; for (const s of seg) if (s.y > apex) apex = s.y;
        out.wallJump = { vBefore: [r2(wj.vx), r2(wj.vy), r2(wj.vz)], vAfter1step: [r2(first.vx), r2(first.vy), r2(first.vz)], apexAboveJump: r2(apex - wj.y),
          hsAfter: r2(H(first)) };
        const land = seg.find(s => s.t > wj.t + 0.1 && s.g);
        out.wallJump.landT = land ? r2(land.t - wj.t) : null;
        out.wallJump.zTravelAfter = r2(seg[seg.length - 1].z - wj.z);
      }
      R[name] = out;
    },
  };
}

const phases = process_phases();
function process_phases() {
  const flat = new URLSearchParams(location.search).get('flat');
  if (flat) return [
    runCase('F_17deg', { flat: 1, ang: 0.3, dur: 5 }),
    runCase('F_17deg_double_at_apex', { flat: 1, ang: 0.3, doubleAt: 0.85, dur: 5 }),
    runCase('F_35deg', { flat: 1, ang: 0.6, dur: 5 }),
    runCase('F_walljump_0_5s', { flat: 1, ang: 0.3, wallJumpAfter: 0.5, dur: 5 }),
    runCase('F_walljump_1_2s', { flat: 1, ang: 0.3, wallJumpAfter: 1.2, dur: 5 }),
    runCase('F_right_wall', { flat: 1, ang: 0.3, side: -1, dur: 5 }),
    runCase('F_walk', { flat: 1, ang: 0.3, noSprint: true, dur: 5 }),
    runCase('F_from_8m_drop', { flat: 1, ang: 0.3, y: 0, jump: 0.5, dur: 5 }),
  ];
  return [
  runCase('wr_north_17deg', { ang: 0.3 }),
  runCase('wr_north_shallow_8deg', { ang: 0.14 }),
  runCase('wr_north_steep_35deg', { ang: 0.6 }),
  runCase('wr_south_17deg', { ang: 0.3, side: -1, z: -17.9 }),
  runCase('wr_late_jump', { ang: 0.3, jump: 1.0, x: -10 }),
  runCase('wr_walljump_at_0_5s', { ang: 0.3, wallJumpAfter: 0.5, dur: 6 }),
  runCase('wr_walljump_at_1_3s', { ang: 0.3, wallJumpAfter: 1.3, dur: 6 }),
  runCase('wr_walk_speed', { ang: 0.3, noSprint: true }),
  ];
}

const S = makeScenario(phases);
export const setup = S.setup;
export const drive = S.drive;
export const finish = S.finish;
