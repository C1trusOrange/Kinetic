// Look input, lookScale, invertY, recoil recovery, sprint cancel.
import { teleport, keys, makeScenario, installLog, r2 } from './common.js';

const phases = [
  { name: 'look', dur: 1,
    start(g, R, c) { teleport(g, 2, 0, 50, 0); c.y0 = g.player.yaw; g.player.lookScale = 1; },
    tick(lt, dt, g, R, c) {
      const p = g.player;
      if (lt < 0.05 && !c.d1) { c.d1 = true; g.input.addLook(100, 0); }
      if (lt > 0.3 && !c.r1) { c.r1 = { yaw: r2(p.yaw - c.y0) }; c.y1 = p.yaw; p.lookScale = 0.5; g.input.addLook(100, 0); }
      if (lt > 0.6 && !c.r2) { c.r2 = { yaw: r2(p.yaw - c.y1) }; c.p1 = p.pitch; g.input.addLook(0, 100); }
      if (lt > 0.8 && !c.r3) { c.r3 = { pitchDelta: r2(p.pitch - c.p1) }; p.lookScale = 1; }
    },
    end(g, R, c) {
      const sens = g.settings.get('sensitivity');
      R.look = { sensitivity: sens, yawFor100Counts: c.r1.yaw, expected: r2(-100 * 0.0022 * sens), yawAtHalfScale: c.r2.yaw, pitchFor100CountsDownAtHalfScale: c.r3.pitchDelta, note: 'positive x turns right (yaw decreases), positive y looks down (pitch decreases)' };
    } },

  { name: 'recoil', dur: 5,
    start(g, R, c) { teleport(g, 2, 0, 50, 0); c.log = []; g.player.pitch = 0; c.n = 0; },
    tick(lt, dt, g, R, c) {
      const p = g.player;
      if (lt > 0.2 && c.n < 5 && lt > 0.2 + c.n * 0.1) { c.n++; p.addRecoil(0.02, 0.004 * (c.n % 2 ? 1 : -1)); g.time += 0; }
      if ([0.9, 1.5, 2.5].some(x => lt > x && !c['s' + x])) { const x = [0.9, 1.5, 2.5].find(x => lt > x && !c['s' + x]); c['s' + x] = true; c.log.push([x, r2(p.pitch * 1000) / 1000]); }
    },
    end(g, R, c) { R.recoil = { totalKick: 0.1, pitchAt: c.log, expectedFinal: 'about 30% of the kick (0.03) remains' }; } },

  { name: 'recoil_compensated', dur: 4,
    start(g, R, c) { teleport(g, 2, 0, 50, 0); g.player.pitch = 0; c.n = 0; c.log = []; },
    tick(lt, dt, g, R, c) {
      const p = g.player;
      if (lt > 0.2 && c.n < 5 && lt > 0.2 + c.n * 0.1) {
        c.n++; p.addRecoil(0.02, 0);
        // the player pulls down by the same angle: counts = 0.02 / (0.0022 * sensitivity)
        g.input.addLook(0, 0.02 / (0.0022 * g.settings.get('sensitivity')));
      }
      if (lt > 3 && !c.done) { c.done = true; c.final = p.pitch; }
    },
    end(g, R, c) { R.recoil_compensated = { finalPitch: r2(c.final * 1000) / 1000, note: 'player pulled down exactly the kick: should end near 0 (not below)' }; } },

  { name: 'sprint_cancel', dur: 4,
    start(g, R, c) { teleport(g, 2, 0, 50, 0); c.log = []; },
    tick(lt, dt, g, R, c) {
      const p = g.player;
      keys(g, { forward: true, sprint: true });
      if (lt > 1.2 && !c.cancelled) { c.cancelled = true; p.cancelSprint(); c.after0 = p.isSprinting; }
      if (c.cancelled && lt > 1.2 + 0.2 && c.a1 === undefined) c.a1 = p.isSprinting;
      if (lt > 2.0 && c.a2 === undefined) c.a2 = p.isSprinting;
    },
    end(g, R, c) { R.sprint_cancel = { immediately: c.after0, after0p2s: c.a1, after0p8s: c.a2 }; } },
];
const S = makeScenario(phases, { setup: g => installLog(g) });
export const setup = S.setup; export const drive = S.drive; export const finish = S.finish;
