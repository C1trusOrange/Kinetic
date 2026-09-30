// Verifier 2: FFA tie -> who wins?
const frames = n => new Promise(res => { let c = 0; const f = () => (++c >= n ? res() : requestAnimationFrame(f)); requestAnimationFrame(f); });
export function drive() {}
export async function setup(game, report) {
  const out = (window.__V2__ = { done: false, rows: [], errors: [] });
  try {
    await frames(10);
    // A: 0-0 with 2 bots, time limit
    await game.startMatch({ mapId: 'sandbox', mode: 'ffa', botCount: 2, difficulty: 'easy', scoreLimit: 0, timeLimit: 0.03 });
    game.bots.update = () => {};
    for (let i = 0; i < 400 && !game.match.over; i++) await frames(1);
    await frames(1);
    const m = game.match;
    out.rows.push({ case: '0-0 2 bots, time limit', over: m.over, reason: m.reason, winner: m.winner && m.winner.name, playerWon: m.playerWon, hudTitle: game.hud.e.atitle.textContent, hudSub: game.hud.e.asub.textContent, entities: game.entities.map(e => e.name + ':' + e.kills + '/' + e.deaths) });
    // B: real tie 5-3 vs bot 5-3, bot listed after player
    await game.startMatch({ mapId: 'sandbox', mode: 'ffa', botCount: 1, difficulty: 'easy', scoreLimit: 0, timeLimit: 0.03 });
    game.bots.update = () => {};
    const p = game.player, b = game.bots.list[0];
    p.kills = 5; p.deaths = 3; b.kills = 5; b.deaths = 3;
    for (let i = 0; i < 400 && !game.match.over; i++) await frames(1);
    const m2 = game.match;
    out.rows.push({ case: '5/3 vs 5/3 tie', winner: m2.winner && m2.winner.name, playerWon: m2.playerWon, hudTitle: game.hud.e.atitle.textContent, order: m2.results.map(r => r.name) });
    // C: same tie but bot first in the entity list
    await game.startMatch({ mapId: 'sandbox', mode: 'ffa', botCount: 1, difficulty: 'easy', scoreLimit: 0, timeLimit: 0.03 });
    game.bots.update = () => {};
    const p3 = game.player, b3 = game.bots.list[0];
    p3.kills = 5; p3.deaths = 3; b3.kills = 5; b3.deaths = 3;
    game.entities.reverse();
    for (let i = 0; i < 400 && !game.match.over; i++) await frames(1);
    out.rows.push({ case: 'tie, entity order reversed', winner: game.match.winner && game.match.winner.name, playerWon: game.match.playerWon });
  } catch (e) { out.errors.push(String(e && e.stack || e)); }
  out.done = true;
}
