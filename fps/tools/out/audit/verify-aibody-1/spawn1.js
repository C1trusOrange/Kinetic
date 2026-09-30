const S = { phase: 0, t0: 0, samples: [], stale: [] };
export function setup(game, report) {
  report.custom = S;
  for (const b of game.bots.list.slice(1)) b.god = true;
}
export function drive(t, dt, game, report) {
  const b = game.bots.list[0];
  if (S.phase === 0 && t > 2) {
    // freeze the bot in midair for a bit so model _airT grows, then kill
    b.brain.update = () => {};
    b.position.y += 6; b._syncCapsule(); b.velocity.set(0, 0, 0); b.onGround = false; b._noSnapUntil = game.time + 0.3;
    S.phase = 1; S.t0 = t;
  } else if (S.phase === 1 && t > S.t0 + 0.25) {
    S.preKillAirT = b.model._airT; S.preKillWasGround = b.model._wasGround; S.preKillAir = b.model._k.air;
    game.combat.kill(b, { attacker: null, weapon: 'test' });
    S.phase = 2; S.t0 = t;
  } else if (S.phase === 2 && t > S.t0 + 2) {
    game.respawnEntity(b);
    b.brain.update = () => {};
    S.phase = 3; S.t0 = t;
    S.afterSpawn = { airT: b.model._airT, wasGround: b.model._wasGround, ready: b.model._ready };
  } else if (S.phase === 3) {
    if (t - S.t0 < 0.7) S.samples.push({ dt: +(t - S.t0).toFixed(3), g: b.onGround, vy: +b.velocity.y.toFixed(2), py: +b.position.y.toFixed(3), air: +b.model._k.air.toFixed(2), land: +b.model._land.toFixed(3), airT: +b.model._airT.toFixed(2), hipY: +b.model.hips.position.y.toFixed(3) });
  }
}
