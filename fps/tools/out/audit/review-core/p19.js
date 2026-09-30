// long FFA/TDM bot match invariants: respawn always happens, scores consistent
const out = { violations: [], samples: 0, maxDead: 0, kills: 0, deaths: 0, suicides: 0, falls: 0 };
game.events.on('death', e => { out.deaths++; if (!e.attacker || e.attacker === e.victim) out.suicides++; if (e.weapon === 'fall') out.falls++; });
const tEnd = game.time + 75;
while (game.time < tEnd && !game.match.over) {
  await sleep(200);
  out.samples++;
  const dead = game.entities.filter(e => !e.alive);
  out.maxDead = Math.max(out.maxDead, dead.length);
  for (const e of dead) {
    if (e.respawnAt < 0) out.violations.push(`${e.name}: dead with respawnAt<0 at t=${game.time.toFixed(1)}`);
    else if (game.time > e.respawnAt + 0.3 && !game.match.over) out.violations.push(`${e.name}: overdue respawn ${(game.time - e.respawnAt).toFixed(2)}s at t=${game.time.toFixed(1)}`);
  }
  for (const e of game.entities) {
    if (e.alive && (e.health <= 0 || !Number.isFinite(e.health) || !Number.isFinite(e.position.x + e.position.y + e.position.z))) out.violations.push(`${e.name}: bad state hp=${e.health} pos=${e.position.toArray()}`);
    if (e.armor < 0 || e.armor > 100.001 || e.health > e.maxHealth + 1e-6) out.violations.push(`${e.name}: armor/health range ${e.armor} ${e.health}`);
    if (e.kills < 0) out.violations.push(`${e.name}: negative kills`);
  }
  if (out.violations.length > 12) break;
}
const m = game.match;
out.simSeconds = +(game.time - (tEnd - 75)).toFixed(1);
out.over = m.over; out.reason = m.reason; out.teamScores = m.teamScores;
out.sumKills = game.entities.reduce((a, e) => a + e.kills, 0);
out.sumDeaths = game.entities.reduce((a, e) => a + e.deaths, 0);
out.board = game.getScoreboard().slice(0, 4).map(r => `${r.name} ${r.kills}/${r.deaths}`);
out.timeLeft = m.timeLeft;
return out;
