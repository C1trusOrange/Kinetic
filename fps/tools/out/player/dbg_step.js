import { teleport, keys, makeScenario, r2, hs } from './common.js';
const log = [];
const phases = [
  { name: 'dbg', dur: 3,
    start(g, R, c) {
      teleport(g, -27.5, 0, 25, -Math.PI / 2);
      const m = g.player.move;
      const orig = m._tryStepUp.bind(m);
      const g0 = m._groundStep.bind(m);
      m._groundStep = (dt) => {
        const a = m.capsule.start.clone();
        g0(dt);
        const b = m.capsule.start;
        if (log.length < 40 && a.x > -26.8) log.push(`  step a=(${a.x.toFixed(3)},${a.y.toFixed(3)}) b=(${b.x.toFixed(3)},${b.y.toFixed(3)}) v=(${g.player.velocity.x.toFixed(2)},${g.player.velocity.y.toFixed(2)}) grounded=${m.grounded}`);
      };
      m._tryStepUp = (pre, vH, dt, md) => {
        const vx = vH.x, vz = vH.z;
        const ok = orig(pre, vH, dt, md);
        const cc = m._capA;
        if (log.length < 40) log.push(`   capA end=(${cc.start.x.toFixed(3)},${cc.start.y.toFixed(3)})`);
        if (log.length < 25) log.push(`tryStepUp pre=(${pre.x.toFixed(3)},${pre.y.toFixed(3)}) vH=(${vx.toFixed(2)},${vz.toFixed(2)}) mainDisp=${md.toFixed(4)} -> ${ok}`);
        return ok;
      };
    },
    tick(lt, dt, g, R, c) {
      keys(g, { forward: lt > 0.1 });
      const p = g.player;
      if (p.position.x > -26.9 && c.n === undefined) c.n = 0;
      if (c.n !== undefined && c.n < 12) { c.n++; log.push(`frame x=${p.position.x.toFixed(3)} y=${p.position.y.toFixed(3)} vx=${p.velocity.x.toFixed(2)} vy=${p.velocity.y.toFixed(2)} gr=${p.onGround}`); }
    },
    end(g, R) { R.log = log; } },
];
const S = makeScenario(phases);
export const setup = S.setup; export const drive = S.drive; export const finish = S.finish;
