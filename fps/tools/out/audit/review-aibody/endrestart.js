const g = window.__GAME__;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const out = [];
for (let round = 0; round < 3; round++) {
  await g.startMatch({ mapId: round === 1 ? 'sandbox' : 'foundry', mode: round === 2 ? 'tdm' : 'ffa', botCount: 6, difficulty: 'insane', scoreLimit: 2, timeLimit: 0 });
  const t0 = performance.now();
  while (g.state === 'playing' && performance.now() - t0 < 90000) await sleep(200);
  const st1 = g.state;
  await sleep(4500);
  out.push({ round, stateAfterEnd: st1, later: g.state, over: g.match && g.match.over, reason: g.match && g.match.reason, winner: g.match && (g.match.winner ? g.match.winner.name : g.match.winnerTeam),
    bots: g.bots.list.length, alive: g.bots.list.filter(b => b.alive).length, models: g.scene.children.filter(c => c.name === 'BotModel').length,
    scores: g.getScoreboard().slice(0, 3).map(r => r.name + ':' + r.kills) });
}
return out;
