const frames = n => new Promise(res => { let c = 0; const f = () => (++c >= n ? res() : requestAnimationFrame(f)); requestAnimationFrame(f); });
let driveBefore = 0, driveAfter = 0, setupDone = false, finishSeen = null;
export function drive(t, dt, game, report) { if (setupDone) driveAfter++; else driveBefore++; if (report.done && !finishSeen) finishSeen = { t, setupDone, started: report.started }; }
export async function setup(game, report) {
  const out = (window.__V1__ = { done: false, rows: [], errors: [] });
  try {
    await frames(30);
    game.bots.update = () => {};
    const p = game.player, b = game.bots.list[0];
    // --- finding 6: tie at time limit
    game.endMatch('time');
    out.tie = { winner: game.match.winner && game.match.winner.name, playerWon: game.match.playerWon, kills: game.entities.map(e => e.name + ':' + e.kills + '/' + e.deaths) };
    game.menu.showEnd(game.match);
    out.endTitle = game.menu.r.endtitle.textContent + ' | ' + game.menu.r.endsub.textContent;
    // --- finding 5: final kill as headshot
    game.restartMatch = game.restartMatch;
    await game.startMatch({ ...game.lastMatchConfig, scoreLimit: 1 });
    await frames(30);
    game.bots.update = () => {};
    for (const e of game.entities) e.spawnProtectedUntil = 0;
    const bot = game.bots.list[0];
    game.combat.applyDamage(bot, { amount: 1000, attacker: game.player, weapon: 'rifle', headshot: true, point: bot.position.clone(), direction: bot.position.clone().set(0,0,-1) });
    out.afterKill = { state: game.state, over: game.match.over, reason: game.match.reason, playerWon: game.match.playerWon };
    await frames(20);
    out.hudTitle = game.hud.e.atitle.textContent + ' | ' + game.hud.e.asub.textContent;
    await frames(200);
    out.setupFinishedAt = 'setup end';
  } catch (e) { out.errors.push(String(e && e.stack || e)); }
  setupDone = true;
  out.driveBefore = driveBefore; out.finishSeen = finishSeen;
  out.done = true;
}
