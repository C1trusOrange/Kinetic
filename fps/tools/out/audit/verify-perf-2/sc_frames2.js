// frames scenario with names of programs compiled in each playing frame
const G = window.__GAME__;
const F = [];
const origUpdate = G.update.bind(G), origRender = G.render.bind(G);
let curU = 0, curR = 0, lastNow = performance.now(), lastProg = 0, n = 0;
G.update = function (dt) { const t = performance.now(); origUpdate(dt); curU = performance.now() - t; };
G.render = function () { const t = performance.now(); origRender(); curR = performance.now() - t; };
function tick() {
  requestAnimationFrame(tick);
  const now = performance.now(); const dt = now - lastNow; lastNow = now;
  const ps = G.renderer.info.programs; const progs = ps.length;
  const f = { f: n++, dt: +dt.toFixed(0), u: +curU.toFixed(0), r: +curR.toFixed(0), st: G.state, np: progs - lastProg, gt: +G.time.toFixed(2) };
  if (progs - lastProg > 0 && G.state === 'playing') f.names = ps.slice(lastProg, progs).map(p => (p.name || '?') + (String(p.cacheKey).includes('srgb-linear') ? '/rt' : '/scr') + ':' + String(p.cacheKey).slice(0, 60));
  F.push(f); lastProg = progs; curU = 0; curR = 0;
}
requestAnimationFrame(tick);
export function drive(t, dt, game, report) { game.autotest._drive(t, dt); }
export function finish(game, report) {
  report.custom = { warm: window.__WARM__, total: game.renderer.info.programs.length,
    playingNewProg: F.filter(x => x.st === 'playing' && x.np > 0), first: F.filter(x => x.st === 'playing').slice(0, 3), bigPlaying: F.filter(x => x.st === 'playing' && x.dt > 120).map(x => [x.gt, x.dt, x.u, x.r, x.np]) };
}
