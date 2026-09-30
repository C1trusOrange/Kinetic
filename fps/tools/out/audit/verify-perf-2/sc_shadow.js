// F5/F6: projectile mesh counts + shadow autoUpdate A/B + weapon-parts-only shadow toggle
const G = window.__GAME__;
const rows = [];
const origRender = G.render.bind(G);
G.render = function () { const t = performance.now(); origRender(); const r = performance.now() - t; const i = G.renderer.info; rows.push({ calls: i.render.calls, tris: i.render.triangles, r, ph: window.__PH__ || 'warm' }); };
function count(root) { let m = 0, cs = 0; root.traverse(o => { if (o.isMesh) { m++; if (o.castShadow) cs++; } }); return { meshes: m, castShadow: cs }; }
let done = false;
export function drive(t, dt, game, report) {
  game.autotest._drive(t, dt);
  game.player.god = true;
  if (!done) {
    done = true;
    report.custom = { rocket: count(game.projectiles._rocketPool[0].group), grenade: count(game.projectiles._grenadePool[0].group),
      botWeapon: game.bots.list.map(b => count(b.model.weapon.root)), botBody: count(game.bots.list[0].model.root) };
  }
  const ph = t < 3 ? 'warm' : t < 8 ? 'A' : t < 13 ? 'noAutoUpdate' : t < 18 ? 'weaponNoShadow' : 'A2';
  window.__PH__ = ph;
  game.renderer.shadowMap.autoUpdate = !(ph === 'noAutoUpdate');
  if (ph === 'noAutoUpdate') game.renderer.shadowMap.needsUpdate = false;
  for (const b of game.bots.list) {
    const w = b.model.weapon && b.model.weapon.root;
    if (!w) continue;
    const want = !(ph === 'weaponNoShadow');
    w.traverse(o => { if (o.isMesh) o.castShadow = want; });
  }
}
export function finish(game, report) {
  const med = a => { const s = a.slice().sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
  const by = {};
  for (const r of rows) (by[r.ph] = by[r.ph] || []).push(r);
  const sum = {};
  for (const k in by) sum[k] = { n: by[k].length, calls: med(by[k].map(x => x.calls)), tris: med(by[k].map(x => x.tris)), r: +med(by[k].map(x => x.r)).toFixed(2) };
  report.custom.sum = sum;
  game.renderer.shadowMap.autoUpdate = true;
}
