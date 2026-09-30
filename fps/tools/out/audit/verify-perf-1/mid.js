// verify-perf-1: mid-game lazy-compile attribution with the standard 17 s script.
const G = window.__GAME__;
const Q = new URLSearchParams(location.search);
const warm = Q.get('warm') || '0';
const R = window.__VP1__ = { frames: [], events: [], notes: {} };
const r = G.renderer;
const known = new Set();
function path(o) { const a = []; let c = o; for (let i = 0; i < 4 && c; i++) { a.push((c.name || c.type)); c = c.parent; } return a.join('<'); }
const origUpdate = G.update.bind(G), origRender = G.render.bind(G);
let curUpd = 0, curRen = 0, first = true;
G.update = function (dt) { const t = performance.now(); origUpdate(dt); curUpd = performance.now() - t; };
G.render = function () {
  const t = performance.now(); origRender(); curRen = performance.now() - t;
  if (G.state !== 'playing') return;
  const nowProgs = r.info.programs.filter(p => !known.has(p));
  if (nowProgs.length) {
    const ns = new Set(nowProgs);
    const who = [];
    for (const [nm, root] of [['world', G.scene], ['view', G.viewScene]]) {
      root.traverse(o => {
        const mats = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
        for (const m of mats) {
          const pr = r.properties.get(m);
          if (pr && pr.currentProgram && ns.has(pr.currentProgram)) who.push(nm + ':' + m.type + ':' + path(o));
        }
      });
    }
    for (const p of nowProgs) known.add(p);
    if (!first) R.events.push({ gt: +G.time.toFixed(2), n: nowProgs.length, ren: +curRen.toFixed(0), who: [...new Set(who)].slice(0, 6) });
    first = false;
  }
};
let lastNow = performance.now(), n = 0;
(function tick() {
  requestAnimationFrame(tick);
  const now = performance.now(); const dt = now - lastNow; lastNow = now;
  if (G.state === 'playing') { n++; R.frames.push({ n, gt: +G.time.toFixed(2), dt: +dt.toFixed(1), upd: +curUpd.toFixed(1), ren: +curRen.toFixed(1) }); }
  curUpd = 0; curRen = 0;
})();

export async function setup(game, report) {
  R.notes.warm = warm;
  if (warm === '1') {
    game.projectiles._warmed = true; game.weapons._compiled = true;
    const rt = game.composer ? game.composer.renderTarget1 : null;
    r.setRenderTarget(rt);
    r.compile(game.scene, game.camera);
    r.compile(game.viewScene, game.viewCamera);
    r.setRenderTarget(null);
  }
  report.custom = {};
}
export function drive(t0, dt, game) {
  const inp = game.input;
  const t = t0 % 17;
  const S = (a, b) => t >= a && t < b;
  inp.setVirtual('forward', S(1, 9.5) || S(12, 17));
  inp.setVirtual('sprint', S(1.3, 4.2) || S(14, 16));
  inp.setVirtual('jump', S(2.4, 2.5) || S(2.9, 3.0) || S(10.45, 10.55) || S(13.6, 13.7) || S(15.2, 15.3));
  inp.setVirtual('crouch', S(3.6, 4.4));
  inp.setVirtual('ads', S(5.6, 6.4));
  inp.setVirtual('fire', S(4.8, 6.4) || S(7.0, 7.05) || S(7.35, 7.4) || S(7.7, 7.75) || S(8.3, 8.35) || S(9.6, 9.65) || S(10.5, 10.55));
  inp.setVirtual('reload', S(6.5, 6.55));
  inp.setVirtual('weapon1', S(6.8, 6.85));
  inp.setVirtual('weapon3', S(8.0, 8.05));
  if (t >= 9.0 && !game.__gave) { game.__gave = true; game.weapons.giveWeapon('sniper'); game.weapons.giveWeapon('rocket'); }
  inp.setVirtual('weapon4', S(9.1, 9.15));
  inp.setVirtual('weapon5', S(10.0, 10.05));
  inp.setVirtual('grenade', S(11.0, 11.6));
  inp.setVirtual('weapon2', S(11.8, 11.85));
  inp.setVirtual('grapple', S(12.3, 12.35) || S(13.5, 13.55));
  inp.setVirtual('melee', S(16.5, 16.55));
  let lx = 0, ly = 0;
  if (S(4.8, 6.4)) lx = 250;
  if (S(10.2, 10.45)) ly = 2400;
  if (S(10.7, 10.95)) ly = -2400;
  if (S(12.0, 12.3)) ly = -800;
  if (S(13.8, 14.1)) ly = 800;
  if (S(14, 17)) lx = 140;
  inp.addLook(lx * dt, ly * dt);
  game.player.god = true;
}
export function finish(game, report) {
  const fr = R.frames;
  const rest = fr.slice(1);
  const st = rest.filter(f => f.dt > 120);
  report.custom = {
    warm, events: R.events,
    stallsOver120: st.length, stallSumMs: +st.reduce((a, f) => a + f.dt, 0).toFixed(0),
    first: fr[0], frames: fr.length,
    endProgs: r.info.programs.length,
  };
}
