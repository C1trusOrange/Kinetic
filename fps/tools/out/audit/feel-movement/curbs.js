// Step-ups: sprint across curbs 0.5 / 0.35 / 0.2 m (flat map x -22..-20, -26..-24, -30..-28, z 20..30).
import { teleport, keys, makeScenario, evs, tr, r2, r3, hs } from './common.js';
const H = s => Math.hypot(s.vx, s.vz);
const phases = [{ name: 'curbs', dur: 3,
  start(g) { teleport(g, -14, 0, 25, Math.PI / 2); },
  tick(lt, dt, g, R, c) {
    keys(g, { forward: lt > 0.1, sprint: lt > 0.1 });
    const p = g.player;
    c.f = c.f || []; if (lt > 0.3) c.f.push([g.camera.position.y, p.position.y, p.speed, g.camera.position.x, g.time]);
  },
  end(g, R, c) {
    const F = c.f; let maxJump = 0, maxJumpAt = null, minSpeed = 99;
    for (let i = 1; i < F.length; i++) {
      const d = Math.abs((F[i][0] - F[i - 1][0]) - (F[i][1] - F[i - 1][1]));
      if (d > maxJump) { maxJump = d; maxJumpAt = F[i][3]; }
      if (F[i][3] < -19) minSpeed = Math.min(minSpeed, F[i][2]);
    }
    const T = tr(g);
    R.curbs = { camExtraJerkMax_m: r3(maxJump), atX: r2(maxJumpAt), minSpeedOverCurbs: r2(minSpeed), airSteps: T.filter(s => !s.g).length, camYRange: [r2(Math.min(...F.map(f => f[0]))), r2(Math.max(...F.map(f => f[0])))] };
    // frame-to-frame camera y deltas near each curb crossing
    const cross = [-20.5, -24.5, -28.5].map(x => { const i = F.findIndex(f => f[3] < x); return i < 0 ? null : F.slice(Math.max(0, i - 3), i + 6).map(f => r3(f[0])); });
    R.curbs.camYAroundCrossings = cross;
  } }];
const S = makeScenario(phases);
export const setup = S.setup, drive = S.drive, finish = S.finish;
