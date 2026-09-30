// Match rules: score limit / time limit end conditions in FFA + TDM, 0 bots and 15 bots; end screen; play again.
const frames = n => new Promise(res => { let c = 0; const f = () => (++c >= n ? res() : requestAnimationFrame(f)); requestAnimationFrame(f); });
async function until(cond, max = 600) { for (let i = 0; i < max; i++) { if (cond()) return true; await frames(1); } return false; }
export function drive() {}

export async function setup(game, report) {
  const out = (window.__LC__ = { done: false, rows: [], errors: [] });
  const R = (label, extra = {}) => {
    const m = game.match;
    out.rows.push({
      label, state: game.state, screen: game.menu.screen, over: m && m.over, reason: m && m.reason, mode: m && m.mode,
      winner: m && m.winner && m.winner.name, winnerTeam: m && m.winnerTeam, playerWon: m && m.playerWon,
      teamScores: m && JSON.stringify(m.teamScores), results: m && m.results && m.results.length, timeLeft: m && m.timeLeft,
      hudTitle: game.hud.e.atitle.textContent, timeScale: game.timeScale, inputEnabled: game.input.enabled, ...extra,
    });
  };
  try {
    await frames(30);
    const cfgs = [
      { name: 'ffa score 3, 3 bots', mode: 'ffa', botCount: 3, scoreLimit: 3, timeLimit: 0 },
      { name: 'tdm score 2, 4 bots', mode: 'tdm', botCount: 4, scoreLimit: 2, timeLimit: 0 },
      { name: 'ffa time 3s, 2 bots', mode: 'ffa', botCount: 2, scoreLimit: 0, timeLimit: 0.05 },
      { name: 'tdm time 3s, 0 bots', mode: 'tdm', botCount: 0, scoreLimit: 0, timeLimit: 0.05 },
      { name: 'ffa time 3s, 0 bots', mode: 'ffa', botCount: 0, scoreLimit: 0, timeLimit: 0.05 },
      { name: 'tdm time 3s, 15 bots', mode: 'tdm', botCount: 15, scoreLimit: 0, timeLimit: 0.05 },
    ];
    for (const c of cfgs) {
      await game.startMatch({ mapId: 'sandbox', difficulty: 'easy', ...c });
      await frames(15);
      game.bots.update = () => {};
      const p = game.player;
      p.spawnProtectedUntil = 0;
      for (const b of game.bots.list) b.spawnProtectedUntil = 0;
      if (c.scoreLimit) {
        // player kills enemies until the limit
        let guard = 0;
        while (game.state === 'playing' && guard++ < 10) {
          const en = game.bots.list.find(b => b.alive && b.team !== p.team);
          if (!en) break;
          game.combat.kill(en, { attacker: p, weapon: 'rifle' });
          await frames(2);
        }
      }
      const ended = await until(() => game.state === 'ended', 600);
      R(c.name + ' -> ended=' + ended);
      const shown = await until(() => game.menu.screen === 'end', 400);
      R(c.name + ' -> endscreen=' + shown, { endTitle: game.menu.r.endtitle.textContent, endSub: game.menu.r.endsub.textContent });
      // play again from the end screen
      game.restartMatch();
      while (game.state === 'loading') await frames(2);
      await frames(5);
      R(c.name + ' -> after play again');
    }
  } catch (e) { out.errors.push(String(e && e.stack || e)); }
  out.done = true;
}
