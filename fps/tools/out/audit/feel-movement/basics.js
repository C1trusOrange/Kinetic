// Jump heights, air time, ground speeds, acceleration, stopping, air strafing. Flat test map.
import { teleport, keys, makeScenario, evs, tr, r2, r3, hs, stats, firstT } from './common.js';

const F = (g, name, on) => g.input.setVirtual(name, on);
/** press for exactly one rendered frame when lt >= when */
function pulse(g, c, name, lt, when) {
  const k = '_p_' + name + when;
  if (lt >= when && !c[k]) { c[k] = 1; F(g, name, true); return; }
  if (c[k] === 1) { c[k] = 2; F(g, name, false); }
}

const yStart = () => 0;

function jumpMetrics(g) {
  const T = tr(g);
  const j = evs(g, 'Jump');
  if (!j.length) return { jumped: false };
  const t0 = j[0].t;
  const seg = T.filter(s => s.t >= t0);
  let apex = -1, apexT = 0, landT = null;
  for (const s of seg) { if (s.y > apex) { apex = s.y; apexT = s.t - t0; } }
  for (const s of seg) if (s.t > t0 + 0.05 && s.g) { landT = s.t - t0; break; }
  return { jumps: j.map(e => ({ type: e.a, dt: r2(e.t - t0), y: r2(e.y), vy: r2(e.vy), hs: r2(e.speed) })), apexHeight: r2(apex - j[0].y), timeToApex: r2(apexT), airTime: landT ? r2(landT) : null };
}

const phases = [
  { name: 'stand_jump', dur: 2.5,
    start(g) { teleport(g, 0, 0, 40, 0); },
    tick(lt, dt, g, R, c) { pulse(g, c, 'jump', lt, 0.4); },
    end(g, R) { R.stand_jump = jumpMetrics(g); } },

  { name: 'hold_jump', dur: 4,
    start(g) { teleport(g, 0, 0, 40, 0); },
    tick(lt, dt, g) { F(g, 'jump', lt > 0.3); },
    end(g, R) {
      const j = evs(g, 'Jump');
      R.hold_jump = { jumpsIn3_7s: j.length, types: j.map(e => e.a + '@' + r2(e.t - j[0].t)) };
    } },

  { name: 'double_early', dur: 3,
    start(g) { teleport(g, 0, 0, 40, 0); },
    tick(lt, dt, g, R, c) { pulse(g, c, 'jump', lt, 0.4); pulse(g, c, 'jump', lt, 0.55); },
    end(g, R) { R.double_early = jumpMetrics(g); } },
  { name: 'double_apex', dur: 3.2,
    start(g) { teleport(g, 0, 0, 40, 0); },
    tick(lt, dt, g, R, c) { pulse(g, c, 'jump', lt, 0.4); pulse(g, c, 'jump', lt, 0.72); },
    end(g, R) { R.double_apex = jumpMetrics(g); } },
  { name: 'double_falling', dur: 3.2,
    start(g) { teleport(g, 0, 0, 40, 0); },
    tick(lt, dt, g, R, c) { pulse(g, c, 'jump', lt, 0.4); pulse(g, c, 'jump', lt, 0.95); },
    end(g, R) { R.double_falling = jumpMetrics(g); } },

  // ---------- ground speeds / accel (run from rest for 2 s)
  ...[
    ['walk', { forward: 1 }],
    ['sprint', { forward: 1, sprint: 1 }],
    ['crouch', { forward: 1, crouch: 1 }],
    ['back', { back: 1 }],
    ['strafe', { right: 1 }],
    ['sprint_strafe', { right: 1, sprint: 1 }],
    ['diag_sprint', { forward: 1, right: 1, sprint: 1 }],
  ].map(([name, k]) => ({
    name: 'spd_' + name, dur: 2.6,
    start(g) { teleport(g, 0, 0, 40, 0); },
    tick(lt, dt, g) { keys(g, lt > 0.3 ? k : {}); },
    end(g, R) {
      const T = tr(g).filter(s => s.g);
      // first step where keys were down = first step with speed>0.05
      const s0 = T.findIndex(s => Math.hypot(s.vx, s.vz) > 0.05);
      const seg = T.slice(Math.max(0, s0 - 1));
      const fin = Math.hypot(seg[seg.length - 1].vx, seg[seg.length - 1].vz);
      const t0 = seg[0].t;
      const t63 = firstT(seg, s => Math.hypot(s.vx, s.vz) >= fin * 0.632);
      const t90 = firstT(seg, s => Math.hypot(s.vx, s.vz) >= fin * 0.9);
      R['spd_' + name] = { finalSpeed: r2(fin), t63: t63, t90: t90, accelAvg90: t90 ? r2(fin * 0.9 / t90) : null };
    } })),

  { name: 'stop_from_sprint', dur: 4,
    start(g) { teleport(g, 0, 0, 40, 0); },
    tick(lt, dt, g, R, c) {
      keys(g, { forward: lt > 0.2 && lt < 1.6, sprint: lt > 0.2 && lt < 1.6 });
      if (lt >= 1.6 && !c.rel) { c.rel = g.player.position.z; c.relT = g.__trace.length; }
    },
    end(g, R, c) {
      const T = tr(g).slice(c.relT);
      const t0 = T[0].t;
      R.stop_from_sprint = { speedAtRelease: r2(Math.hypot(T[0].vx, T[0].vz)), t_below_1: firstT(T, s => Math.hypot(s.vx, s.vz) < 1), t_below_0_1: firstT(T, s => Math.hypot(s.vx, s.vz) < 0.1),
        stopDistance: r2(Math.abs(T[T.length - 1].z - T[0].z)) };
    } },

  // reverse direction while sprinting (ground) : how fast does velocity flip?
  { name: 'reverse_sprint', dur: 4,
    start(g) { teleport(g, 0, 0, 40, 0); },
    tick(lt, dt, g, R, c) {
      keys(g, { forward: lt > 0.2 && lt < 1.6, back: lt >= 1.6, sprint: lt > 0.2 && lt < 1.6 });
      if (lt >= 1.6 && !c.rel) c.relT = g.__trace.length, c.rel = 1;
    },
    end(g, R, c) {
      const T = tr(g).slice(c.relT);
      R.reverse_sprint = { t_speed_zero_cross: firstT(T, s => s.vz > 0), t_walk_back_full: firstT(T, s => s.vz >= 6.0) };
    } },

  // ground -> 90 deg turn (sprint north then strafe right w/o releasing): does speed keep?
  { name: 'ground_snap_turn', dur: 3,
    start(g) { teleport(g, 0, 0, 40, 0); },
    tick(lt, dt, g, R, c) {
      keys(g, { forward: lt > 0.2 && lt < 1.6, sprint: lt > 0.2 && lt < 1.6, right: lt >= 1.6 });
      if (lt >= 1.6 && !c.rel) c.relT = g.__trace.length, c.rel = 1;
    },
    end(g, R, c) {
      const T = tr(g).slice(c.relT);
      R.ground_snap_turn = { t_vx_to_6: firstT(T, s => s.vx >= 6), speedAfter0_2s: (() => { const s = T.find(s => s.t - T[0].t > 0.2); return s ? r2(Math.hypot(s.vx, s.vz)) : null; })() };
    } },

  // ---------- air control: jump with sprint speed then strafe/turn; how much speed gain / steering
  { name: 'air_steer', dur: 3,
    start(g) { teleport(g, 0, 0, 40, 0); },
    tick(lt, dt, g, R, c) {
      keys(g, { forward: lt > 0.2 && lt < 1.6, sprint: lt > 0.2 && lt < 0.8 });
      pulse(g, c, 'jump', lt, 1.0);
      // after jump: hold right (no forward) to see steering
      if (lt > 1.05) keys(g, { right: true, forward: false });
      if (lt >= 1.05 && !c.a) c.a = g.__trace.length;
    },
    end(g, R, c) {
      const T = tr(g).slice(c.a);
      const first = T[0], last = T.filter(s => !s.g).slice(-1)[0] || T[T.length - 1];
      R.air_steer = { start: { vx: r2(first.vx), vz: r2(first.vz), hs: r2(Math.hypot(first.vx, first.vz)) },
        end: { vx: r2(last.vx), vz: r2(last.vz), hs: r2(Math.hypot(last.vx, last.vz)) },
        turnedDeg: r2(Math.atan2(last.vx, -last.vz) * 180 / Math.PI - Math.atan2(first.vx, -first.vz) * 180 / Math.PI) };
    } },

  // air strafing: mouse-turn + strafe key each frame to gain speed (classic strafe-jump)
  { name: 'strafe_jump_chain', dur: 8,
    start(g) { teleport(g, 0, 0, 40, 0); },
    tick(lt, dt, g, R, c) {
      const p = g.player;
      keys(g, { forward: lt > 0.1, sprint: lt > 0.1 });
      // bhop: press jump each time grounded
      if (p.onGround && lt > 0.4) { F(g, 'jump', true); } else F(g, 'jump', false);
      // alternate strafing left/right while turning into it, mimic strafe-jump
      const ph = Math.floor((lt - 0.5) / 0.35) % 2;
      const dir = ph === 0 ? 1 : -1;
      if (!p.onGround) { F(g, dir > 0 ? 'right' : 'left', true); F(g, dir > 0 ? 'left' : 'right', false); g.input.addLook(dir * 3, 0); }
      else { F(g, 'left', false); F(g, 'right', false); }
      c.max = Math.max(c.max || 0, p.speed);
    },
    end(g, R, c) {
      const j = evs(g, 'Jump');
      R.strafe_jump_chain = { jumps: j.length, speedAtJump: j.map(e => r2(e.speed)), max: r2(c.max) };
    } },

  // plain bhop straight forward (no strafe): speed retention per hop
  { name: 'bhop_straight', dur: 6,
    start(g) { teleport(g, 0, 0, 40, 0); },
    tick(lt, dt, g, R, c) {
      const p = g.player;
      keys(g, { forward: lt > 0.1, sprint: lt > 0.1 });
      F(g, 'jump', p.onGround && lt > 1.0);
    },
    end(g, R, c) {
      const j = evs(g, 'Jump');
      R.bhop_straight = { jumps: j.length, speedAtJump: j.map(e => r2(e.speed)), airTimes: null };
    } },
];

const S = makeScenario(phases);
export const setup = S.setup;
export const drive = S.drive;
export const finish = S.finish;
