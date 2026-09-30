import { teleport, keys, makeScenario, r2 } from './common.js';
const log = [];
const phases = [{
  name: 'ramp', dur: 3.5,
  start(g, R, c) {
    teleport(g, 47, 0, 45, -Math.PI / 2);
    const m = g.player.move;
    const o = m._tryStepUp.bind(m);
    m._tryStepUp = (pre, vH, dt, md) => { const ok = o(pre, vH, dt, md); c.tsu = (c.tsu || 0) + 1; if (ok) c.tsuOk = (c.tsuOk || 0) + 1; c.lastTSU = ok ? 'ok' : 'no'; return ok; };
    const gs = m._groundStep.bind(m);
    m._groundStep = dt => { const a = m.capsule.start.clone(); gs(dt); const b = m.capsule.start; c.stepLog = c.stepLog || []; if (b.x > 49 && b.x < 52 && c.stepLog.length < 40) c.stepLog.push(`x ${a.x.toFixed(3)}->${b.x.toFixed(3)} y ${a.y.toFixed(3)}->${b.y.toFixed(3)} vy=${g.player.velocity.y.toFixed(2)} gr=${m.grounded} tsu=${c.lastTSU}`); c.lastTSU = ''; };
  },
  tick(lt, dt, g, R, c) {
    keys(g, { forward: lt > 0.1, sprint: lt > 0.1 });
    const cam = g.camera.position;
    if (c.last && c.lastDt > 0 && lt > 1.0) {
      const vy = (cam.y - c.last.y) / c.lastDt, sp = Math.hypot(cam.x - c.last.x, cam.z - c.last.z) / c.lastDt;
      if (Math.abs(vy - 3.9) > 7 || sp > 11) log.push(`lt=${lt.toFixed(3)} camx=${cam.x.toFixed(2)} vy=${vy.toFixed(1)} sp=${sp.toFixed(1)} dt=${c.lastDt.toFixed(4)} pos.y=${g.player.position.y.toFixed(3)} off=${g.player.stepOffset.toArray().map(v => v.toFixed(3))}`);
    }
    c.last = cam.clone(); c.lastDt = dt;
  },
  end(g, R, c) { R.log = log.slice(0, 25); R.stepLog = c.stepLog; R.tsu = [c.tsu, c.tsuOk]; },
}];
const S = makeScenario(phases);
export const setup = S.setup; export const drive = S.drive; export const finish = S.finish;
