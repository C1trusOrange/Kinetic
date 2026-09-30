// Camera smoothness: frame-to-frame camera displacement vs the expected speed (interpolation check).
import { teleport, keys, makeScenario, installLog, r2 } from './common.js';

function smoothPhase(name, start, yaw, keyFn, axis = 'z') {
  return {
    name, dur: 4,
    start(g, R, c) { teleport(g, ...start, yaw); c.samples = []; c.last = null; c.lastDt = null; c.lastY = null; c.dy = []; c.ys = []; },
    tick(lt, dt, g, R, c) {
      keyFn(lt, g);
      const cam = g.camera.position;
      if (c.last && c.lastDt > 0 && lt > 1.2 && lt < 3.5) {
        c.samples.push(Math.hypot(cam.x - c.last.x, cam.z - c.last.z) / c.lastDt);
        c.ys.push((cam.y - c.last.y) / c.lastDt);
      }
      c.last = cam.clone();
      c.lastDt = dt;
    },
    end(g, R, c) {
      const s = c.samples;
      const mean = s.reduce((a, b) => a + b, 0) / s.length;
      const sd = Math.sqrt(s.reduce((a, b) => a + (b - mean) ** 2, 0) / s.length);
      const vy = c.ys, mvy = vy.reduce((a, b) => a + b, 0) / vy.length;
      const sdy = Math.sqrt(vy.reduce((a, b) => a + (b - mvy) ** 2, 0) / vy.length);
      R[name] = { frames: s.length, meanCamSpeed: r2(mean), stdDevCamSpeed: r2(sd), minSpeed: r2(Math.min(...s)), maxSpeed: r2(Math.max(...s)), camVy: { mean: r2(mvy), sd: r2(sdy), min: r2(Math.min(...vy)), max: r2(Math.max(...vy)) } };
    },
  };
}

const phases = [
  smoothPhase('flat_sprint', [2, 0, 58], 0, (lt, g) => keys(g, { forward: lt > 0.1, sprint: lt > 0.1 })),
  smoothPhase('steep_ramp_sprint', [47, 0, 45], -Math.PI / 2, (lt, g) => keys(g, { forward: lt > 0.1, sprint: lt > 0.1 })),
  smoothPhase('down_ramp_sprint', [50.6, 8.5, 60], -Math.PI / 2, (lt, g) => keys(g, { forward: lt > 0.1, sprint: lt > 0.1 })),
];
const S = makeScenario(phases, { setup: g => installLog(g) });
export const setup = S.setup; export const drive = S.drive; export const finish = S.finish;
