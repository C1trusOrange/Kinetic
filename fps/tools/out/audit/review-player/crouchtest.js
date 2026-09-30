import * as THREE from 'three';
import { teleport, releaseAll, r2, hs } from './common.js';
export async function setup(game, report) {
  const R = report.custom = { warnings: game.world.warnings };
  const p = game.player; p.god = true;
  game.autotest.duration = 1e9; game.state = 'loading';
  const DT = 1 / 60;
  const run = (name, secs, init, drive, sample) => {
    init();
    const out = [];
    for (let i = 0; i < Math.round(secs / DT); i++) {
      const t = i * DT;
      drive(t);
      game.input.update(); game.update(DT); game.input.endFrame();
      if (i % 12 === 0) out.push(sample(t));
    }
    R[name] = out;
    releaseAll(game);
    for (let i = 0; i < 30; i++) { game.input.update(); game.update(DT); game.input.endFrame(); }
  };
  const S = t => ({ t: r2(t), x: r2(p.position.x), y: r2(p.position.y), z: r2(p.position.z), st: p.move.state, h: r2(p.height), eye: r2(p.eyeHeight), cr: p.isCrouching, sp: r2(p.speed) });
  // 1: slide into the tunnel with ceiling 1.5 then release crouch inside
  run('tunnelSlide', 3.5, () => { teleport(game, -4, 0, 0, -Math.PI / 2, 0); p.velocity.set(11, 0, 0); },
    t => { const k = game.input; k.setVirtual('forward', true); k.setVirtual('sprint', t < 0.3); k.setVirtual('crouch', t > 0.05 && t < 1.0); }, S);
  // 2: walk in crouched-only tunnel (ceiling 1.3): hold crouch then release inside, then jump inside
  run('crouchTunnel', 6, () => { teleport(game, 17, 0, 0, -Math.PI / 2, 0); },
    t => { const k = game.input; k.setVirtual('forward', true); k.setVirtual('crouch', t < 3.0); k.setVirtual('jump', t > 3.2 && t < 3.25); }, S);
  // 3: ledge low ceiling (no mantle expected) / 4: ledge high ceiling (mantle expected)
  run('ledgeLowCeil', 2.5, () => { teleport(game, 0, 0, 14, Math.PI, 0); },
    t => { const k = game.input; k.setVirtual('forward', true); k.setVirtual('jump', t > 0.6 && t < 0.63); }, S);
  run('ledgeHighCeil', 2.5, () => { teleport(game, 13, 0, 14, Math.PI, 0); },
    t => { const k = game.input; k.setVirtual('forward', true); k.setVirtual('jump', t > 0.6 && t < 0.63); }, S);
  run('ledgeThickSlab', 2.5, () => { teleport(game, -17, 0, 14, Math.PI, 0); },
    t => { const k = game.input; k.setVirtual('forward', true); k.setVirtual('jump', t > 0.6 && t < 0.63); }, S);
  // 6: crouch-walk up a 14.7deg ramp under a flat ceiling, release crouch where the clearance is 1.45
  run('rampUnderCeiling', 5, () => { teleport(game, -29.5, 0, -30, -Math.PI / 2, 0); },
    t => { const k = game.input; k.setVirtual('forward', true); k.setVirtual('crouch', 3.0 - p.position.y < 1.45 ? false : true); },
    t => ({ ...S(t), ceilClear: r2(3.0 - p.position.y) }));
  R.rampFinal = { x: r2(p.position.x), y: r2(p.position.y), h: p.height, cr: p.isCrouching };
  // 5: 0.7 gap
  run('gap', 3, () => { teleport(game, -8.65, 0, -4, 0, 0); },
    t => { const k = game.input; k.setVirtual('forward', true); k.setVirtual('jump', t > 1.0 && t < 1.03); }, S);
  report.done = true;
}
export function drive() {}
