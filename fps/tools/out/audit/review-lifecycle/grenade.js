// Repro: Projectiles.update releases the grenade (owner = null) BEFORE explode() reads g.owner.
const frames = n => new Promise(res => { let c = 0; const f = () => (++c >= n ? res() : requestAnimationFrame(f)); requestAnimationFrame(f); });

export function drive() {}

export async function setup(game, report) {
  const out = (window.__LC__ = { done: false, log: [] });
  const ev = { death: [], explosion: [], damage: [] };
  game.events.on('death', e => ev.death.push({ victim: e.victim.name, attacker: e.attacker ? e.attacker.name : null, weapon: e.weapon }));
  game.events.on('explosion', e => ev.explosion.push({ owner: e.owner ? e.owner.name : null, weapon: e.weapon }));
  game.events.on('damage', e => ev.damage.push({ target: e.target.name, attacker: e.attacker ? e.attacker.name : null, amount: Math.round(e.amount), weapon: e.weapon }));
  await frames(30);
  const p = game.player;
  const bots = game.bots.list;
  p.spawnProtectedUntil = 0;
  for (const b of bots) b.spawnProtectedUntil = 0;
  out.mode = game.match.mode;
  out.teams = { player: p.team, bots: bots.map(b => b.team) };

  // 1) player throws a grenade at a bot 3 m away
  const THREE_V = p.position.constructor;
  const target = bots[0];
  const pos = p.position.clone(); pos.x += 3; 
  target.teleportTo(pos, 0);
  target.health = 40;
  const origin = target.position.clone(); origin.y += 0.6;
  game.projectiles.spawnGrenade({ owner: p, origin, velocity: new THREE_V(0, 0, 0), fuse: 0.3 });
  await frames(60);
  out.playerGrenadeVsBot = JSON.parse(JSON.stringify(ev));
  out.botAlive = target.alive;
  out.playerKills = p.kills;
  out.targetDeaths = target.deaths; out.targetKills = target.kills; out.playerDeaths = p.deaths;
  out.log.push('done1');

  // 2) TDM friendly fire check: grenade owned by the player next to a teammate bot
  if (bots.length >= 2) {
    ev.death.length = ev.damage.length = ev.explosion.length = 0;
    const mate = bots.find(b => b.team === p.team && b !== target);
    if (mate) {
      mate.spawnProtectedUntil = 0; mate.health = 100;
      const pos2 = p.position.clone(); pos2.x -= 2.5; pos2.z += 1;
      mate.teleportTo(pos2, 0);
      const o2 = mate.position.clone(); o2.y += 0.6;
      game.projectiles.spawnGrenade({ owner: p, origin: o2, velocity: new THREE_V(0, 0, 0), fuse: 0.3 });
      await frames(40);
      out.friendlyFire = { mateTeam: mate.team, playerTeam: p.team, mateHealthAfter: mate.health, mateAlive: mate.alive, damage: ev.damage.slice(), deaths: ev.death.slice() };
    }
  }

  // 3) self-damage: grenade owned by player exploding at the player's feet
  ev.damage.length = ev.death.length = 0;
  p.health = 100; p.armor = 0; p.alive = true;
  const o3 = p.position.clone(); o3.y += 0.3;
  game.projectiles.spawnGrenade({ owner: p, origin: o3, velocity: new THREE_V(0, 0, 0), fuse: 0.2 });
  await frames(30);
  out.selfGrenade = { damage: ev.damage.filter(d => d.target === p.name), playerHealth: p.health };
  out.done = true;
}
