import { teleport, keys, makeScenario, evs, tr, r2, r3, hs } from './common.js';
const H = s => Math.hypot(s.vx, s.vz);
const hs_ = [0.3, 0.4, 0.45, 0.5, 0.55, 0.6, 0.7, 0.9];
const phases = hs_.map((h, i) => ({ name: 'h' + h, dur: 2.0,
  start(g, R, c) { teleport(g, -4, 0, i * 8, -Math.PI / 2); c.f = []; },
  tick(lt, dt, g, R, c) { keys(g, { forward: lt > 0.1, sprint: lt > 0.1 }); if (lt > 0.6) c.f.push([g.player.speed, g.player.position.x, g.player.position.y]); },
  end(g, R, c) {
    const F = c.f; const near = F.filter(f => f[1] > 8 && f[1] < 13);
    const T = tr(g);
    const win = T.filter(x => x.x > 7 && x.x < 14 && x.t - T[0].t > 0.5);
    const below = win.filter(x => H(x) < 8).length / 120;
    R['h' + h + '_steps'] = { minSpeed: r2(Math.min(...win.map(H))), secondsBelow8: r2(below), maxY: r2(Math.max(...T.map(x => x.y))) };
    R['h' + h] = { minSpeedNear: near.length ? r2(Math.min(...near.map(f => f[0]))) : null, maxY: r2(Math.max(...F.map(f => f[2]))), passedX: r2(F[F.length - 1][1]), jumps: evs(g, 'Jump').length, mantles: evs(g, 'Mantle').length };
  } }));
const S = makeScenario(phases, { setup: g => {
  if (new URLSearchParams(location.search).get('exp') === 'stepfix') {
    const mv = g.player.move, P = g.player;
    const o = mv._tryStepUp.bind(mv), og = mv._groundStep.bind(mv);
    let fx = 0, fz = 0, prev = 0, stepped = false;
    mv._tryStepUp = (pre, vH, dt, md) => { const ok = o(pre, vH, dt, md); if (ok) stepped = true; return ok; };
    mv._groundStep = dt => {
      const v = P.velocity, sp = Math.hypot(v.x, v.z);
      if (sp >= prev * 0.9) { fx = v.x; fz = v.z; }
      prev = sp; stepped = false;
      og(dt);
      if (stepped) { v.x = fx; v.z = fz; prev = Math.hypot(fx, fz); }
    };
  }
} });
export const setup = S.setup, drive = S.drive, finish = S.finish;
