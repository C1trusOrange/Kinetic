// Wall-run start conditions (hug / shallow / head-on), full-length runs from height, ping-pong chains. Flat map (walls x=-10 face and x=-4 face, 14 m tall).
import { applyExp } from './exps.js';
import { teleport, keys, makeScenario, evs, tr, r2, r3, hs, stats, firstT } from './common.js';

const F = (g, name, on) => g.input.setVirtual(name, on);
const H = s => Math.hypot(s.vx, s.vz);
const seriesEvery = (T, dtS, f) => { const out = []; if (!T.length) return out; let next = T[0].t; for (const s of T) if (s.t >= next) { out.push(f(s)); next += dtS; } return out; };

function pulse(g, c, name, lt, when, hold = 1) {
  const k = '_p_' + name + when;
  if (lt >= when && !c[k]) { c[k] = 1; c[k + 'f'] = 0; F(g, name, true); return; }
  if (c[k] === 1) { c[k + 'f']++; if (c[k + 'f'] >= hold) { c[k] = 2; F(g, name, false); } }
}

function summary(g) {
  const T = tr(g);
  const ws = evs(g, 'WallRunStart'), we = evs(g, 'WallRunEnd'), js = evs(g, 'Jump');
  return {
    wallRuns: ws.length,
    runs: ws.map((s, i) => { const e = we.find(x => x.t > s.t); return { t: r2(s.t - T[0].t), y: r2(s.y), sp: r2(s.speed), dur: e ? r2(e.t - s.t) : null, end: e ? e.a : null, endY: e ? r2(e.y) : null }; }),
    jumps: js.map(e => ({ t: r2(e.t - T[0].t), ty: e.a, y: r2(e.y), hs: r2(e.speed) })),
  };
}

const phases = [
  // start parallel, hugging the wall: x=-9.4 (0.6 m from the left wall). Jump at 0.6 s, holding forward.
  ...[[-9.4, 0], [-9.4, 0.06], [-9.1, 0.1], [-8.8, 0.1], [-8.6, 0.2], [-8.0, 0.35]].map(([x, yaw]) => ({
    name: `hug_x${x}_yaw${yaw}`, dur: 3.5,
    start(g) { teleport(g, x, 0, 56, yaw); },
    tick(lt, dt, g, R, c) { keys(g, { forward: lt > 0.05, sprint: lt > 0.05 }); pulse(g, c, 'jump', lt, 0.6); },
    end(g, R) { R[`hug_x${x}_yaw${yaw}`] = summary(g); },
  })),

  // head-on approach: the wall should not start a run
  ...[0.9, 1.2, 1.45].map(yaw => ({
    name: `headon_${yaw}`, dur: 3,
    start(g) { teleport(g, -7, 0, 56, yaw); },
    tick(lt, dt, g, R, c) { keys(g, { forward: lt > 0.05, sprint: lt > 0.05 }); pulse(g, c, 'jump', lt, 0.4); },
    end(g, R) { R[`headon_${yaw}`] = summary(g); },
  })),

  // long run from height: full length; should end 'timeout' at 1.7 s
  { name: 'high_full_run', dur: 5,
    start(g) { teleport(g, -8.4, 8, 56, 0.3); g.player.velocity.set(-2.2, 0, -9.3); g.player.move.grounded = false; },
    tick(lt, dt, g, R, c) { keys(g, { forward: true, sprint: true }); },
    end(g, R, c) {
      const T = tr(g);
      const ws = evs(g, 'WallRunStart')[0], we = evs(g, 'WallRunEnd')[0];
      const o = summary(g);
      if (ws) {
        const seg = T.filter(s => s.t >= ws.t && (!we || s.t <= we.t));
        o.ySeries = seriesEvery(seg, 0.2, s => r2(s.y));
        o.vySeries = seriesEvery(seg, 0.2, s => r2(s.vy));
        o.speedSeries = seriesEvery(seg, 0.2, s => r2(H(s)));
      }
      R.high_full_run = o;
    } },

  // ping-pong chain between the two walls. After every wall jump turn toward the other wall.
  { name: 'pingpong', dur: 9,
    start(g, R, c) { teleport(g, -8.6, 0, 56, 0.35); c.dir = 1; c.turn = 0; },
    tick(lt, dt, g, R, c) {
      const p = g.player;
      keys(g, { forward: lt > 0.05, sprint: lt > 0.05 });
      pulse(g, c, 'jump', lt, 0.5);
      // wall-run timer
      if (p.isWallRunning) c.wr = (c.wr || 0) + dt; else if (!c.wjPending) c.wr = 0;
      if (p.isWallRunning && c.wr >= 0.42 && !c.wjPending) {
        c.wjPending = true; F(g, 'jump', true);
        // opposite wall: if wall is on left (wallRunSide -1) turn right (yaw decreasing)
        c.turnTarget = -p.wallRunSide * -0.55; // yaw delta to apply: wall left => turn right => negative yaw
        c.turnTarget = p.wallRunSide === -1 ? -0.55 : 0.55;
        c.applied = 0;
      } else if (c.wjPending && c.jf == null) { c.jf = 1; }
      else if (c.wjPending && c.jf === 1) { F(g, 'jump', false); c.jf = 2; }
      if (c.wjPending && c.jf === 2) {
        // smooth turn over ~0.2 s
        const step = Math.sign(c.turnTarget) * Math.min(Math.abs(c.turnTarget - c.applied), 4 * dt);
        p.yaw += step; c.applied += step;
        if (Math.abs(c.turnTarget - c.applied) < 1e-3) { c.wjPending = false; c.jf = null; c.wr = 0; }
      }
      c.maxY = Math.max(c.maxY || 0, p.position.y);
    },
    end(g, R, c) {
      const o = summary(g); o.maxY = r2(c.maxY);
      const T = tr(g);
      o.finalZ = r2(T[T.length - 1].z); o.travel = r2(T[0].z - T[T.length - 1].z);
      o.ySeries = seriesEvery(T, 0.4, s => r2(s.y));
      o.speedSeries = seriesEvery(T, 0.4, s => r2(H(s)));
      R.pingpong = o;
    } },

  // wall-jump then double jump / mantle etc: double jump refresh after wall jump
  { name: 'walljump_then_double', dur: 4,
    start(g, R, c) { teleport(g, -8.4, 0, 56, 0.3); },
    tick(lt, dt, g, R, c) {
      const p = g.player;
      keys(g, { forward: lt > 0.05, sprint: lt > 0.05 });
      pulse(g, c, 'jump', lt, 0.5);
      if (p.isWallRunning) c.wr = (c.wr || 0) + dt;
      if (c.wr > 0.4 && !c.a) { c.a = 1; F(g, 'jump', true); }
      else if (c.a === 1) { c.a = 2; F(g, 'jump', false); c.tw = lt; }
      if (c.tw && lt - c.tw > 0.35 && !c.b) { c.b = 1; F(g, 'jump', true); }
      else if (c.b === 1) { c.b = 2; F(g, 'jump', false); }
      c.maxY = Math.max(c.maxY || 0, p.position.y);
    },
    end(g, R, c) { const o = summary(g); o.maxY = r2(c.maxY); R.walljump_then_double = o; } },
];

const S = makeScenario(phases, { setup: g => applyExp(g) });
export const setup = S.setup;
export const drive = S.drive;
export const finish = S.finish;
