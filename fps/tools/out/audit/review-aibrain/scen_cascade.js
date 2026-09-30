// Deterministic repro: a low-health bot that starts a retreat while airborne loses every health pickup for 90 s.
export async function setup(game, report) {
  report.custom = { log: [] };
  for (const b of game.bots.list.slice(1)) { b.alive = false; b.model && b.model.setVisible(false); }
  const bot = game.bots.list[0];
  bot.god = true;
  const br = bot.brain;
  br.perceive = function () {};
  report.custom.healthPickups = game.world.pickups.list.filter(p => p.type === 'health').length;
  report.custom.phase = 'init';
}
let done = false;
export function drive(t, dt, game, report) {
  const bot = game.bots.list[0], br = bot.brain, c = report.custom;
  if (t > 1 && !done) {
    done = true;
    // ground position near the map center, then launched up (like a rocket splash / jump pad)
    const nav = game.world.nav;
    const n = nav._main.find(n => Math.abs(n.position.x) < 6 && Math.abs(n.position.z) < 6 && n.position.y < 0.5) || nav._main[0];
    bot.teleportTo(n.position.clone(), 0);
    bot.health = 30;   // above the retreat threshold: the state machine does not retreat yet
    bot.applyImpulse({ x: 0, y: 22, z: 0, isVector3: false });
    c.start = { pos: n.position.toArray(), health: bot.health };
    c.marker = t;
  }
  if (done && !c.hurt && bot.position.y > 6 && !bot.onGround) {
    // a hit while flying up (jump pad / rocket splash): health drops below the retreat threshold
    c.hurt = true;
    bot.health = 12;
    c.hurtAt = +(t - c.marker).toFixed(2);
    c.hurtY = +bot.position.y.toFixed(1);
  }
  if (done) {
    const el = t - c.marker;
    if (el > 0 && (c.log.length < 40) && Math.floor(el * 10) !== Math.floor((el - dt) * 10)) {
      c.log.push({ el: +el.toFixed(2), y: +bot.position.y.toFixed(1), ground: bot.onGround, state: br.state, kind: br.retreatKind, ignored: br._ignored.size, unreach: br.nav.unreachable, mode: br.nav.mode });
    }
  }
}
export function finish(game, report) {
  const br = game.bots.list[0].brain, t = game.time;
  report.custom.ignoredHealthAtEnd = [...br._ignored.entries()].filter(([p, u]) => p.type === 'health' && u > t).length;
  report.custom.state = br.state;
}
