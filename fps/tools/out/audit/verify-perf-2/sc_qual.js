const G = window.__GAME__;
const seq = ['medium', 'high', 'medium', 'high', 'low', 'high', 'medium', 'high'];
const mem = [], frames = [];
let lastNow = performance.now(), lastProg = 0, n = 0;
function tick() {
  requestAnimationFrame(tick);
  const now = performance.now(); const dt = now - lastNow; lastNow = now;
  const p = G.renderer.info.programs.length;
  frames.push({ f: n++, dt: +dt.toFixed(0), np: p - lastProg, st: G.state }); lastProg = p;
}
requestAnimationFrame(tick);
let step = -1, nextAt = 3;
export function drive(t, dt, game, report) {
  game.player.god = true;
  if (t >= nextAt && step < seq.length - 1) {
    step++; nextAt = t + 2.5;
    const before = { tex: G.renderer.info.memory.textures, geo: G.renderer.info.memory.geometries };
    G.setQuality(seq[step]);
    G.renderer.info.reset;
    mem.push({ q: seq[step], texBefore: before.tex, texAfterSync: G.renderer.info.memory.textures, composerRT: G.composer ? 1 : 0, f: n });
  }
}
export function finish(game, report) {
  // find frames after each switch: max dt within next 6 frames
  const out = mem.map(m => {
    const w = frames.filter(x => x.f >= m.f && x.f < m.f + 8);
    return Object.assign({}, m, { texNow: null, worst: Math.max(...w.map(x => x.dt)), newProgs: w.reduce((a, x) => a + x.np, 0) });
  });
  report.custom = { switches: out, finalTex: G.renderer.info.memory.textures, hasDispose: typeof (G.composer && G.composer.dispose) };
}
