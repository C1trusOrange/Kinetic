const S = { phase: 0, t0: 0, samples: [] };
export function setup(game, report) {
  report.custom = S;
  for (const b of game.bots.list.slice(1)) b.god = true;
}
export function drive(t, dt, game, report) {
  const b = game.bots.list[0];
  if (S.phase === 0 && t > 2) {
    game.combat.kill(b, { attacker: null, weapon: 'test' });
    S.phase = 1; S.t0 = t;
  } else if (S.phase === 1 && t > S.t0 + 2) {
    game.respawnEntity(b);
    b.brain.update = () => {};
    S.phase = 2; S.t0 = t;
    S.afterSpawn = { airT: b.model._airT, wasGround: b.model._wasGround };
  } else if (S.phase === 2) {
    if (t - S.t0 < 0.5) S.samples.push([+(t - S.t0).toFixed(3), b.onGround, +b.velocity.y.toFixed(2), +b.position.y.toFixed(3), +b.model._k.air.toFixed(2), +b.model._land.toFixed(3), +b.model._airT.toFixed(2), +b.model.hips.position.y.toFixed(3), +(b._noSnapUntil - game.time).toFixed(3)]);
  }
}
