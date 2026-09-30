// verify-perf-1: bot path request cost distribution (per request, wall ms) + correlation with frame update time.
const G = window.__GAME__;
const R = window.__VP1__ = { reqs: [], frames: [] };
const bm = G.bots;
const origReport = bm.reportPathTime.bind(bm);
bm.reportPathTime = function (ms) { R.reqs.push({ gt: G.time, ms }); return origReport(ms); };
const origUpdate = G.update.bind(G);
G.update = function (dt) {
  const t = performance.now();
  const n0 = R.reqs.length;
  origUpdate(dt);
  const upd = performance.now() - t;
  if (G.state === 'playing') R.frames.push({ upd, req: R.reqs.length - n0, reqMs: R.reqs.slice(n0).reduce((a, r) => a + r.ms, 0) });
};
const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s.length ? +s[Math.min(s.length - 1, Math.floor(s.length * p))].toFixed(2) : 0; };
export function drive(t, dt, game) { game.player.god = true; }
export function finish(game, report) {
  const ms = R.reqs.map(r => r.ms);
  const T = (game.time || 1);
  const frames = R.frames.slice(5);
  const withReq = frames.filter(f => f.req > 0), noReq = frames.filter(f => f.req === 0);
  report.custom = {
    map: game.world.mapId, bots: game.bots.list.length, simSeconds: +T.toFixed(1),
    requests: ms.length, reqPerSec: +(ms.length / T).toFixed(1),
    p50: pct(ms, 0.5), p90: pct(ms, 0.9), p99: pct(ms, 0.99), max: +Math.max(0, ...ms).toFixed(2), total: +ms.reduce((a, b) => a + b, 0).toFixed(0),
    over8: ms.filter(x => x > 8).length, over16: ms.filter(x => x > 16).length,
    frameUpdWithReqMedian: pct(withReq.map(f => f.upd), 0.5), frameUpdNoReqMedian: pct(noReq.map(f => f.upd), 0.5),
    frameUpdP99: pct(frames.map(f => f.upd), 0.99), frameUpdMax: +Math.max(0, ...frames.map(f => f.upd)).toFixed(1),
    framesWithReq: withReq.length, frames: frames.length,
    pathStats: game.bots.pathStats,
    worst: R.reqs.slice().sort((a, b) => b.ms - a.ms).slice(0, 5).map(r => ({ gt: +r.gt.toFixed(1), ms: +r.ms.toFixed(1) })),
  };
}
