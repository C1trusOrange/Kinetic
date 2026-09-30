// Momentum chains: slide-jump landing, slide-hop, sprint->slide->jump->wall-run->wall-jump, and config experiments (?exp=name).
import { MOVE as M } from '/src/player/MoveConfig.js';
import { teleport, keys, makeScenario, evs, tr, r2, r3, hs, stats, firstT } from './common.js';

const q = new URLSearchParams(location.search);
const F = (g, name, on) => g.input.setVirtual(name, on);
const H = s => Math.hypot(s.vx, s.vz);
const seriesEvery = (T, dtS, f) => { const out = []; if (!T.length) return out; let next = T[0].t; for (const s of T) if (s.t >= next) { out.push(f(s)); next += dtS; } return out; };
function pulse(g, c, name, lt, when, hold = 1) {
  const k = '_p_' + name + when;
  if (lt >= when && !c[k]) { c[k] = 1; c[k + 'f'] = 0; F(g, name, true); return; }
  if (c[k] === 1) { c[k + 'f']++; if (c[k + 'f'] >= hold) { c[k] = 2; F(g, name, false); } }
}
const exp = q.get('exp');

// ---- experiments: apply tuning changes at runtime (scratch only; the source files are not touched)
function applyExp(g) {
  const p = g.player, mv = p.move;
  if (!exp) return;
  const list = exp.split(',');
  for (const e of list) {
    if (e.startsWith('set:')) { for (const kv of e.slice(4).split('|')) { const [k, v] = kv.split('='); M[k] = parseFloat(v); } }
    if (e === 'slide_v2') {
      // proposal: boost 3.0, exponential friction 0.4 + constant 1.6 m/s^2 decel
      M.SLIDE_BOOST = 3.0; M.SLIDE_FRICTION = 0.4;
      const o = mv._groundStep.bind(mv);
      mv._groundStep = dt => {
        if (mv.sliding) { const v = p.velocity; const sp = Math.hypot(v.x, v.z); if (sp > 0.01) { const k = Math.min(sp, 1.6 * dt) / sp; v.x *= 1 - k; v.z *= 1 - k; } }
        o(dt);
      };
    }
    if (e === 'overspeed_v2') {
      // proposal: excess speed over sprint (on ground, not sliding) decays at 2.0/s instead of 7/s; cap 20
      const o = mv._groundStep.bind(mv);
      mv._groundStep = dt => {
        const v = p.velocity;
        if (!mv.sliding) {
          const sp = Math.hypot(v.x, v.z);
          if (sp > M.SPRINT_SPEED + 0.2) {
            const over = sp - M.SPRINT_SPEED;
            const want = M.SPRINT_SPEED + over * Math.exp(-2.0 * dt);
            const willBe = Math.max(sp - Math.max(sp, M.STOP_SPEED) * M.FRICTION * dt, 0);
            if (willBe > 0) { const k = want / willBe; if (k > 1) { v.x *= Math.min(k, 1.3); v.z *= Math.min(k, 1.3); } }
          }
        }
        o(dt);
      };
    }
    if (e === 'wr_pop') {
      const orig = mv._startWallRun.bind(mv);
      mv._startWallRun = s => { orig(s); if (p.velocity.y < 4.2) p.velocity.y = 4.2; };
    }
    if (e === 'wr_grav') { M.WALLRUN_GRAV_START = 0.06; M.WALLRUN_SINK_START = 0.25; M.WALLRUN_TIME = 2.0; }
    if (e === 'wr_min_h') { M.WALLRUN_MIN_HEIGHT = 0.55; }
    if (e === 'slide_fric') { M.SLIDE_FRICTION = 0.35; }
    if (e === 'slide_const') {
      // constant deceleration slide: replace friction by 2.4 m/s^2 + 0.25 proportional
      M.SLIDE_FRICTION = 0.25;
      const o = mv._groundStep.bind(mv);
      mv._groundStep = dt => {
        if (mv.sliding) { const v = p.velocity; const sp = Math.hypot(v.x, v.z); if (sp > 0.01) { const k = Math.min(sp, 2.4 * dt) / sp; v.x *= 1 - k; v.z *= 1 - k; } }
        o(dt);
      };
    }
    if (e === 'overspeed_fric') {
      // gentler friction when above sprint speed on the ground
      const o = mv._groundStep.bind(mv);
      mv._groundStep = dt => {
        const v = p.velocity;
        if (!mv.sliding) {
          const sp = Math.hypot(v.x, v.z);
          if (sp > M.SPRINT_SPEED + 0.2) {
            // pre-compensate the friction the base step will apply: keep (sp - sprint) decaying at ~2.2/s instead of ~7/s
            const over = sp - M.SPRINT_SPEED;
            const want = M.SPRINT_SPEED + over * Math.exp(-2.2 * dt);
            const willBe = Math.max(sp - Math.max(sp, M.STOP_SPEED) * M.FRICTION * dt, 0);
            if (willBe > 0) { const k = want / willBe; if (k > 1) { v.x *= Math.min(k, 1.3); v.z *= Math.min(k, 1.3); } }
          }
        }
        o(dt);
      };
    }
    if (e === 'mantle_keep') {
      const o = mv._finishMantle.bind(mv);
      mv._finishMantle = () => { const sp = mv.entrySpeed || 0; o(); const d = mv.mantleDir; const s2 = Math.min(8, Math.max(M.MANTLE_EXIT_SPEED, sp * 0.65)); p.velocity.set(d.x * s2, 0, d.z * s2); };
      const t = mv._tryMantle.bind(mv);
      mv._tryMantle = (fg) => { const sp = Math.hypot(p.velocity.x, p.velocity.z); const r = t(fg); if (r) mv.entrySpeed = sp; return r; };
    }
  }
}

const phases = [
  { name: 'slide_basic_e', dur: 5,
    start(g) { teleport(g, 0, 0, 56, 0); },
    tick(lt, dt, g, R, c) {
      keys(g, { forward: lt > 0.1, sprint: lt > 0.1 && lt < 1.3, crouch: lt >= 1.3 });
      if (lt >= 1.3 && !c.i) c.i = g.__trace.length;
    },
    end(g, R, c) {
      const T = tr(g).slice(c.i - 1);
      const sl = evs(g, 'SlideStart')[0], se = evs(g, 'SlideEnd')[0];
      R.slide_basic_e = { start: sl ? r2(sl.speed) : null, dur: sl && se ? r2(se.t - sl.t) : 'still', dist: sl && se ? r2(Math.hypot(se.x - sl.x, se.z - sl.z)) : null,
        t_below_sprint: firstT(T.filter(s => s.sl), s => H(s) < 9.6), speed_0_15: seriesEvery(T, 0.15, s => r2(H(s))).slice(0, 14) };
    } },
  { name: 'slide_jump_land_plain', dur: 4,
    start(g) { teleport(g, 0, 0, 56, 0); },
    tick(lt, dt, g, R, c) {
      keys(g, { forward: lt > 0.05, sprint: lt > 0.05 && lt < 1.3 || (g.player.onGround && lt > 2) });
      pulse(g, c, 'crouch', lt, 1.3, 30); // hold crouch briefly (0.25 s of frames ~ variable) -> released below
      pulse(g, c, 'jump', lt, 1.3);
      if (c['_p_crouch1.3'] === 2 || lt > 1.5) F(g, 'crouch', false);
      if (evs(g, 'Land').length && !c.l) { c.l = g.__trace.length; }
    },
    end(g, R, c) {
      const T = tr(g).slice(Math.max(0, (c.l || 1) - 1));
      const js = evs(g, 'Jump').map(e => ({ ty: e.a, hs: r2(e.speed) }));
      R.slide_jump_land_plain = { jumps: js, afterLand_hs: seriesEvery(T, 0.03, s => r2(H(s))).slice(0, 10) };
    } },
  { name: 'slide_jump_land_slide', dur: 4.5,
    start(g) { teleport(g, 0, 0, 56, 0); },
    tick(lt, dt, g, R, c) {
      const p = g.player;
      keys(g, { forward: lt > 0.05, sprint: lt > 0.05 && lt < 1.3 || (p.onGround && lt > 2.5) });
      if (lt >= 1.3 && !c.a) { c.a = 1; F(g, 'crouch', true); F(g, 'jump', true); }
      else if (c.a === 1) { c.a = 2; F(g, 'jump', false); }
      // crouch stays held: in the air airTime>0.45 keep pressed; release 0.4 s after landing
      if (c.a === 2 && p.onGround && !c.gl) { c.gl = 1; c.glt = lt; }
      F(g, 'crouch', lt >= 1.3 && !(c.gl && lt - c.glt > 0.3) && (c.a === 1 || !p.onGround ? (c.a === 1 || p.airTime > 0.45) : true));
    },
    end(g, R, c) {
      const T = tr(g);
      const ss = evs(g, 'SlideStart'), le = evs(g, 'Land');
      R.slide_jump_land_slide = { slides: ss.map(e => ({ t: r2(e.t - T[0].t), hs: r2(e.speed) })), lands: le.map(e => ({ t: r2(e.t - T[0].t), imp: r2(e.a) })), speed_every0_15: seriesEvery(T.filter(s => s.t - T[0].t > 1.2), 0.15, s => r2(H(s))).slice(0, 22) };
    } },
  { name: 'slide_hop_x3', dur: 8,
    start(g) { teleport(g, 0, 0, 56, 0); },
    tick(lt, dt, g, R, c) {
      const p = g.player;
      keys(g, { forward: lt > 0.05, sprint: lt > 0.05 && !p.isCrouching });
      // immediate slide-jump each time we're on the ground and fast enough: press C+Space
      if (lt > 1.0 && p.onGround && p.speed > 6.6 && !c.cool) { F(g, 'crouch', true); F(g, 'jump', true); c.cool = 1; c.ct = lt; }
      else if (c.cool && lt - c.ct > 0.05) F(g, 'jump', false);
      if (c.cool && !p.onGround) c.air = 1;
      // release crouch in the air after 0.2 s, then on landing allow next
      if (c.cool && !p.onGround && p.airTime > 0.2) F(g, 'crouch', false);
      if (c.cool && p.onGround && c.air && lt - c.ct > 0.3) { c.cool = 0; c.air = 0; }
    },
    end(g, R, c) {
      const T = tr(g);
      const js = evs(g, 'Jump').filter(e => e.a === 'slide' || e.a === 'ground');
      R.slide_hop_x3 = { jumps: js.map(e => ({ t: r2(e.t - T[0].t), ty: e.a, hs: r2(e.speed) })), lands: evs(g, 'Land').map(e => r2(e.speed)), speed_every0_3: seriesEvery(T, 0.3, s => r2(H(s))).slice(0, 26), dist: r2(T[0].z - T[T.length - 1].z) };
    } },
  { name: 'chain_slide_wall', dur: 6,
    start(g) { teleport(g, -8.6, 0, 56, 0.3); },
    tick(lt, dt, g, R, c) {
      const p = g.player;
      keys(g, { forward: lt > 0.05, sprint: lt > 0.05 && lt < 1.0 });
      if (lt >= 1.0 && !c.a) { c.a = 1; F(g, 'crouch', true); F(g, 'jump', true); }
      else if (c.a === 1) { c.a = 2; F(g, 'jump', false); F(g, 'crouch', false); }
      if (p.isWallRunning) c.wr = (c.wr || 0) + dt;
      if (c.wr > 0.5 && !c.wj) { c.wj = 1; F(g, 'jump', true); } else if (c.wj === 1) { c.wj = 2; F(g, 'jump', false); }
      c.maxHs = Math.max(c.maxHs || 0, p.speed);
    },
    end(g, R, c) {
      const T = tr(g);
      R.chain_slide_wall = { events: evs(g, null).filter(e => ['Jump', 'WallRunStart', 'WallRunEnd', 'SlideStart', 'Land'].includes(e.ev)).map(e => `${e.ev}${e.a && typeof e.a === 'string' ? ':' + e.a : ''}@${r2(e.t - T[0].t)} hs${r2(e.speed)} y${r2(e.y)}`), maxHs: r2(c.maxHs) };
    } },
  { name: 'wr_ground_entry', dur: 5,
    start(g) { teleport(g, -8.4, 0, 56, 0.3); },
    tick(lt, dt, g, R, c) { keys(g, { forward: lt > 0.05, sprint: lt > 0.05 }); pulse(g, c, 'jump', lt, 0.5); c.maxY = Math.max(c.maxY || 0, g.player.position.y); },
    end(g, R, c) {
      const T = tr(g); const ws = evs(g, 'WallRunStart')[0], we = evs(g, 'WallRunEnd')[0];
      const seg = ws ? T.filter(s => s.t >= ws.t && (!we || s.t <= we.t)) : [];
      R.wr_ground_entry = ws ? { dur: we ? r2(we.t - ws.t) : null, end: we ? we.a : null, maxY: r2(c.maxY), dist: we ? r2(Math.hypot(we.x - ws.x, we.z - ws.z)) : null, ySeries: seriesEvery(seg, 0.25, s => r2(s.y)), vySeries: seriesEvery(seg, 0.25, s => r2(s.vy)) } : { none: true };
    } },
  { name: 'wr_walljump_from_ground_entry', dur: 5,
    start(g) { teleport(g, -8.4, 0, 56, 0.3); },
    tick(lt, dt, g, R, c) {
      const p = g.player; keys(g, { forward: lt > 0.05, sprint: lt > 0.05 }); pulse(g, c, 'jump', lt, 0.5);
      if (p.isWallRunning) c.wr = (c.wr || 0) + dt;
      if (c.wr > 0.9 && !c.wj) { c.wj = 1; F(g, 'jump', true); } else if (c.wj === 1) { c.wj = 2; F(g, 'jump', false); }
      c.maxY = Math.max(c.maxY || 0, p.position.y);
    },
    end(g, R, c) { const wj = evs(g, 'Jump').find(e => e.a === 'wall'); R.wr_walljump_from_ground_entry = { wj: wj ? { y: r2(wj.y), hs: r2(wj.speed) } : null, maxY: r2(c.maxY) }; } },
  { name: 'mantle_run_2.0', dur: 3,
    start(g) { teleport(g, 0, 0, -52 + 4 * 8, -Math.PI / 2); },
    tick(lt, dt, g, R, c) {
      const p = g.player; keys(g, { forward: lt > 0.05, sprint: lt > 0.05 });
      if (!c.j && p.position.x >= 6.0) { c.j = 1; F(g, 'jump', true); } else if (c.j === 1) { c.j = 2; F(g, 'jump', false); }
    },
    end(g, R, c) {
      const T = tr(g); const ms = evs(g, 'Mantle')[0], me = evs(g, 'MantleEnd')[0];
      const post = me ? T.filter(s => s.t >= me.t) : [];
      R.mantle_run_2 = ms ? { dur: me ? r2(me.t - ms.t) : null, speedAfter: seriesEvery(post, 0.05, s => r2(H(s))).slice(0, 8), before: r2(ms.speed) } : { none: true };
    } },
];

const S = makeScenario(phases, { setup: g => applyExp(g) });
export const setup = S.setup;
export const drive = S.drive;
export const finish = S.finish;
