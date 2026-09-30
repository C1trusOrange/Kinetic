// Mantle: ledges 0.4 .. 2.6 m (flat map, x 8..16, z=-52+8i). Sprint at them and jump.
import { teleport, keys, makeScenario, evs, tr, r2, r3, hs, stats, firstT } from './common.js';

const F = (g, name, on) => g.input.setVirtual(name, on);
const H = s => Math.hypot(s.vx, s.vz);
function pulse(g, c, name, lt, when, hold = 1) {
  const k = '_p_' + name + when;
  if (lt >= when && !c[k]) { c[k] = 1; c[k + 'f'] = 0; F(g, name, true); return; }
  if (c[k] === 1) { c[k + 'f']++; if (c[k + 'f'] >= hold) { c[k] = 2; F(g, name, false); } }
}
const heights = [0.4, 0.7, 1.0, 1.5, 2.0, 2.3, 2.6];
const phases = [];
heights.forEach((h, i) => {
  const zc = -52 + i * 8;
  for (const mode of ['run_jump', 'walk_jump']) {
    if (mode === 'walk_jump' && ![1.0, 1.5, 2.0].includes(h)) continue;
    phases.push({
      name: `mantle_${h}_${mode}`, dur: 3.2,
      start(g, R, c) { teleport(g, mode === 'run_jump' ? 0 : 3, 0, zc, -Math.PI / 2); },
      tick(lt, dt, g, R, c) {
        const p = g.player;
        keys(g, { forward: lt > 0.05, sprint: lt > 0.05 && mode === 'run_jump' });
        // jump when 1.6 m from the ledge face (x=8 - 0.4 radius => x = 6.0)
        if (!c.j && p.position.x >= 6.0) { c.j = 1; F(g, 'jump', true); c.jt = lt; }
        else if (c.j === 1) { c.j = 2; F(g, 'jump', false); }
        c.maxY = Math.max(c.maxY || 0, p.position.y);
      },
      end(g, R, c) {
        const T = tr(g);
        const ms = evs(g, 'Mantle')[0], me = evs(g, 'MantleEnd')[0];
        const jumps = evs(g, 'Jump');
        const o = { mantled: !!ms, jump: jumps.map(e => e.a), maxY: r2(c.maxY) };
        if (ms) {
          o.startSpeed = r2(ms.speed); o.dur = me ? r2(me.t - ms.t) : null;
          o.startAfterJump = jumps.length ? r2(ms.t - jumps[0].t) : null;
          o.startPos = [r2(ms.x), r2(ms.y)]; o.endPos = me ? [r2(me.x), r2(me.y)] : null;
          const post = T.filter(s => me && s.t >= me.t);
          o.speedAfter = post.length ? [r2(H(post[0])), r2(H(post[Math.min(post.length - 1, 30)]))] : null;
          const pre = T.filter(s => s.t < ms.t).slice(-1)[0];
          o.speedBefore = pre ? r2(H(pre)) : null;
          const fr = g.__frames.filter(f => f.t >= ms.gt - 0.05 && f.t <= (me ? me.gt : ms.gt) + 0.4);
          o.camPitchRangeDeg = [r2(Math.min(...fr.map(f => f.pitch)) * 180 / Math.PI), r2(Math.max(...fr.map(f => f.pitch)) * 180 / Math.PI)];
          o.camYRange = [r2(Math.min(...fr.map(f => f.cy))), r2(Math.max(...fr.map(f => f.cy)))];
          o.camYSeries = fr.filter((f, k) => k % 3 === 0).slice(0, 14).map(f => r2(f.cy));
        }
        R[`mantle_${h}_${mode}`] = o;
      },
    });
  }
});

// auto-mantle while airborne from a plain jump straight at a 1.5 ledge but holding no jump after take-off (ledge grab in the air)
phases.push({
  name: 'mantle_grab_in_air_2.0', dur: 3,
  start(g) { teleport(g, 0, 0, -52 + 4 * 8, -Math.PI / 2); },
  tick(lt, dt, g, R, c) {
    keys(g, { forward: true, sprint: true });
    pulse(g, c, 'jump', lt, 0.35);
  },
  end(g, R) { const ms = evs(g, 'Mantle')[0]; R.mantle_grab_in_air_2 = { mantled: !!ms, at: ms ? [r2(ms.x), r2(ms.y), r2(ms.t - tr(g)[0].t)] : null }; },
});

const S = makeScenario(phases);
export const setup = S.setup;
export const drive = S.drive;
export const finish = S.finish;
