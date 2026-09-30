const frames = n => new Promise(res => { let c = 0; const f = () => (++c >= n ? res() : requestAnimationFrame(f)); requestAnimationFrame(f); });
export function drive() {}
export async function setup(game, report) {
  const out = (window.__V1__ = {});
  const ev = { expl: [], death: [] };
  game.events.on('explosion', e => ev.expl.push({ owner: e.owner ? e.owner.name : null, weapon: e.weapon }));
  game.events.on('death', e => ev.death.push({ v: e.victim.name, a: e.attacker ? e.attacker.name : null }));
  await frames(20);
  const p = game.player; const b = game.bots.list[0];
  p.spawnProtectedUntil = 0; b.spawnProtectedUntil = 0;
  const pos = p.position.clone(); pos.x += 3; b.teleportTo(pos, 0); b.health = 30;
  const o = b.position.clone(); o.y += 0.6;
  game.projectiles.spawnGrenade({ owner: p, origin: o, velocity: new (p.position.constructor)(0,0,0), fuse: 0.3 });
  await frames(40);
  out.ev = ev; out.playerKills = p.kills; out.botAlive = b.alive; out.botKills = b.kills; out.botDeaths = b.deaths;
}
