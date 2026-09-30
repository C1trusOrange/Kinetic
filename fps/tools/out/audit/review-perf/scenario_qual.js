const G = window.__GAME__;
const S = { frames: [], marks: [] };
let last = performance.now(), cu = 0, cr = 0, lastProg = 0;
export function setup(game, report) {
  const ou = game.update.bind(game), orr = game.render.bind(game);
  game.update = function (dt) { const t = performance.now(); ou(dt); cu = performance.now() - t; };
  game.render = function () { const t = performance.now(); orr(); cr = performance.now() - t; };
  (function tick() {
    requestAnimationFrame(tick);
    const now = performance.now(); const dt = now - last; last = now;
    const p = game.renderer.info.programs.length;
    S.frames.push({ gt: +game.time.toFixed(2), dt: +dt.toFixed(0), upd: +cu.toFixed(1), ren: +cr.toFixed(1), np: p - lastProg, progs: p });
    lastProg = p; cu = 0; cr = 0;
  })();
  report.custom = {};
}
const seq = ['medium', 'high', 'medium', 'high', 'medium', 'high', 'low', 'high'];
let qi = 0, nextAt = 3;
S.mem = [];
const snap = (label, game) => { const m = game.renderer.info.memory; S.mem.push({ label, tex: m.textures, geo: m.geometries, progs: game.renderer.info.programs.length, heap: performance.memory ? +(performance.memory.usedJSHeapSize / 1048576).toFixed(0) : null }); };
export function drive(t, dt, game) {
  game.player.god = true;
  if (qi === 0 && !S.mem.length) snap('start', game);
  if (t >= nextAt && qi < seq.length) {
    const q = seq[qi++];
    S.marks.push(['set ' + q, game.time, S.frames.length]);
    const t0 = performance.now(); game.settings.set('quality', q); (S.setMs = S.setMs || []).push(+(performance.now() - t0).toFixed(0));
    nextAt = t + 3;
    setTimeout(() => snap('after ' + q, game), 1800);
  }
}
export function finish(game, report) {
  const around = [];
  for (const m of S.marks) { const i = m[2]; around.push({ mark: m[0], frames: S.frames.slice(i - 1, i + 6) }); }
  report.custom = { marks: S.marks, setMs: S.setMs, mem: S.mem, around, finalProgs: game.renderer.info.programs.length };
}
