const G = window.__GAME__;
const rows = [];
const origRender = G.render.bind(G);
let curR = 0;
G.render = function () { const t = performance.now(); origRender(); curR = performance.now() - t; const i = G.renderer.info; rows.push({ t: G.time, calls: i.render.calls, tris: i.render.triangles, r: curR, ph: window.__PH__ || 'A' }); };
function botMeshes() {
  const out = [];
  for (const b of G.bots.list) {
    let body = 0, wep = 0, wt = b.model && b.model.weapon && b.model.weapon.root;
    b.model.root.traverse(o => { if (o.isMesh) body++; });
    if (wt) wt.traverse(o => { if (o.isMesh) wep++; });
    out.push({ w: b.weaponId, total: body, weaponMeshes: wep, bodyOnly: body - wep });
  }
  return out;
}
let didCount = false;
export function drive(t, dt, game, report) {
  game.autotest._drive(t, dt);
  game.player.god = true;
  if (t > 3 && !didCount) { didCount = true; report.custom = { bots: botMeshes(), pickupsCulledFalse: null }; }
  const ph = t < 3 ? 'warm' : t < 8 ? 'A' : t < 13 ? 'noBots' : t < 18 ? 'botNoShadow' : 'A2';
  window.__PH__ = ph;
  for (const b of game.bots.list) {
    if (ph === 'noBots') b.model.root.visible = false;
    else if (ph === 'botNoShadow') { b.model.root.visible = true; b.model.root.traverse(o => { if (o.isMesh) o.castShadow = false; }); }
    else if (ph === 'A2' ) { if (!b.__re) { b.__re = 1; b.model.root.visible = true; b.model.root.traverse(o => { if (o.isMesh) o.castShadow = true; }); } }
  }
}
export function finish(game, report) {
  const med = a => { const s = a.slice().sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
  const by = {};
  for (const r of rows) (by[r.ph] = by[r.ph] || []).push(r);
  const sum = {};
  for (const k in by) sum[k] = { n: by[k].length, calls: med(by[k].map(x => x.calls)), tris: med(by[k].map(x => x.tris)), r: +med(by[k].map(x => x.r)).toFixed(2) };
  report.custom.sum = sum;
}
