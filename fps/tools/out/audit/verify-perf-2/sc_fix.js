// Records per-frame dt / update / render / new programs, classifies programs by output colour space.
const G = window.__GAME__;
const F = [];
const P = window.__V2__ = { F };
const origUpdate = G.update.bind(G), origRender = G.render.bind(G);
let curU = 0, curR = 0, lastNow = performance.now(), lastProg = 0, n = 0;
G.update = function (dt) { const t = performance.now(); origUpdate(dt); curU = performance.now() - t; };
G.render = function () { const t = performance.now(); origRender(); curR = performance.now() - t; };
function tick() {
  requestAnimationFrame(tick);
  const now = performance.now(); const dt = now - lastNow; lastNow = now;
  const progs = G.renderer.info.programs.length;
  F.push({ f: n++, dt: +dt.toFixed(0), u: +curU.toFixed(0), r: +curR.toFixed(0), st: G.state, np: progs - lastProg, progs, gt: +G.time.toFixed(2) });
  lastProg = progs; curU = 0; curR = 0;
}
requestAnimationFrame(tick);
// FIX-VARIANT (scratch only, monkeypatch)
const mode = new URLSearchParams(location.search).get("fix") || "rt";
window.__V2__.warmMs = 0;
if (mode !== "none") {
  G.projectiles._warm = function () { this._warmed = true; };
  G.weapons._compileViewmodels = function () { this._compiled = true; };
  const orig = G.weapons.onMatchStart.bind(G.weapons);
  G.weapons.onMatchStart = function () {
    orig();
    const t = performance.now();
    const r = G.renderer;
    r.setRenderTarget(mode === "rt" && G.composer ? G.composer.renderTarget1 : null);
    r.compile(G.scene, G.camera);
    r.compile(G.viewScene, G.viewCamera);
    r.setRenderTarget(null);
    window.__V2__.warmMs = performance.now() - t;
    window.__V2__.warmProgs = r.info.programs.length;
  };
}
export function drive(t, dt, game, report) { game.autotest._drive(t, dt); }
export function finish(game, report) {
  const r = game.renderer;
  const users = new Map();
  const mark = (scene) => scene.traverse(o => {
    const mats = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
    for (const m of mats) { const p = r.properties.get(m); if (p && p.currentProgram) users.set(p.currentProgram.id, (users.get(p.currentProgram.id) || 0) + 1); }
  });
  mark(game.scene); mark(game.viewScene);
  let dead = 0, scr = 0, rt = 0, scrLive = 0, scrDead = 0;
  for (const p of r.info.programs) {
    const key = String(p.cacheKey);
    const isRT = key.includes('srgb-linear');
    const isLive = users.has(p.id);
    if (!isLive) dead++;
    if (isRT) rt++; else { scr++; if (isLive) scrLive++; else scrDead++; }
  }
  const big = F.filter(x => x.dt > 120).slice(0, 25);
  report.custom = { warmMs: window.__V2__.warmMs, warmProgs: window.__V2__.warmProgs, total: r.info.programs.length, dead, scr, rt, scrLive, scrDead, quality: game.quality, big, first: F.filter(x => x.st === 'playing').slice(0, 3), newProgFramesPlaying: F.filter(x => x.st === 'playing' && x.np > 0).map(x => [x.gt, x.np, x.dt]) };
}
