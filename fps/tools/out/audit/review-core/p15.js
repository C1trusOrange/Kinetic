const out = {};
await sleep(600);
const pl = game.player;
const bots = game.bots.list;
const [A, B] = bots;
game.player.god = true;
// --- stale lastAttacker credit via self damage refresh
B.spawnProtectedUntil = 0; B.health = 100; B.armor = 0;
game.combat.applyDamage(B, { amount: 10, attacker: A, weapon: 'rifle', point: B.position.clone(), direction: new THREE.Vector3(0, 0, -1) });
out.afterHit = { lastAttacker: B.lastAttacker && B.lastAttacker.name, lastDamageTime: +B.lastDamageTime.toFixed(2), time: +game.time.toFixed(2) };
game.time += 20;                  // 20 s later
B.spawnProtectedUntil = 0;
game.combat.applyDamage(B, { amount: 1, attacker: B, weapon: 'rocket' });   // self damage (rocket jump)
const aKills0 = A.kills, aStreak0 = A.streak;
B.position.y = (game.world.killY ?? -50) - 5;      // fell into the void
game._updateMatch(0.016);
out.staleCredit = { aKillsDelta: A.kills - aKills0, bAlive: B.alive, bDeaths: B.deaths };
// --- suicide penalty
B.kills = 3; 
game.combat.kill(pl, { attacker: pl, weapon: 'rocket' });   // ok: player suicides
out.playerSuicide = { plKills: pl.kills, plDeaths: pl.deaths, respawnIn: +(pl.respawnAt - game.time).toFixed(2) };
game.time += 3.01;
game._updateMatch(0.016);
out.playerRespawned = { alive: pl.alive, protectedFor: +(pl.spawnProtectedUntil - game.time).toFixed(2) };
return out;
