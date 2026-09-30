// CPU-side split of the render frame (JS submission time, robust against GPU sharing) with A/B toggles alternated per frame.
const G = window.__GAME__;
const Q = new URLSearchParams(location.search);
const toggle = Q.get('toggle') || 'botshadow'; // botshadow | shadowupdate | viewpass
const S = { A: [], B: [], calls: { A: [], B: [] }, tris: { A: [], B: [] }, sh: { A: [], B: [] }, pass: {}, frame: 0 };
let cfg = 'A';
export function setup(game, report) {
  const r = game.renderer;
  const sm = r.shadowMap, osr = sm.render.bind(sm);
  let shMs = 0;
  sm.render = function (...a) { const t = performance.now(); const x = osr(...a); shMs += performance.now() - t; return x; };
  const names = game.composer.passes.map((p, i) => i + ':' + p.constructor.name);
  game.composer.passes.forEach((pass, i) => {
    const o = pass.render.bind(pass);
    pass.render = function (...a) { const t = performance.now(); const x = o(...a); const d = performance.now() - t; const k = names[i] + ' ' + cfg; (S.pass[k] = S.pass[k] || []).push(d); return x; };
  });
  const orr = game.render.bind(game);
  game.render = function () {
    if (game.state === 'playing' && game.time > 3) {
      S.frame++;
      cfg = (S.frame % 2) ? 'A' : 'B';
      if (toggle === 'botshadow') { for (const b of game.bots.list) { if (b.model) b.model.root.traverse(o => { if (o.isMesh) o.castShadow = cfg === 'A'; }); } }
      else if (toggle === 'shadowupdate') { r.shadowMap.autoUpdate = cfg === 'A'; r.shadowMap.needsUpdate = false; }
      else if (toggle === 'novgpickups') { const g = game.world.pickups.group; if (g) g.visible = cfg === 'A'; }
      else if (toggle === 'nobots') { for (const b of game.bots.list) if (b.model) b.model.root.visible = cfg === 'A'; }
      else if (toggle === 'nosky') { const sk = game.world.sky && game.world.sky.mesh; if (sk) sk.visible = cfg === 'A'; }
    }
    shMs = 0;
    const t = performance.now();
    if (toggle === 'viewpass' && game.composer) { const vp = game.viewPass; const o = game._showViewModel; }
    orr();
    const d = performance.now() - t;
    if (game.state === 'playing' && game.time > 3) {
      S[cfg].push(d); S.sh[cfg].push(shMs); S.calls[cfg].push(r.info.render.calls); S.tris[cfg].push(r.info.render.triangles);
    }
  };
  report.custom = {};
}
export function drive(t0, dt, game) {
  game.player.god = true;
  const t = t0 % 17;
  const inp = game.input;
  const s = (a, b) => t >= a && t < b;
  inp.setVirtual('forward', s(1, 9.5) || s(12, 17));
  inp.setVirtual('sprint', s(1.3, 4.2));
  inp.setVirtual('fire', s(4.8, 6.4) || s(7.0, 7.05));
  inp.addLook((s(4.8, 6.4) ? 250 : s(14, 17) ? 140 : 0) * dt, 0);
}
const med = a => { const s = a.slice().sort((x, y) => x - y); return s.length ? +s[Math.floor(s.length / 2)].toFixed(2) : 0; };
const mean = a => a.length ? +(a.reduce((x, y) => x + y, 0) / a.length).toFixed(2) : 0;
export function finish(game, report) {
  const out = { toggle, n: { A: S.A.length, B: S.B.length } };
  for (const c of ['A', 'B']) {
    out[c] = { renderMedian: med(S[c]), renderMean: mean(S[c]), shadowMedian: med(S.sh[c]), shadowMean: mean(S.sh[c]), callsMedian: med(S.calls[c]), trisMedian: med(S.tris[c]) };
  }
  out.pass = {};
  for (const [k, v] of Object.entries(S.pass)) out.pass[k] = { median: med(v), mean: mean(v) };
  out.bots = game.bots.list.length; out.map = game.world.mapId;
  report.custom = out;
}
