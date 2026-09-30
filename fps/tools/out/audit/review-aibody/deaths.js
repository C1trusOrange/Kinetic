const D = { byWeapon: {}, fall: [], self: 0, tele: [], nan: 0, oob: 0, maxSpeed: 0, ticks: 0, underY: 0 };
let patched = false;
export function setup(game, report) {
  report.custom = report.custom || {};
  report.custom.D = D;
  game.events.on('death', e => {
    D.byWeapon[e.weapon] = (D.byWeapon[e.weapon] || 0) + 1;
    if (e.attacker === e.victim) D.self++;
    if (e.weapon === 'fall' && D.fall.length < 12) D.fall.push({ n: e.victim.name, t: +game.time.toFixed(1), pos: e.victim.position.toArray().map(v => +v.toFixed(1)), v: e.victim.velocity.toArray().map(v => +v.toFixed(1)), st: e.victim.brain && e.victim.brain.state, lastAtt: e.victim.lastAttacker ? e.victim.lastAttacker.name : null });
  });
  const proto = Object.getPrototypeOf(game.bots.list[0]);
  if (!patched) {
    patched = true;
    const orig = proto.teleportTo;
    proto.teleportTo = function (p, y) { D.tele.push({ n: this.name, t: +game.time.toFixed(1), from: this.position.toArray().map(v => +v.toFixed(1)), stage: this.brain.stuckStage, st: this.brain.state }); return orig.call(this, p, y); };
  }
}
export function drive(t, dt, game, report) {
  D.ticks++;
  const b0 = game.world.bounds;
  for (const b of game.bots.list) {
    if (!b.alive) continue;
    const p = b.position;
    if (![p.x, p.y, p.z, b.velocity.x, b.velocity.y, b.velocity.z, b.yaw, b.pitch].every(Number.isFinite)) D.nan++;
    if (b0 && (p.x < b0.min.x || p.x > b0.max.x || p.z < b0.min.z || p.z > b0.max.z || p.y > b0.max.y)) D.oob++;
    D.maxSpeed = Math.max(D.maxSpeed, Math.hypot(b.velocity.x, b.velocity.y, b.velocity.z));
  }
}
