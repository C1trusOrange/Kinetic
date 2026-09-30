import { teleport, keys, makeScenario, evs, tr, r2 } from './common.js';
const phases = [{ name: 'dbg', dur: 4,
  start(g) { teleport(g, 0, 0, 40, 0); },
  tick(lt, dt, g, R, c) {
    keys(g, { forward: lt > 0.1, sprint: lt > 0.1 && lt < 1.2, crouch: lt >= 1.2, left: lt >= 1.4 });
    c.s = c.s || [];
    if (lt > 1.9 && lt < 3 && c.s.length < 40) c.s.push([r2(lt), r2(g.player.velocity.x), r2(g.player.velocity.z), g.player.isSliding ? 1 : 0, g.player.move.in.wishX, g.player.move.in.wishZ, g.input.action('left') ? 1 : 0]);
  },
  end(g, R, c) { R.dbg = c.s; } }];
const S = makeScenario(phases);
export const setup = S.setup, drive = S.drive, finish = S.finish;
