// Does the rope swing? Airborne sideways momentum + anchor above/ahead. Flat map beam y14..15, z20..24, x20..44.
import { teleport, keys, makeScenario, evs, tr, r2, r3, hs } from './common.js';
const F = (g, name, on) => g.input.setVirtual(name, on);
const V3 = s => Math.hypot(s.vx, s.vy, s.vz);
const H = s => Math.hypot(s.vx, s.vz);
const seriesEvery = (T, dtS, f) => { const out = []; if (!T.length) return out; let next = T[0].t; for (const s of T) if (s.t >= next) { out.push(f(s)); next += dtS; } return out; };
const phases = [{ name: 'swing_sideways', dur: 5,
  start(g, R, c) {
    // airborne at (24, 8, 8) moving +x at 12 m/s; look toward the beam's south face at (34, 14.5, 20): dx=10 dz=12 => yaw=pi - atan2(10,12)... forward=(-sin yaw, -cos yaw): want (0.64,0,0.77) => yaw = atan2(-0.64,-0.77)
    teleport(g, 24, 8, 8, 0, 0);
    const p = g.player; p.move.grounded = false; p.velocity.set(12, 0, 0);
    p.yaw = Math.atan2(-0.64, -0.77); const eye = 8 + 1.66; p.pitch = Math.atan2(14.5 - eye, Math.hypot(10, 12));
  },
  tick(lt, dt, g, R, c) { if (lt > 0.1 && !c.f) { c.f = 1; F(g, 'grapple', true); } else if (c.f === 1) { c.f = 2; F(g, 'grapple', false); } },
  end(g, R, c) {
    const T = tr(g); const att = evs(g, 'grapple').find(e => e.a === 'attach'); const rel = evs(g, 'grapple').find(e => e.a === 'release');
    if (!att) { R.swing = { noattach: true, events: evs(g, 'grapple').map(e => e.a) }; return; }
    const seg = T.filter(s => s.t >= att.t && (!rel || s.t <= rel.t));
    R.swing = { attachSpeedHs: r2(att.speed), pull: rel ? r2(rel.t - att.t) : 'still', reason: rel ? rel.reason : null, hs_0_15: seriesEvery(seg, 0.15, s => r2(H(s))), v3_0_15: seriesEvery(seg, 0.15, s => r2(V3(s))), x_0_15: seriesEvery(seg, 0.15, s => r2(s.x)), z_0_15: seriesEvery(seg, 0.15, s => r2(s.z)), y_0_15: seriesEvery(seg, 0.15, s => r2(s.y)) };
  } }];
const S = makeScenario(phases);
export const setup = S.setup, drive = S.drive, finish = S.finish;
