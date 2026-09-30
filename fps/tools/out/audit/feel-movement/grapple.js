// Grapple: pull profile, arrival, release momentum, cooldown, top-out. Flat test map (tower x36..44 26 m) and sandbox (?sb=1).
import * as THREE from 'three';
import { teleport, keys, makeScenario, evs, tr, r2, r3, hs, stats, firstT } from './common.js';

const F = (g, name, on) => g.input.setVirtual(name, on);
const H = s => Math.hypot(s.vx, s.vz);
const V3 = s => Math.hypot(s.vx, s.vy, s.vz);
const seriesEvery = (T, dtS, f) => { const out = []; if (!T.length) return out; let next = T[0].t; for (const s of T) if (s.t >= next) { out.push(f(s)); next += dtS; } return out; };
function pulse(g, c, name, lt, when, hold = 1) {
  const k = '_p_' + name + when;
  if (lt >= when && !c[k]) { c[k] = 1; c[k + 'f'] = 0; F(g, name, true); return; }
  if (c[k] === 1) { c[k + 'f']++; if (c[k + 'f'] >= hold) { c[k] = 2; F(g, name, false); } }
}

function gsum(g, R, name, c) {
  const T = tr(g);
  const ev = evs(g, 'grapple');
  const t0 = T[0].t;
  const at = n => { const e = ev.find(x => x.a === n); return e ? e : null; };
  const fire = at('fire'), att = at('attach'), rel = ev.find(x => x.a === 'release'), miss = at('miss');
  const o = { fireT: fire ? r2(fire.t - t0) : null, attachDelay: att && fire ? r2(att.t - fire.t) : null, missT: miss ? r2(miss.t - t0) : null };
  if (att) {
    const end = rel ? rel.t : T[T.length - 1].t;
    const seg = T.filter(s => s.t >= att.t && s.t <= end);
    o.pullDur = rel ? r2(rel.t - att.t) : 'still';
    o.releaseReason = rel ? rel.reason : null;
    o.speed3dSeries_0_2 = seriesEvery(seg, 0.2, s => r2(V3(s)));
    o.ySeries_0_2 = seriesEvery(seg, 0.2, s => r2(s.y));
    o.peak3d = stats(seg, V3).max;
    o.releaseSpeed3d = rel ? r2(Math.hypot(rel.vx, rel.vy, rel.vz)) : null;
    o.releaseVel = rel ? [r2(rel.vx), r2(rel.vy), r2(rel.vz)] : null;
    o.releasePos = rel ? [r2(rel.x), r2(rel.y), r2(rel.z)] : null;
    o.distanceCovered = seg.length ? r2(Math.hypot(seg[seg.length - 1].x - seg[0].x, seg[seg.length - 1].y - seg[0].y, seg[seg.length - 1].z - seg[0].z)) : null;
    // after release: what happens in the next 1.0 s
    if (rel) {
      const post = T.filter(s => s.t >= rel.t && s.t <= rel.t + 1.2);
      o.postRelease_speed3d = seriesEvery(post, 0.2, s => r2(V3(s)));
      o.postRelease_y = seriesEvery(post, 0.2, s => r2(s.y));
      o.postRelease_hs = seriesEvery(post, 0.2, s => r2(H(s)));
    }
  }
  const last = T[T.length - 1];
  o.final = [r2(last.x), r2(last.y), r2(last.z)];
  o.events = ev.map(e => e.a + (e.reason ? ':' + e.reason : '') + '@' + r2(e.t - t0));
  o.mantles = evs(g, 'Mantle').length;
  o.chargeEnd = r2(g.player.grappleCharge);
  Object.assign(o, c.extra || {});
  R[name] = o;
}

const sb = new URLSearchParams(location.search).get('sb');
let phases;
if (!sb) {
  phases = [
    { name: 'gr_far_34m', dur: 6,
      start(g) { teleport(g, 6, 0, 0, -Math.PI / 2, 0.5); },
      tick(lt, dt, g, R, c) { pulse(g, c, 'grapple', lt, 0.3); },
      end(g, R, c) { gsum(g, R, 'gr_far_34m', c); } },
    { name: 'gr_near_8m', dur: 5,
      start(g) { teleport(g, 28, 0, 0, -Math.PI / 2, 0.3); },
      tick(lt, dt, g, R, c) { pulse(g, c, 'grapple', lt, 0.3); },
      end(g, R, c) { gsum(g, R, 'gr_near_8m', c); } },
    { name: 'gr_jump_release_mid', dur: 6,
      start(g) { teleport(g, 6, 0, 0, -Math.PI / 2, 0.5); },
      tick(lt, dt, g, R, c) {
        pulse(g, c, 'grapple', lt, 0.3);
        if (g.player.isGrappling) { c.gt = (c.gt || 0) + dt; }
        if (c.gt > 0.9 && !c.j) { c.j = 1; F(g, 'jump', true); c.extra = { vBeforeJump: [r2(g.player.velocity.x), r2(g.player.velocity.y), r2(g.player.velocity.z)] }; }
        else if (c.j === 1) { c.j = 2; F(g, 'jump', false); }
      },
      end(g, R, c) { gsum(g, R, 'gr_jump_release_mid', c); } },
    { name: 'gr_manual_release_mid', dur: 6,
      start(g) { teleport(g, 6, 0, 0, -Math.PI / 2, 0.5); },
      tick(lt, dt, g, R, c) {
        pulse(g, c, 'grapple', lt, 0.3);
        if (g.player.isGrappling) { c.gt = (c.gt || 0) + dt; }
        if (c.gt > 0.9 && !c.j) { c.j = 1; F(g, 'grapple', true); }
        else if (c.j === 1) { c.j = 2; F(g, 'grapple', false); }
      },
      end(g, R, c) { gsum(g, R, 'gr_manual_release_mid', c); } },
    { name: 'gr_cooldown', dur: 9,
      start(g) { teleport(g, 6, 0, 0, -Math.PI / 2, 0.5); },
      tick(lt, dt, g, R, c) {
        const p = g.player;
        // fire at 0.3; after attach release manually at +0.4; then refire attempts every 0.5 s; log when a hook flies again
        pulse(g, c, 'grapple', lt, 0.3);
        if (p.isGrappling) c.gt = (c.gt || 0) + dt;
        if (c.gt > 0.4 && !c.rel) { c.rel = 1; F(g, 'grapple', true); c.relT = lt; }
        else if (c.rel === 1) { c.rel = 2; F(g, 'grapple', false); }
        if (c.rel === 2) {
          const k = Math.floor((lt - c.relT) / 0.5);
          if (k !== c.lastK) { c.lastK = k; c.tries = c.tries || []; F(g, 'grapple', true); c.pend = true; c.tries.push([r2(lt - c.relT), r2(p.grappleCharge)]); }
          else if (c.pend) { F(g, 'grapple', false); c.pend = false; }
        }
      },
      end(g, R, c) {
        const ev = evs(g, 'grapple');
        const t0 = tr(g)[0].t;
        R.gr_cooldown = { events: ev.map(e => e.a + '@' + r2(e.t - t0)), tryCharges: c.tries };
      } },
    { name: 'gr_miss_cooldown', dur: 4,
      start(g) { teleport(g, 6, 0, 0, 0, 0.9); },
      tick(lt, dt, g, R, c) {
        pulse(g, c, 'grapple', lt, 0.3);
        pulse(g, c, 'grapple', lt, 0.9);
        pulse(g, c, 'grapple', lt, 1.3);
      },
      end(g, R, c) { const ev = evs(g, 'grapple'); const t0 = tr(g)[0].t; R.gr_miss_cooldown = { events: ev.map(e => e.a + '@' + r2(e.t - t0)) }; } },
    { name: 'gr_topout_25m', dur: 7,
      start(g) { teleport(g, 18, 0, 0, -Math.PI / 2, 0.93); },
      tick(lt, dt, g, R, c) { pulse(g, c, 'grapple', lt, 0.3); keys(g, { forward: lt > 1.5 }); },
      end(g, R, c) { gsum(g, R, 'gr_topout_25m', c); } },
    // grapple + swing: attach to the beam from a lateral offset while running; does the rope arc?
    { name: 'gr_beam_swing', dur: 7,
      start(g) { teleport(g, 32, 0, 6, Math.PI, 0.95); },
      tick(lt, dt, g, R, c) { pulse(g, c, 'grapple', lt, 0.3); keys(g, { right: lt > 1.0, forward: false }); },
      end(g, R, c) { gsum(g, R, 'gr_beam_swing', c); } },
  ];
} else {
  // sandbox tower: platform y=16 x 17..27, z -21..-11. Player at (12,0,-16)... pad is at (12,0,-16); use x=8.
  phases = [
    ...[0.95, 1.05, 1.15, 1.25].map(pitch => ({
      name: 'sb_tower_pitch_' + pitch, dur: 8,
      start(g) { teleport(g, 8, 0, -16, -Math.PI / 2, pitch); },
      tick(lt, dt, g, R, c) { pulse(g, c, 'grapple', lt, 0.3); keys(g, { forward: lt > 1.0 }); },
      end(g, R, c) { gsum(g, R, 'sb_tower_pitch_' + pitch, c); },
    })),
  ];
}

const S = makeScenario(phases);
export const setup = S.setup;
export const drive = S.drive;
export const finish = S.finish;
