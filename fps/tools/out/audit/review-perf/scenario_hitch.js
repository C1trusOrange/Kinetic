// Records per-frame timing, program counts and hooks GL link/compile time to attribute hitches.
const G = window.__GAME__;
const P = window.__PERF__ = { frames: [], marks: [], gl: { link: 0, linkN: 0, compile: 0, compileN: 0, getParam: 0, gpp: [] }, hitches: [] };
const mark = (n) => P.marks.push([n, +performance.now().toFixed(1)]);
mark('module');

// GL hooks
const proto = WebGL2RenderingContext.prototype;
const origLink = proto.linkProgram, origCompile = proto.compileShader, origGPP = proto.getProgramParameter;
proto.linkProgram = function (...a) { const t = performance.now(); const r = origLink.apply(this, a); P.gl.link += performance.now() - t; P.gl.linkN++; return r; };
proto.compileShader = function (...a) { const t = performance.now(); const r = origCompile.apply(this, a); P.gl.compile += performance.now() - t; P.gl.compileN++; return r; };
proto.getProgramParameter = function (p, pn) { const t = performance.now(); const r = origGPP.call(this, p, pn); const d = performance.now() - t; if (pn === this.LINK_STATUS) { P.gl.getParam += d; if (d > 5) P.gl.gpp.push([+performance.now().toFixed(0), +d.toFixed(1)]); } return r; };

// wrap game.update/render
const origUpdate = G.update.bind(G), origRender = G.render.bind(G);
let curUpd = 0, curRen = 0, curGL0 = 0;
G.update = function (dt) { const t = performance.now(); origUpdate(dt); curUpd = performance.now() - t; };
G.render = function () { const t = performance.now(); origRender(); curRen = performance.now() - t; };

// wrap world.load / bots.prepare / nav build
const wl = G.world.load.bind(G.world);
G.world.load = async function (...a) { mark('world.load start'); const r = await wl(...a); mark('world.load end'); return r; };
const bp = G.bots.prepare.bind(G.bots);
G.bots.prepare = async function (...a) { mark('bots.prepare start'); const r = await bp(...a); mark('bots.prepare end'); return r; };

let lastNow = performance.now(), lastProg = 0, frameNo = 0;
const origLoopRaf = window.requestAnimationFrame.bind(window);
function tick() {
  origLoopRaf(tick);
  const now = performance.now();
  const dt = now - lastNow; lastNow = now;
  const info = G.renderer.info;
  const progs = info.programs ? info.programs.length : 0;
  const rec = { f: frameNo++, t: +now.toFixed(0), dt: +dt.toFixed(1), upd: +curUpd.toFixed(1), ren: +curRen.toFixed(1), st: G.state, progs, newProgs: progs - lastProg, gt: +G.time.toFixed(2), calls: info.render.calls, tris: info.render.triangles };
  lastProg = progs;
  P.frames.push(rec);
  if (dt > 45) P.hitches.push(rec);
  curUpd = 0; curRen = 0;
}
origLoopRaf(tick);

export function drive(t, dt, game, report) {
  // just run idle; the baseline autotest script drives inputs
  game.input.setVirtual('forward', t > 1 && t < 9);
}
export function finish(game, report) {
  const fr = P.frames;
  const sorted = fr.slice(5).map(f => f.dt).sort((a, b) => a - b);
  const pct = q => sorted[Math.floor(sorted.length * q)];
  report.custom = {
    marks: P.marks,
    frames: fr.length,
    p50: pct(0.5), p95: pct(0.95), p99: pct(0.99), max: sorted[sorted.length - 1],
    hitches: P.hitches.slice(0, 40),
    gl: { link: +P.gl.link.toFixed(0), linkN: P.gl.linkN, compile: +P.gl.compile.toFixed(0), compileN: P.gl.compileN, getParam: +P.gl.getParam.toFixed(0), gpp: P.gl.gpp.slice(0, 40) },
    finalProgs: fr[fr.length - 1].progs,
    worldStats: game.world.stats,
    navStats: game.world.nav.stats,
  };
}
