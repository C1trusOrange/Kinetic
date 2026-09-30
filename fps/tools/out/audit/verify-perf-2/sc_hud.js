const G = window.__GAME__;
if (new URLSearchParams(location.search).get('hide') === '1') { const s = document.createElement('style'); s.textContent = '#ui{display:none !important}'; document.head.appendChild(s); }
const F = [];
const origUpdate = G.update.bind(G), origRender = G.render.bind(G);
let curU = 0, curR = 0, lastNow = performance.now(), n = 0, firstPlay = -1;
G.update = function (dt) { const t = performance.now(); origUpdate(dt); curU = performance.now() - t; };
G.render = function () { const t = performance.now(); origRender(); curR = performance.now() - t; };
function tick() {
  requestAnimationFrame(tick);
  const now = performance.now(); const dt = now - lastNow; lastNow = now;
  if (G.state === 'playing' && firstPlay < 0) firstPlay = n;
  F.push({ f: n++, dt: +dt.toFixed(0), js: +(curU + curR).toFixed(0), gt: +G.time.toFixed(2), st: G.state });
  curU = 0; curR = 0;
}
requestAnimationFrame(tick);
export function drive(t, dt, game, report) { game.autotest._drive(t, dt); }
export function finish(game, report) {
  const after = F.filter(x => x.f > firstPlay && x.gt < 3);
  const worstAfter = after.slice(1, 40);
  report.custom = { hide: new URLSearchParams(location.search).get('hide'), firstPlay, firstFrame: F[firstPlay], next8: F.slice(firstPlay + 1, firstPlay + 9), maxGapAfter: Math.max(...worstAfter.map(x => x.dt)), maxGapAfterJs: worstAfter.sort((a, b) => b.dt - a.dt)[0] };
}
