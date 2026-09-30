// verify-perf-1: quality switching: renderer.info.memory + programs + frame stalls per switch.
const G = window.__GAME__;
const r = G.renderer;
const R = window.__VP1__ = { rows: [], frames: [] };
const origUpdate = G.update.bind(G), origRender = G.render.bind(G);
let curRen = 0, curUpd = 0;
G.update = function (dt) { const t = performance.now(); origUpdate(dt); curUpd = performance.now() - t; };
G.render = function () { const t = performance.now(); origRender(); curRen = performance.now() - t; };
let last = performance.now(), lastProg = 0;
(function tick() {
  requestAnimationFrame(tick);
  const now = performance.now(); const dt = now - last; last = now;
  const p = r.info.programs.length;
  if (G.state === 'playing') R.frames.push({ gt: +G.time.toFixed(2), dt: +dt.toFixed(0), ren: +curRen.toFixed(0), np: p - lastProg });
  lastProg = p; curRen = 0; curUpd = 0;
})();
const seq = [[3, 'medium'], [6, 'high'], [9, 'medium'], [12, 'high'], [15, 'low'], [18, 'high'], [21, 'low']];
let idx = 0;
const snap = (label) => ({ label, gt: +G.time.toFixed(1), tex: r.info.memory.textures, geo: r.info.memory.geometries, progs: r.info.programs.length, composer: !!G.composer });
export function setup(game, report) { R.rows.push(snap('start')); }
export function drive(t, dt, game) {
  game.player.god = true;
  if (idx < seq.length && t >= seq[idx][0]) {
    const before = snap('before ' + seq[idx][1]);
    const t0 = performance.now();
    game.settings.set('quality', seq[idx][1]);
    const sync = performance.now() - t0;
    const after = snap('set ' + seq[idx][1]);
    after.syncMs = +sync.toFixed(0);
    R.rows.push(before, after);
    idx++;
  }
}
export function finish(game, report) {
  R.rows.push(snap('end'));
  report.custom = { rows: R.rows, stalls: R.frames.filter(f => f.dt > 200 && f.gt > 0.5).slice(0, 30) };
}
