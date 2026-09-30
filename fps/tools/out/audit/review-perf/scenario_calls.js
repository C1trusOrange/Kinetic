// Per-frame renderer.info calls/triangles distribution (whole composer frame incl. shadow + post) while the standard script loops.
const S = { calls: [], tris: [], upd: [], ren: [] };
export function setup(game, report) {
  const orr = game.render.bind(game), ou = game.update.bind(game);
  let cu = 0;
  game.update = function (dt) { const t = performance.now(); ou(dt); cu = performance.now() - t; };
  game.render = function () {
    const t = performance.now(); orr(); const d = performance.now() - t;
    if (game.state === 'playing' && game.time > 2) { S.calls.push(game.renderer.info.render.calls); S.tris.push(game.renderer.info.render.triangles); S.ren.push(d); S.upd.push(cu); }
  };
  report.custom = {};
}
export function drive(t0, dt, game) {
  game.player.god = true;
  const t = t0 % 17; const inp = game.input; const s = (a, b) => t >= a && t < b;
  inp.setVirtual('forward', s(1, 9.5) || s(12, 17)); inp.setVirtual('sprint', s(1.3, 4.2) || s(14, 16));
  inp.setVirtual('fire', s(4.8, 6.4) || s(7.0, 7.05) || s(8.3, 8.35)); inp.setVirtual('grenade', s(11.0, 11.6));
  if (t >= 9.0 && !game.__gave) { game.__gave = true; game.weapons.giveWeapon('rocket'); }
  inp.setVirtual('weapon5', s(10.0, 10.05));
  inp.addLook(((s(4.8, 6.4) ? 250 : 0) + (s(14, 17) ? 140 : 0)) * dt, 0);
}
const q = (a, p) => { const s = a.slice().sort((x, y) => x - y); return s.length ? +s[Math.min(s.length - 1, Math.floor(s.length * p))].toFixed(1) : 0; };
export function finish(game, report) {
  const st = game.world.stats || {};
  report.custom = { map: game.world.mapId, n: S.calls.length, calls: { p5: q(S.calls, 0.05), p50: q(S.calls, 0.5), p95: q(S.calls, 0.95), max: q(S.calls, 1) }, tris: { p5: q(S.tris, 0.05), p50: q(S.tris, 0.5), p95: q(S.tris, 0.95), max: q(S.tris, 1) },
    renderCpuMs: { p50: q(S.ren, 0.5), p95: q(S.ren, 0.95) }, updateCpuMs: { p50: q(S.upd, 0.5), p95: q(S.upd, 0.95) }, mapStats: { drawCalls: st.drawCalls, triangles: st.triangles, solids: st.solids, collisionTriangles: st.collisionTriangles, materials: st.materials, navBuildMs: st.navBuildMs } };
}
