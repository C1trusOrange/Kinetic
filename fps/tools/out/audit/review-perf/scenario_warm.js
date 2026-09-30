// A/B for shader warm-up strategies. ?warm=0 baseline, 1 = compile() in the composer's render-target variant, 2 = one full composer render with every hidden pooled object visible.
const G = window.__GAME__;
const Q = new URLSearchParams(location.search);
const warm = Q.get('warm') || '0';
const P = window.__PERF__ = { frames: [], marks: [], warmMs: 0, warmNew: 0 };
const origUpdate = G.update.bind(G), origRender = G.render.bind(G);
let curUpd = 0, curRen = 0;
G.update = function (dt) { const t = performance.now(); origUpdate(dt); curUpd = performance.now() - t; };
G.render = function () { const t = performance.now(); origRender(); curRen = performance.now() - t; };
let lastNow = performance.now(), frameNo = 0, lastProg = 0, playingFrames = 0;
function tick() {
  requestAnimationFrame(tick);
  const now = performance.now(); const dt = now - lastNow; lastNow = now;
  const progs = G.renderer.info.programs ? G.renderer.info.programs.length : 0;
  if (G.state === 'playing') {
    playingFrames++;
    P.frames.push({ n: playingFrames, gt: +G.time.toFixed(2), dt: +dt.toFixed(1), upd: +curUpd.toFixed(1), ren: +curRen.toFixed(1), newProgs: progs - lastProg });
  }
  lastProg = progs; curUpd = 0; curRen = 0;
}
requestAnimationFrame(tick);

export async function setup(game, report) {
  const r = game.renderer;
  const t0 = performance.now();
  const n0 = r.info.programs.length;
  P.startProgs = n0;
  if (warm === '1' || warm === '2' || warm === '3') { game.projectiles._warmed = true; game.weapons._compiled = true; }
  if (warm === '1') {
    const rt = game.composer ? game.composer.renderTarget1 : null;
    r.setRenderTarget(rt);
    r.compile(game.scene, game.camera);
    r.compile(game.viewScene, game.viewCamera);
    r.setRenderTarget(null);
    const gl = r.getContext(); for (const p of r.info.programs) gl.getProgramParameter(p.program, gl.LINK_STATUS);
  } else if (warm === '4') {
    r.debug.checkShaderErrors = false;
  } else if (warm === '3') {
    const rt = game.composer ? game.composer.renderTarget1 : null;
    r.setRenderTarget(rt);
    const p1 = r.compileAsync(game.scene, game.camera);
    const p2 = r.compileAsync(game.viewScene, game.viewCamera);
    r.setRenderTarget(null);
    await Promise.all([p1, p2]);
  } else if (warm === '2') {
    const hidden = [];
    for (const root of [game.scene, game.viewScene]) root.traverse(o => { if (o.visible === false) hidden.push(o); });
    for (const o of hidden) o.visible = true;
    const showView = game._showViewModel;
    if (game.viewPass) game.viewPass.enabled = true;
    game.render();
    const gl = r.getContext(); gl.finish();
    for (const o of hidden) o.visible = false;
    P.hiddenMadeVisible = hidden.length;
  }
  P.warmMs = +(performance.now() - t0).toFixed(1);
  P.warmNew = r.info.programs.length - n0;
  curUpd = 0; curRen = 0;
  report.custom = {};
}
export function drive(t0, dt, game) {
  const t = t0 % 17;
  const inp = game.input;
  const s = (a, b) => t >= a && t < b;
  inp.setVirtual('forward', s(1, 9.5) || s(12, 17));
  inp.setVirtual('sprint', s(1.3, 4.2) || s(14, 16));
  inp.setVirtual('jump', s(2.4, 2.5) || s(2.9, 3.0) || s(10.45, 10.55) || s(13.6, 13.7) || s(15.2, 15.3));
  inp.setVirtual('crouch', s(3.6, 4.4));
  inp.setVirtual('ads', s(5.6, 6.4));
  inp.setVirtual('fire', s(4.8, 6.4) || s(7.0, 7.05) || s(7.35, 7.4) || s(7.7, 7.75) || s(8.3, 8.35) || s(9.6, 9.65) || s(10.5, 10.55));
  inp.setVirtual('reload', s(6.5, 6.55));
  inp.setVirtual('weapon1', s(6.8, 6.85));
  inp.setVirtual('weapon3', s(8.0, 8.05));
  if (t >= 9.0 && !game.__gave) { game.__gave = true; game.weapons.giveWeapon('sniper'); game.weapons.giveWeapon('rocket'); }
  inp.setVirtual('weapon4', s(9.1, 9.15));
  inp.setVirtual('weapon5', s(10.0, 10.05));
  inp.setVirtual('grenade', s(11.0, 11.6));
  inp.setVirtual('weapon2', s(11.8, 11.85));
  inp.setVirtual('grapple', s(12.3, 12.35) || s(13.5, 13.55));
  inp.setVirtual('melee', s(16.5, 16.55));
  let lx = 0, ly = 0;
  if (s(4.8, 6.4)) lx = 250;
  if (s(10.2, 10.45)) ly = 2400;
  if (s(10.7, 10.95)) ly = -2400;
  if (s(12.0, 12.3)) ly = -800;
  if (s(13.8, 14.1)) ly = 800;
  if (s(14, 17)) lx = 140;
  inp.addLook(lx * dt, ly * dt);
  game.player.god = true;
}
export function finish(game, report) {
  const fr = P.frames;
  const first = fr[0] || {};
  const rest = fr.slice(1);
  const stalls = rest.filter(f => f.dt > 120);
  report.custom = {
    warm, warmMs: P.warmMs, warmNewProgs: P.warmNew, startProgs: P.startProgs, endProgs: game.renderer.info.programs.length,
    hiddenMadeVisible: P.hiddenMadeVisible,
    firstFrame: first, second: fr[1],
    stallCount: stalls.length, stallSumMs: +stalls.reduce((a, f) => a + f.dt, 0).toFixed(0),
    stalls: stalls.slice(0, 10),
    midGameNewProgFrames: rest.filter(f => f.newProgs > 0).map(f => ({ gt: f.gt, n: f.newProgs, dt: f.dt, ren: f.ren })),
    p50: (() => { const a = rest.map(f => f.dt).sort((x, y) => x - y); return a[Math.floor(a.length / 2)]; })(),
    frames: fr.length,
  };
}
