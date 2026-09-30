// Ramps: walking, running, sliding, jitter and grounding.
import { teleport, keys, makeScenario, installLog, evs, r2, hs } from './common.js';

const RAMPS = {
  gentle: { z: 30, h: 3.5 },   // rises toward +x
  steep: { z: 45, h: 9 },      // rises toward +x
  down: { z: 60, h: 9 },       // rises toward -x
};
const surf = (name, x) => {
  const r = RAMPS[name];
  const u = Math.min(1, Math.max(0, (x - 50) / 20));
  return name === 'down' ? r.h * (1 - u) : r.h * u;
};

function rampPhase(name, ramp, x0, dir, opts = {}) {
  return {
    name, dur: opts.dur || 6,
    start(g, R, c) {
      const y0 = ramp === 'gentle' || ramp === 'steep' ? surf(ramp, x0) : surf('down', x0);
      teleport(g, x0, y0, RAMPS[ramp].z, dir > 0 ? -Math.PI / 2 : Math.PI / 2);
      c.air = 0; c.frames = 0; c.maxDev = 0; c.sumDev = 0; c.maxV = 0; c.minV = 99; c.lastY = null; c.maxVy = -99; c.minVy = 99; c.slid = 0; c.maxSlide = 0;
    },
    tick(lt, dt, g, R, c) {
      const p = g.player;
      opts.keys(lt, g);
      if (c.lastY !== null) { const d2 = (p.position.y - c.lastY) - (c.lastDy ?? 0); if (lt > 0.5) c.maxJerk = Math.max(c.maxJerk || 0, Math.abs(d2)); c.lastDy = p.position.y - c.lastY; }
      c.lastY = p.position.y;
      const x = p.position.x;
      if (x > 50.5 && x < 69.5 && lt > 0.3) {
        c.frames++;
        if (!p.onGround) c.air++;
        const dev = p.position.y - surf(ramp, x);
        c.maxDev = Math.max(c.maxDev, Math.abs(dev)); c.sumDev += Math.abs(dev);
        const s = hs(p);
        c.maxV = Math.max(c.maxV, s); c.minV = Math.min(c.minV, s);
        c.maxVy = Math.max(c.maxVy, p.velocity.y); c.minVy = Math.min(c.minVy, p.velocity.y);
        if (p.isSliding) { c.slid += dt; c.maxSlide = Math.max(c.maxSlide, s); }
      }
    },
    end(g, R, c) {
      R[name] = { frames: c.frames, airborneFrames: c.air, maxDevFromSurface: r2(c.maxDev), meanDev: r2(c.sumDev / Math.max(1, c.frames)),
        speedRange: [r2(c.minV), r2(c.maxV)], vyRange: [r2(c.minVy), r2(c.maxVy)], slideTime: r2(c.slid), slidePeak: r2(c.maxSlide), maxYSecondDiff: r2(c.maxJerk || 0), finalX: r2(g.player.position.x) };
    },
  };
}

const phases = [
  rampPhase('walk_up_gentle', 'gentle', 46, 1, { keys: (lt, g) => keys(g, { forward: lt > 0.1 }) }),
  rampPhase('sprint_up_steep', 'steep', 46, 1, { keys: (lt, g) => keys(g, { forward: lt > 0.1, sprint: lt > 0.1 }) }),
  rampPhase('sprint_down', 'down', 51, 1, { keys: (lt, g) => keys(g, { forward: lt > 0.1, sprint: lt > 0.1 }), dur: 4 }),
  rampPhase('slide_down', 'down', 51, 1, { dur: 6, keys: (lt, g) => keys(g, { forward: lt > 0.1 && lt < 3, sprint: lt > 0.1 && lt < 2.5, crouch: lt > 1.2 && lt < 5 }) }),
  rampPhase('stand_on_steep', 'steep', 58, 1, { dur: 3, keys: (lt, g) => keys(g, {}) }),
  rampPhase('slide_up_steep', 'steep', 44, 1, { dur: 5, keys: (lt, g) => keys(g, { forward: lt > 0.1, sprint: lt > 0.1 && lt < 1.0, crouch: lt > 1.1 && lt < 4 }) }),
];

const S = makeScenario(phases, { setup: g => installLog(g) });
export const setup = S.setup;
export const drive = S.drive;
export const finish = S.finish;
