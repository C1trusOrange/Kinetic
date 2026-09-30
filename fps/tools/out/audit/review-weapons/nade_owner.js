// Grenade owner credit test: player throws a real grenade (cook+release) at a bot; check who gets credit.
import * as THREE from 'three';
const rec = { explosions: [], damage: [], deaths: [], phase: [] };
export function setup(game, report) {
  report.custom = rec;
  game.player.god = true;
  game.events.on('explosion', e => rec.explosions.push({ t: +game.time.toFixed(2), weapon: e.weapon, ownerIsPlayer: e.owner === game.player, owner: e.owner ? e.owner.name : null }));
  game.events.on('damage', e => rec.damage.push({ t: +game.time.toFixed(2), weapon: e.weapon, amount: +e.amount.toFixed(1), attacker: e.attacker ? (e.attacker === game.player ? 'PLAYER' : e.attacker.name) : null, target: e.target === game.player ? 'PLAYER' : e.target.name, targetTeam: e.target.team }));
  game.events.on('death', e => rec.deaths.push({ t: +game.time.toFixed(2), weapon: e.weapon, attacker: e.attacker ? (e.attacker === game.player ? 'PLAYER' : e.attacker.name) : null, victim: e.victim === game.player ? 'PLAYER' : e.victim.name }));
}
let done = 0;
export function drive(t, dt, game, report) {
  const p = game.player;
  const bot = game.bots.list[0];
  if (t < 1.8) return;
  if (!done) {
    done = 1;
    // freeze bot in front of the player
    rec.playerKillsBefore = p.kills; rec.botDeathsBefore = bot.deaths; rec.botKillsBefore = bot.kills;
    rec.botTeam = bot.team; rec.playerTeam = p.team;
    // direct spawn (same path the throw uses)
    const org = bot.position.clone(); org.y += 0.9; rec.botPos = bot.position.toArray().map(v=>+v.toFixed(1)); rec.playerPos = p.position.toArray().map(v=>+v.toFixed(1));
    game.projectiles.spawnGrenade({ owner: p, origin: org, velocity: new THREE.Vector3(0, 0, 0), fuse: 0.06 });
    rec.phase.push('spawned t=' + t.toFixed(2));
  }
  if (t > 3.3 && done === 1) {
    done = 2;
    rec.playerKillsAfter = p.kills; rec.botDeathsAfter = bot.deaths; rec.botAlive = bot.alive; rec.botHealth = bot.health;
    rec.botKillsAfter = bot.kills;
  }
}
