import * as THREE from 'three';
const S = { log: [], phase: 0, t0: 0, samples: [] };
export async function setup(game, report) {
  report.custom = S;
  for (const b of game.bots.list.slice(1)) b.god = true;
}
export function drive(t, dt, game, report) {
  const b = game.bots.list[0];
  if (S.phase === 0 && t > 2) {
    game.combat.kill(b, { attacker: null, weapon: 'test' });
    S.phase = 1; S.t0 = t;
    S.deadVisible = b.model.root.visible;
  } else if (S.phase === 1 && t > S.t0 + 3) {
    game.respawnEntity(b);
    b.brain.update = () => {}; // hold still
    S.phase = 2; S.t0 = t;
    S.afterSpawn = { visible: b.model.root.visible, onGround: b.onGround, air: b.model._k.air, ready: b.model._ready };
  } else if (S.phase === 2) {
    if (t - S.t0 < 0.6) S.samples.push({ dt: +(t - S.t0).toFixed(2), g: b.onGround, vy: +b.velocity.y.toFixed(2), py: +b.position.y.toFixed(3), air: +b.model._k.air.toFixed(2), land: +b.model._land.toFixed(3), airT: +b.model._airT.toFixed(2), hipY: +b.model.hips.position.y.toFixed(3) });
  }
}
