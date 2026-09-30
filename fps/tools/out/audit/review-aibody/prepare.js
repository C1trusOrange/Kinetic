const g = window.__GAME__;
const out = {};
for (const id of ['foundry', 'ruins', 'skyline', 'sandbox']) {
  await g.startMatch({ mapId: id, mode: 'ffa', botCount: 2, difficulty: 'normal', scoreLimit: 0, timeLimit: 0 });
  const t0 = performance.now();
  await g.bots.prepare(g.world);
  const t1 = performance.now();
  out[id] = { ms: +(t1 - t0).toFixed(0), cover: g.bots.spots.cover.length, snipe: g.bots.spots.snipe.length, nodes: g.world.nav.nodes.length,
    snipeSample: g.bots.spots.snipe.slice(0, 3).map(s => s.pos.toArray().map(v => +v.toFixed(1))),
    snipeY: [Math.min(...g.bots.spots.snipe.map(s => s.pos.y)), Math.max(...g.bots.spots.snipe.map(s => s.pos.y))].map(v => +v.toFixed(1)),
    snipeSpread: (() => { const s = g.bots.spots.snipe; let mx = 0; for (const a of s) for (const b of s) mx = Math.max(mx, a.pos.distanceTo(b.pos)); return +mx.toFixed(1); })() };
}
return out;
