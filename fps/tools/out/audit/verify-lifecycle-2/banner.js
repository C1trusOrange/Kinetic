// Verifier 2: winning kill -> which announcement wins? Log every HUD.announce call + event order.
const frames = n => new Promise(res => { let c = 0; const f = () => (++c >= n ? res() : requestAnimationFrame(f)); requestAnimationFrame(f); });
export function drive() {}
export async function setup(game, report) {
  const out = (window.__V2__ = { done: false, rows: [], errors: [] });
  try {
    await frames(20);
    const hud = game.hud;
    const calls = [];
    const origAnn = hud.announce.bind(hud);
    hud.announce = (title, sub, kind, ms) => { calls.push({ title, sub, kind, ms, matchOver: game.match && game.match.over }); return origAnn(title, sub, kind, ms); };
    const order = [];
    game.events.on('death', () => order.push('death(late listener)'));
    game.events.on('match:end', () => order.push('match:end(late listener)'));
    const ann = () => ({ title: hud.e.atitle.textContent, sub: hud.e.asub.textContent, kind: hud.e.announce.dataset.kind });
    const runs = [
      { name: 'ffa: final kill = headshot', mode: 'ffa', headshot: true },
      { name: 'ffa: final kill = plain body, first blood used', mode: 'ffa', headshot: false },
      { name: 'tdm: final kill = headshot', mode: 'tdm', headshot: true },
    ];
    for (const r of runs) {
      await game.startMatch({ mapId: 'sandbox', mode: r.mode, botCount: 4, difficulty: 'easy', scoreLimit: 30, timeLimit: 0 });
      await frames(15);
      game.bots.update = () => {};
      const p = game.player;
      for (const e of game.entities) e.spawnProtectedUntil = 0;
      const enemies = game.bots.list.filter(b => b.team !== p.team);
      // use up FIRST BLOOD / multi window with an early kill, then wait ~5 s of sim so multi-kill window lapses
      game.combat.kill(enemies[0], { attacker: p, weapon: 'rifle', headshot: false });
      await frames(5);
      const t0 = game.time;
      for (let i = 0; i < 600 && game.time - t0 < 4.5; i++) await frames(1);
      game.match.scoreLimit = r.mode === 'tdm' ? (game.match.teamScores[1] || 0) + 1 : p.kills + 1;
      calls.length = 0; order.length = 0;
      game.combat.kill(enemies[1], { attacker: p, weapon: 'rifle', headshot: r.headshot });
      await frames(2);
      out.rows.push({ run: r.name, over: game.match.over, playerWon: game.match.playerWon, announceCalls: calls.slice(), eventOrder: order.slice(), shownNow: ann() });
      await frames(150);
      out.rows[out.rows.length - 1].shownAfter150f = ann();
    }
  } catch (e) { out.errors.push(String(e && e.stack || e)); }
  out.done = true;
}
