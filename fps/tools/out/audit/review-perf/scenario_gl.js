// Generic GL call profiler: per-frame top functions for slow frames + first playing frame.
const G = window.__GAME__;
const P = window.__PERF__ = { frames: [], marks: [], slow: [], longtasks: [] };
const mark = (n) => P.marks.push([n, +performance.now().toFixed(1)]);
const proto = WebGL2RenderingContext.prototype;
let acc = Object.create(null);
let enabled = true;
for (const k of Object.getOwnPropertyNames(proto)) {
  let d; try { d = Object.getOwnPropertyDescriptor(proto, k); } catch { continue; }
  if (!d || typeof d.value !== 'function' || k === 'constructor') continue;
  const orig = d.value;
  proto[k] = function (...a) {
    const t = performance.now();
    const r = orig.apply(this, a);
    const e = performance.now() - t;
    const s = acc[k] || (acc[k] = { n: 0, ms: 0, max: 0 });
    s.n++; s.ms += e; if (e > s.max) s.max = e;
    return r;
  };
}
try {
  new PerformanceObserver(l => { for (const e of l.getEntries()) P.longtasks.push([+e.startTime.toFixed(0), +e.duration.toFixed(0)]); }).observe({ entryTypes: ['longtask'] });
} catch (e) {}
const origUpdate = G.update.bind(G), origRender = G.render.bind(G);
let curUpd = 0, curRen = 0;
G.update = function (dt) { const t = performance.now(); origUpdate(dt); curUpd = performance.now() - t; };
G.render = function () { const t = performance.now(); origRender(); curRen = performance.now() - t; };
let lastNow = performance.now(), frameNo = 0, lastProg = 0;
function top(a, n = 6) {
  return Object.entries(a).map(([k, v]) => [k, v.n, +v.ms.toFixed(1), +v.max.toFixed(1)]).sort((x, y) => y[2] - x[2]).slice(0, n);
}
function tick() {
  requestAnimationFrame(tick);
  const now = performance.now(); const dt = now - lastNow; lastNow = now;
  const info = G.renderer.info;
  const progs = info.programs ? info.programs.length : 0;
  const rec = { f: frameNo++, dt: +dt.toFixed(1), upd: +curUpd.toFixed(1), ren: +curRen.toFixed(1), st: G.state, newProgs: progs - lastProg };
  lastProg = progs;
  P.frames.push(rec);
  if (G.state === 'playing' && (dt > 60 || P.frames.filter(f => f.st === 'playing').length <= 3)) {
    P.slow.push({ ...rec, gl: top(acc) });
  }
  acc = Object.create(null); curUpd = 0; curRen = 0;
}
requestAnimationFrame(tick);
export function drive(t, dt, game) {}
export function finish(game, report) {
  report.custom = { slow: P.slow.slice(0, 14), longtasks: P.longtasks.slice(-30), frames: P.frames.length };
}
