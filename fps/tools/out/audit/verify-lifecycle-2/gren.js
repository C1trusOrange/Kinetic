// Verifier 2: grenade owner is null at explode() time. Independent repro + comparison with an explicit-owner explode.
const frames = n => new Promise(res => { let c = 0; const f = () => (++c >= n ? res() : requestAnimationFrame(f)); requestAnimationFrame(f); });
export function drive() {}
export async function setup(game, report) {
  const out = (window.__V2__ = { done: false, rows: [], errors: [] });
  try {
    await frames(20);
    game.bots.update = () => {};
    const p = game.player;
    const bots = game.bots.list;
    const V = p.position.constructor;
    const log = { explosion: [], damage: [], death: [] };
    game.events.on('explosion', e => log.explosion.push({ owner: e.owner ? e.owner.name : null }));
    game.events.on('damage', e => log.damage.push({ t: e.target.name, a: e.attacker ? e.attacker.name : null, amt: Math.round(e.amount) }));
    game.events.on('death', e => log.death.push({ v: e.victim.name, a: e.attacker ? e.attacker.name : null, w: e.weapon }));
    const reset = () => { log.explosion.length = log.damage.length = log.death.length = 0; };
    for (const e of game.entities) { e.spawnProtectedUntil = 0; }

    // A: real thrown grenade (owner: player) next to a bot, 3 m from the player
    const b0 = bots[0];
    const pos = p.position.clone(); pos.x += 3;
    b0.teleportTo(pos, 0); b0.health = 40; b0.armor = 0;
    reset();
    const kills0 = p.kills, bk0 = b0.kills, bd0 = b0.deaths, pk0 = p.deaths;
    const o = b0.position.clone(); o.y += 0.6;
    game.projectiles.spawnGrenade({ owner: p, origin: o, velocity: new V(0, 0, 0), fuse: 0.2 });
    await frames(40);
    out.rows.push({ case: 'A thrown (owner=player) via Projectiles.update', log: JSON.parse(JSON.stringify(log)), playerKills: [kills0, p.kills], botDeaths: [bd0, b0.deaths], botKills: [bk0, b0.kills] });

    // B: same but explode() called directly with owner (what the fix would produce)
    p.health = 100; p.armor = 0; p.alive = true;
    b0.spawnProtectedUntil = 0;
    b0.teleportTo(p.position.clone().add(new V(3, 0, 0)), 0); b0.health = 40; b0.alive = true; b0.armor = 0;
    reset();
    const kills1 = p.kills;
    game.projectiles.explode(b0.position.clone().add(new V(0, 0.6, 0)), { owner: p, weapon: 'grenade' });
    await frames(3);
    out.rows.push({ case: 'B explode() with explicit owner', log: JSON.parse(JSON.stringify(log)), playerKills: [kills1, p.kills] });

    // C: self grenade at feet via update (owner player) vs explicit
    for (const mode of ['update', 'explicit']) {
      p.health = 100; p.armor = 0; p.alive = true; p.spawnProtectedUntil = 0;
      reset();
      const o3 = p.position.clone(); o3.y += 0.3;
      if (mode === 'update') {
        game.projectiles.spawnGrenade({ owner: p, origin: o3, velocity: new V(0, 0, 0), fuse: 0.1 });
        await frames(30);
      } else {
        game.projectiles.explode(o3, { owner: p, weapon: 'grenade' });
        await frames(3);
      }
      out.rows.push({ case: 'C self at feet, ' + mode, dmgToPlayer: log.damage.filter(d => d.t === p.name), playerHealth: p.health });
    }

    // D: TDM friendly fire
    game.bots.update = () => {};
    await game.startMatch({ mapId: 'sandbox', mode: 'tdm', botCount: 6, difficulty: 'easy', scoreLimit: 0, timeLimit: 0 });
    await frames(20);
    game.bots.update = () => {};
    const p2 = game.player;
    for (const e of game.entities) e.spawnProtectedUntil = 0;
    const mate = game.bots.list.find(b => b.team === p2.team);
    out.rows.push({ case: 'D setup', playerTeam: p2.team, mateTeam: mate && mate.team });
    if (mate) {
      mate.teleportTo(p2.position.clone().add(new V(-2.5, 0, 1)), 0); mate.health = 100; mate.armor = 0;
      reset();
      const o4 = mate.position.clone(); o4.y += 0.6;
      game.projectiles.spawnGrenade({ owner: p2, origin: o4, velocity: new V(0, 0, 0), fuse: 0.2 });
      await frames(40);
      out.rows.push({ case: 'D TDM grenade owned by player at teammate (via update)', mateHealth: mate.health, mateAlive: mate.alive, log: JSON.parse(JSON.stringify(log)) });
      // explicit owner: friendly-fire filter?
      mate.spawnProtectedUntil = 0; mate.alive = true; mate.health = 100;
      reset();
      game.projectiles.explode(mate.position.clone().add(new V(0, 0.6, 0)), { owner: p2, weapon: 'grenade' });
      await frames(3);
      out.rows.push({ case: 'D2 TDM explode() with explicit owner at teammate', mateHealth: mate.health, log: JSON.parse(JSON.stringify(log)) });
    }
  } catch (e) { out.errors.push(String(e && e.stack || e)); }
  out.done = true;
}
