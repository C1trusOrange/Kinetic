const log = [];
let killed = false, tKill = 0, respawnT = -1;
export function setup(game, report) {
  report.custom = report.custom || {};
  report.custom.log = log;
}
function snap(t, g, b, tag) {
  return { tag, t: +t.toFixed(3), onGround: b.onGround, y: +b.position.y.toFixed(3), vy: +b.velocity.y.toFixed(2),
    air: +b.model._k.air.toFixed(2), airT: +b.model._airT.toFixed(3), land: +b.model._land.toFixed(3),
    wasG: b.model._wasGround, noSnapLeft: +(b._noSnapUntil - g.time).toFixed(3), state: b.brain.state };
}
export function drive(t, dt, game, report) {
  const b = game.bots.list[0];
  if (!b) return;
  if (t < 0.5) log.push(snap(t, game, b, 'start'));
  if (t > 2.5 && !killed && b.alive) {
    killed = true; tKill = t;
    // put the bot in mid-air state stale: force model _airT high before death
    b.model._airT = 0.9; b.model._wasGround = false;
    report.custom.preDeathAirT = b.model._airT;
    game.combat.kill(b, { attacker: game.player, weapon: 'rifle', point: b.getChestPosition(b.position.clone()), direction: null });
  }
  if (killed && b.alive && respawnT < 0) { respawnT = t; report.custom.respawnT = +t.toFixed(3); }
  if (respawnT >= 0 && t - respawnT < 0.5) log.push(snap(t, game, b, 'respawn'));
}
