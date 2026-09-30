// verify-perf-1: HUD first-paint gap: ?hide=1 hides #ui before the match starts. Logs early frame intervals.
const G = window.__GAME__;
const Q = new URLSearchParams(location.search);
const hide = Q.get('hide') || '0';
if (hide === '1') { const st = document.createElement('style'); st.textContent = '#ui{display:none !important}'; document.head.appendChild(st); }
if (hide === '2') { const st = document.createElement('style'); st.textContent = '.k-hud{display:none !important}'; document.head.appendChild(st); }
const r = G.renderer;
const R = window.__VP1__ = { frames: [] };
const origUpdate = G.update.bind(G), origRender = G.render.bind(G);
let curUpd = 0, curRen = 0;
G.update = function (dt) { const t = performance.now(); origUpdate(dt); curUpd = performance.now() - t; };
G.render = function () { const t = performance.now(); origRender(); curRen = performance.now() - t; };
let last = performance.now(), n = 0, lastProg = 0;
(function tick() {
  requestAnimationFrame(tick);
  const now = performance.now(); const dt = now - last; last = now;
  const p = r.info.programs.length;
  if (G.state === 'playing') { n++; R.frames.push({ n, gt: +G.time.toFixed(2), dt: +dt.toFixed(0), upd: +curUpd.toFixed(0), ren: +curRen.toFixed(0), np: p - lastProg }); }
  lastProg = p; curUpd = 0; curRen = 0;
})();
export function drive(t, dt, game) { game.player.god = true; }
export function finish(game, report) {
  const fr = R.frames;
  report.custom = { hide, first8: fr.slice(0, 8), later: fr.slice(8).filter(f => f.dt > 250).slice(0, 8), hudDisplay: getComputedStyle(document.getElementById('ui') || document.body).display };
}
