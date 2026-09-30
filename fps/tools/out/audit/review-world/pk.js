const S = { step: 0, t0: 0, log: [], events: 0, done: false };
function log(o) { S.log.push(o); }
export function setup(game, report) {
  game.player.god = true;
  report.custom = { log: S.log };
  game.events.on('pickup', e => { S.events++; S.lastEv = { ent: e.entity.isPlayer ? 'player' : 'bot', type: e.pickup.type, w: e.pickup.weapon }; });
}
function place(game, p) { game.player.position.set(p.position.x, p.position.y, p.position.z); game.player.velocity.set(0, 0, 0); }
export function drive(t, dt, game, report) {
  if (S.done) return;
  const w = game.world, pk = w.pickups, pl = game.player;
  const byType = (ty, wp) => pk.list.find(p => p.type === ty && (!wp || p.weapon === wp));
  const now = game.time;
  switch (S.step) {
    case 0: { // health, full hp -> not consumed
      const h = byType('health');
      pl.health = 100; place(game, h); S.t0 = now; S.step = 1; S.ev0 = S.events; break; }
    case 1: {
      if (now - S.t0 < 0.5) break;
      const h = byType('health');
      log({ test: 'health full hp not consumed', available: h.available, events: S.events - S.ev0 });
      pl.health = 40; S.step = 2; S.t0 = now; S.ev0 = S.events; break; }
    case 2: {
      if (now - S.t0 < 0.3) break;
      const h = byType('health');
      log({ test: 'health consumed', available: h.available, hp: pl.health, amount: h.amount, respawnIn: +(h.nextRespawn - S.t0).toFixed(2), events: S.events - S.ev0, last: S.lastEv });
      S.hp = h; S.step = 3; break; }
    case 3: { // world.reset makes it available
      w.reset();
      log({ test: 'after world.reset', available: S.hp.available, next: S.hp.nextRespawn });
      // armor
      const a = byType('armor'); pl.armor = 100; place(game, a); S.t0 = now; S.ev0 = S.events; S.step = 4; break; }
    case 4: {
      if (now - S.t0 < 0.4) break;
      const a = byType('armor');
      log({ test: 'armor full not consumed', available: a.available });
      pl.armor = 10; S.step = 5; S.t0 = now; break; }
    case 5: {
      if (now - S.t0 < 0.3) break;
      const a = byType('armor');
      log({ test: 'armor consumed', available: a.available, armor: pl.armor });
      w.reset();
      // weapon: rocket (not owned)
      const r = byType('weapon', 'rocket');
      place(game, r); S.t0 = now; S.step = 6; break; }
    case 6: {
      if (now - S.t0 < 0.3) break;
      const r = byType('weapon', 'rocket');
      log({ test: 'rocket pad (not owned)', available: r.available, current: game.weapons.currentId, owned: game.weapons.owned.slice() });
      w.reset();
      // owned with full reserve -> pad not consumed
      const inv = game.weapons.inv.rocket; inv.reserve = game.weapons.current ? 999 : 0;
      inv.reserve = 1e9;
      place(game, r); S.t0 = now; S.step = 7; break; }
    case 7: {
      if (now - S.t0 < 0.3) break;
      const r = byType('weapon', 'rocket');
      log({ test: 'rocket pad (owned, reserve huge)', available: r.available });
      // ammo pickup with pistol only full others full
      w.reset();
      S.step = 8; break; }
    case 8: {
      // kill player, stand on pickup: dead entity shouldn't collect
      const h = byType('health'); pl.health = 30;
      place(game, h);
      pl.alive = false;
      S.t0 = now; S.step = 9; break; }
    case 9: {
      if (now - S.t0 < 0.4) break;
      const h = byType('health');
      log({ test: 'dead player not collecting', available: h.available });
      pl.alive = true; S.done = true; report.custom.finished = true; break; }
    default: break;
  }
}
