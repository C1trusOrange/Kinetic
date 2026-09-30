// Jump pads on the real sandbox map: launch, ballistic arc, landing.
import * as THREE from 'three';
import { teleport, keys, makeScenario, installLog, evs, r2 } from './common.js';

let pads = [];
let T0 = 0;
const phases = [];
for (let i = 0; i < 3; i++) {
  phases.push({
    name: `pad_${i}`, dur: 5,
    start(g, R, c) {
      pads = g.world.jumpPads || [];
      c.pad = pads[i];
      if (!c.pad) return;
      const p = c.pad.position;
      teleport(g, p.x, p.y, p.z, 0);
      T0 = g.time; c.maxY = 0; c.start = p.clone();
    },
    tick(lt, dt, g, R, c) {
      if (!c.pad) return;
      const p = g.player;
      c.maxY = Math.max(c.maxY, p.position.y);
      if (lt > 0.3 && p.onGround && !c.landed && c.left) { c.landed = p.position.clone(); }
      if (!p.onGround) c.left = true;
    },
    end(g, R, c) {
      if (!c.pad) { R[`pad_${i}`] = 'no pad'; return; }
      const v = c.pad.velocity;
      // ballistic prediction
      const T = (v.y + Math.sqrt(v.y * v.y)) / 24 * 2 / 2; // rough
      R[`pad_${i}`] = { pos: c.start.toArray().map(r2), velocity: [v.x, v.y, v.z].map(r2), maxHeightAbove: r2(c.maxY - c.start.y), landed: c.landed ? c.landed.toArray().map(r2) : null, launchEvents: evs(g, T0, 'Jump').length };
    },
  });
}
const S = makeScenario(phases, { setup: g => installLog(g) });
export const setup = S.setup; export const drive = S.drive; export const finish = S.finish;
