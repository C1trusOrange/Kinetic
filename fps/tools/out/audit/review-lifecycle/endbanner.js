// Match-ending kill: does the HUD VICTORY banner survive the kill announcement of the same death event?
const frames = n => new Promise(res => { let c = 0; const f = () => (++c >= n ? res() : requestAnimationFrame(f)); requestAnimationFrame(f); });
export function drive() {}

export async function setup(game, report) {
  const out = (window.__LC__ = { done: false, rows: [], errors: [] });
  const ann = () => ({ title: game.hud.e.atitle.textContent, sub: game.hud.e.asub.textContent, kind: game.hud.e.announce.dataset.kind });
  try {
    await frames(30);
    game.bots.update = () => {};
    // scenarios: [name, kill options, pre-kills]
    const runs = [
      { name: 'final kill = headshot', headshot: true, preKills: 0 },
      { name: 'final kill = body shot', headshot: false, preKills: 0 },
      { name: 'final kill = double kill (2nd within window)', headshot: false, preKills: 1 },
    ];
    for (const r of runs) {
      await game.startMatch({ mapId: 'sandbox', mode: 'ffa', botCount: 3, scoreLimit: r.preKills + 30, timeLimit: 0, difficulty: 'easy' });
      await frames(20);
      game.bots.update = () => {};
      const p = game.player;
      p.spawnProtectedUntil = 0;
      for (const b of game.bots.list) b.spawnProtectedUntil = 0;
      // pre-kills so that FIRST BLOOD is used up
      const pre = game.bots.list[0];
      game.combat.kill(pre, { attacker: p, weapon: 'rifle', headshot: false });
      await frames(3);
      // now make the next kill the winning one
      game.match.scoreLimit = p.kills + 1;
      const victim = game.bots.list[1];
      const before = ann();
      // a second kill inside the multi-kill window when requested
      if (r.preKills) { /* pre-kill above already counts as the first of the multi */ }
      else { await frames(120); }   // let the multi-kill window (~4s) lapse partially
      game.combat.kill(victim, { attacker: p, weapon: 'rifle', headshot: r.headshot });
      await frames(2);
      out.rows.push({ run: r.name, over: game.match.over, playerWon: game.match.playerWon, before, afterEnd: ann(), streak: game.hud._streak, multi: game.hud._multi });
      await frames(200);
    }
  } catch (e) { out.errors.push(String(e && e.stack || e)); }
  out.done = true;
}
