// Odd-but-plausible call sequences: double restarts, quit twice, end twice, pause in menu, start during start, etc.
const frames = n => new Promise(res => { let c = 0; const f = () => (++c >= n ? res() : requestAnimationFrame(f)); requestAnimationFrame(f); });
async function until(cond, max = 600) { for (let i = 0; i < max; i++) { if (cond()) return true; await frames(1); } return false; }
export function drive() {}

export async function setup(game, report) {
  const out = (window.__LC__ = { done: false, rows: [], errors: [] });
  const R = (label, extra = {}) => out.rows.push({
    label, state: game.state, screen: game.menu.screen, match: !!game.match, over: game.match && game.match.over,
    entities: game.entities.length, bots: game.bots.list.length, playerAlive: game.player.alive, timeScale: game.timeScale,
    inputEnabled: game.input.enabled, capture: game.input.capture, hud: game.hud.visible, loadingOverlay: game.menu._ldVisible,
    starting: !!game._starting, ...extra,
  });
  try {
    await frames(40);
    game.bots.update = game.bots.update; // keep bots active here
    R('start');

    // 1) two restarts back to back (second must be ignored)
    game.restartMatch(); game.restartMatch();
    await until(() => game.state === 'playing');
    await frames(10);
    R('double restart');

    // 2) startMatch during startMatch with a different map (must be ignored, not corrupt)
    const p1 = game.startMatch({ mapId: 'foundry', mode: 'tdm', botCount: 4, scoreLimit: 0, timeLimit: 0 });
    const p2 = game.startMatch({ mapId: 'ruins', mode: 'ffa', botCount: 9, scoreLimit: 0, timeLimit: 0 });
    await Promise.all([p1, p2]);
    await frames(10);
    R('start during start', { map: game.world.mapId, botCount: game.match && game.match.botCount, mode: game.match && game.match.mode });

    // 3) quit twice, pause/resume/restart in menu
    game.quitToMenu(); game.quitToMenu();
    await frames(10);
    R('quit twice');
    game.pause(); game.resume();
    await frames(5);
    R('pause+resume in menu (no-ops)');
    game.endMatch('score');
    await frames(5);
    R('endMatch in menu (no match)');

    // 4) end twice, then quit during the slow-mo outro
    await game.startMatch({ mapId: 'sandbox', mode: 'ffa', botCount: 3, scoreLimit: 0, timeLimit: 0 });
    await frames(10);
    game.endMatch('score'); game.endMatch('time');
    await frames(20);
    R('end twice (during outro)', { reason: game.match && game.match.reason });
    game.quitToMenu();
    await frames(200);
    R('quit during outro');

    // 5) die then restart immediately, die then quit
    await game.startMatch({ mapId: 'sandbox', mode: 'ffa', botCount: 3, scoreLimit: 0, timeLimit: 0 });
    await frames(30);
    game.player.spawnProtectedUntil = 0;
    game.combat.kill(game.player, { attacker: game.bots.list[0], weapon: 'rifle' });
    await frames(5);
    game.restartMatch();
    await until(() => game.state === 'playing');
    await frames(10);
    R('die then restart', { playerHealth: game.player.health });
    game.combat.kill(game.player, { attacker: null, weapon: 'fall' });
    await frames(5);
    game.pause();
    await frames(5);
    R('paused while dead');
    game.resume();
    await until(() => game.player.alive, 600);
    R('respawned after pause/resume while dead');

    // 6) endMatch while dead, then play again
    game.combat.kill(game.player, { attacker: game.bots.list[0], weapon: 'rifle' });
    game.endMatch('time');
    await until(() => game.menu.screen === 'end', 400);
    R('end while dead -> end screen', { endTitle: game.menu.r.endtitle.textContent });
    game.restartMatch();
    await until(() => game.state === 'playing');
    await frames(10);
    R('play again after end while dead');

    // 7) invalid config values
    await game.startMatch({ mapId: 'nope', mode: 'xyz', botCount: 99, scoreLimit: -5, timeLimit: -1, difficulty: 'godlike' });
    await frames(20);
    R('invalid cfg', { map: game.world.mapId, botCount: game.match.botCount, mode: game.match.mode, diff: game.match.difficulty, scoreLimit: game.match.scoreLimit, timeLeft: game.match.timeLeft, botDiffs: [...new Set(game.bots.list.map(b => b.difficulty))].join() });
    await game.startMatch({ mapId: 'sandbox', mode: 'ffa', botCount: 2.6, scoreLimit: 0, timeLimit: 0 });
    R('fractional bots', { botCount: game.match.botCount, bots: game.bots.list.length });
  } catch (e) { out.errors.push(String(e && e.stack || e)); }
  out.done = true;
}
