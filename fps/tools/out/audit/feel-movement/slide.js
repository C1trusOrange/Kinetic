// Slide: boost, duration, distance, slide-hop chain, slope slide, steering, cooldown. Flat test map.
import { teleport, keys, makeScenario, evs, tr, r2, r3, hs, stats, firstT } from './common.js';

const F = (g, name, on) => g.input.setVirtual(name, on);
function pulse(g, c, name, lt, when, hold = 1) {
  const k = '_p_' + name + when;
  if (lt >= when && !c[k]) { c[k] = 1; c[k + 'f'] = 0; F(g, name, true); return; }
  if (c[k] === 1) { c[k + 'f']++; if (c[k + 'f'] >= hold) { c[k] = 2; F(g, name, false); } }
}
const H = s => Math.hypot(s.vx, s.vz);
const seriesEvery = (T, dtS, f) => { const out = []; if (!T.length) return out; let next = T[0].t; for (const s of T) if (s.t >= next) { out.push(f(s)); next += dtS; } return out; };

const phases = [
  { name: 'slide_basic', dur: 6,
    start(g) { teleport(g, 0, 0, 40, 0); },
    tick(lt, dt, g, R, c) {
      keys(g, { forward: lt > 0.1, sprint: lt > 0.1 && lt < 1.3, crouch: lt >= 1.3 });
      if (lt >= 1.3 && !c.i) c.i = g.__trace.length;
    },
    end(g, R, c) {
      const T = tr(g).slice(c.i - 1);
      const sl = evs(g, 'SlideStart')[0], se = evs(g, 'SlideEnd')[0];
      const t0 = T[0].t;
      R.slide_basic = {
        speedBefore: r2(H(T[0])), slideStartT: sl ? r2(sl.t - t0) : null, speedAtStart: sl ? r2(sl.speed) : null,
        speedSeries_every0_2s: seriesEvery(T, 0.2, s => r2(H(s))).slice(0, 14),
        slideDur: sl && se ? r2(se.t - sl.t) : null, endSpeed: se ? r2(se.speed) : null,
        slideDist: sl && se ? r2(Math.hypot(se.x - sl.x, se.z - sl.z)) : null,
        peakSpeed: stats(T, H).max,
      };
      // camera: eye height over time relative to feet
      const fr = g.__frames.filter(f => f.t > c.T0 + 1.2);
      R.slide_basic.camEyeY = seriesEvery(fr, 0.1, f => r2(f.cy)).slice(0, 8);
      R.slide_basic.fovSeries = seriesEvery(fr, 0.2, f => r2(f.fov)).slice(0, 8);
    } },

  { name: 'crouch_walk_no_slide', dur: 3,
    start(g) { teleport(g, 0, 0, 40, 0); },
    tick(lt, dt, g, R, c) { keys(g, { forward: lt > 0.1, crouch: lt > 0.8 }); },
    end(g, R) { R.crouch_walk_no_slide = { slid: evs(g, 'SlideStart').length }; } },

  { name: 'slide_from_walk_speed_with_sprint_release', dur: 3,
    start(g) { teleport(g, 0, 0, 40, 0); },
    tick(lt, dt, g, R, c) { keys(g, { forward: lt > 0.1, sprint: lt > 0.1 && lt < 0.9, crouch: lt > 1.0 }); },
    end(g, R) {
      const ss = evs(g, 'SlideStart')[0];
      R.slide_from_walk_speed_with_sprint_release = { slid: !!ss, speedAtStart: ss ? r2(ss.speed) : null };
    } },

  // crouch pressed slightly early (0.25 s before the speed is reached) -> latched?
  { name: 'slide_from_stand_still_sprint_press', dur: 3,
    start(g) { teleport(g, 0, 0, 40, 0); },
    tick(lt, dt, g, R, c) { keys(g, { forward: lt > 0.1, sprint: lt > 0.1, crouch: lt > 0.13 }); },
    end(g, R) { const ss = evs(g, 'SlideStart')[0]; R.slide_from_stand_still_sprint_press = { slid: !!ss, at: ss ? r2(ss.speed) : null, crouchedWalkSpeed: r2(hs(g.player)) }; } },

  // slide-hop: sprint, slide, jump 0.35 s in, land, immediately crouch again (press window), repeat
  { name: 'slide_hop_chain', dur: 9,
    start(g) { teleport(g, 0, 0, 40, 0); },
    tick(lt, dt, g, R, c) {
      const p = g.player;
      const slideT = p.move.sliding ? p.move.slideTime : 0;
      keys(g, { forward: lt > 0.1, sprint: lt > 0.1 && lt < 1.3 || (p.onGround && !p.isCrouching) });
      // crouch at 1.3, then jump when slide time > 0.4, then crouch again 0.1 s before landing (airTime > 0.5)
      if (lt > 1.3 && p.onGround && !p.isSliding && !c.busy) { F(g, 'crouch', true); c.busy = 1; }
      if (p.isSliding && slideT > 0.45 && !c.jumpDone) { F(g, 'jump', true); c.jumpDone = 1; c.landed = 0; }
      else F(g, 'jump', false);
      if (c.jumpDone && !p.onGround) { F(g, 'crouch', p.airTime > 0.45); }
      if (c.jumpDone && p.onGround && c.airSeen) { c.jumpDone = 0; c.busy = 0; c.airSeen = 0; }
      if (!p.onGround) c.airSeen = 1;
      c.max = Math.max(c.max || 0, p.speed);
    },
    end(g, R, c) {
      const T = tr(g);
      const j = evs(g, 'Jump').filter(e => e.a === 'slide' || e.a === 'ground');
      const ss = evs(g, 'SlideStart'), le = evs(g, 'Land');
      R.slide_hop_chain = { peak: r2(c.max), slides: ss.map(e => ({ t: r2(e.t - T[0].t), hs: r2(e.speed) })),
        jumps: j.map(e => ({ t: r2(e.t - T[0].t), type: e.a, hs: r2(e.speed) })),
        lands: le.map(e => ({ t: r2(e.t - T[0].t), imp: r2(e.a), hs: r2(e.speed) })) };
      R.slide_hop_chain.speedEvery0_3 = seriesEvery(T, 0.3, s => r2(H(s)));
    } },

  // slide down a 24 deg ramp (map D: ramp at z=45, x 50..70 rises toward +x, we go DOWN the other one at z=60)
  { name: 'slide_downhill_24', dur: 6,
    start(g) { teleport(g, 51.5, 9, 60, -Math.PI / 2); },
    tick(lt, dt, g, R, c) {
      keys(g, { forward: lt > 0.1, sprint: lt > 0.1 && lt < 0.6, crouch: lt >= 0.6 });
      if (lt >= 0.6 && !c.i) c.i = g.__trace.length;
    },
    end(g, R, c) {
      const T = tr(g).slice(c.i - 1);
      const sl = evs(g, 'SlideStart')[0], se = evs(g, 'SlideEnd')[0];
      R.slide_downhill_24 = { slideStartSpeed: sl ? r2(sl.speed) : null, peak: stats(T, H).max, slideDur: sl && se ? r2(se.t - sl.t) : 'still sliding',
        series: seriesEvery(T, 0.25, s => r2(H(s))).slice(0, 14), lastY: r2(T[T.length - 1].y), lastX: r2(T[T.length - 1].x) };
    } },

  // slide down a gentle ramp then leave the lip: speed keep on launch
  { name: 'slide_cooldown', dur: 8,
    start(g) { teleport(g, 0, 0, 40, 0); },
    tick(lt, dt, g, R, c) {
      // sprint, slide 0.5 s, release crouch (stand + sprint), slide again 0.6 s later (within the 1.2 s boost cooldown), then 2 s later
      const seq = [[1.0, 1.5], [2.1, 2.6], [4.2, 4.7]];
      const cr = seq.some(([a, b]) => lt >= a && lt < b);
      keys(g, { forward: true, sprint: !cr, crouch: cr });
    },
    end(g, R, c) {
      const ss = evs(g, 'SlideStart');
      R.slide_cooldown = { slides: ss.map(e => ({ t: r2(e.t - tr(g)[0].t), a: e.a, hs: r2(e.speed) })) };
    } },

  { name: 'slide_steer', dur: 4,
    start(g) { teleport(g, 0, 0, 40, 0); },
    tick(lt, dt, g, R, c) {
      keys(g, { forward: lt > 0.1, sprint: lt > 0.1 && lt < 1.2, crouch: lt >= 1.2, left: lt >= 1.4 });
      if (lt >= 1.4 && !c.i) c.i = g.__trace.length;
    },
    end(g, R, c) {
      const T = tr(g).slice(c.i - 1);
      const ang = s => Math.atan2(-s.vx, -s.vz) * 180 / Math.PI;
      const se = evs(g, 'SlideEnd')[0];
      const cut = se ? T.filter(s => s.t <= se.t) : T;
      R.slide_steer_dbg = seriesEvery(T, 0.1, s => [r2(s.vx), r2(s.vz), s.sl]).slice(0, 12);
      R.slide_steer = { headingChangeDeg: r2(ang(cut[cut.length - 1]) - ang(cut[0])), overSeconds: r2(cut[cut.length - 1].t - cut[0].t), degPerSec: r2((ang(cut[cut.length - 1]) - ang(cut[0])) / (cut[cut.length - 1].t - cut[0].t)) };
    } },

  // slide start via landing: crouch pressed while airborne sprinting; lands -> slide?
  { name: 'landing_slide', dur: 5,
    start(g) { teleport(g, 0, 0, 40, 0); },
    tick(lt, dt, g, R, c) {
      const p = g.player;
      keys(g, { forward: true, sprint: true });
      pulse(g, c, 'jump', lt, 1.0);
      // press crouch mid-air 0.15 s before landing (airTime ~0.5)
      if (lt > 1.0 && !p.onGround && p.airTime > 0.5) F(g, 'crouch', true);
      if (p.onGround && lt > 1.2) { c.gt = (c.gt || 0) + dt; if (c.gt > 0.6) F(g, 'crouch', false); }
    },
    end(g, R, c) {
      const ss = evs(g, 'SlideStart'), le = evs(g, 'Land');
      R.landing_slide = { slid: ss.map(e => ({ hs: r2(e.speed) })), lands: le.map(e => ({ imp: r2(e.a) })) };
    } },
];

const S = makeScenario(phases);
export const setup = S.setup;
export const drive = S.drive;
export const finish = S.finish;
