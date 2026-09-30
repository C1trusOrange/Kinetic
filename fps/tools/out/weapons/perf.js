// Measures CPU cost per frame of the weapons module while firing / cooking / moving.
const acc = { update: 0, view: 0, proj: 0, n: 0, maxUpdate: 0, maxView: 0 };
export function setup(game, report) {
  report.custom = acc;
  const w = game.weapons, P = game.projectiles;
  const u = w.update.bind(w), v = w.updateViewModel.bind(w), pu = P.update.bind(P);
  w.update = dt => { const t = performance.now(); u(dt); const d = performance.now() - t; acc.update += d; acc.maxUpdate = Math.max(acc.maxUpdate, d); acc.n++; };
  w.updateViewModel = dt => { const t = performance.now(); v(dt); const d = performance.now() - t; acc.view += d; acc.maxView = Math.max(acc.maxView, d); };
  P.update = dt => { const t = performance.now(); pu(dt); acc.proj += performance.now() - t; };
  game.player.god = true;
}
export function drive(t, dt, game) {
  const inp = game.input;
  inp.setVirtual('forward', t > 1);
  inp.setVirtual('fire', t > 2 && t < 6);
  inp.setVirtual('grenade', t > 7 && t < 8.5);
  inp.setVirtual('reload', t > 6.2 && t < 6.25);
  if (t > 10 && t < 10.05 && !game._g2) { game._g2 = true; for (let i = 0; i < 6; i++) game.projectiles.spawnGrenade({ owner: game.player, origin: game.player.position.clone().setY(2), velocity: game.player.position.clone().set(3 + i, 4, 2 - i), fuse: 3 }); }
  game.input.addLook(Math.sin(t * 3) * 6, Math.cos(t * 2) * 3);
}
export function finish(game, report) {
  acc.avgUpdateMs = +(acc.update / acc.n).toFixed(4);
  acc.avgViewMs = +(acc.view / acc.n).toFixed(4);
  acc.avgProjMs = +(acc.proj / acc.n).toFixed(4);
  acc.maxUpdate = +acc.maxUpdate.toFixed(3); acc.maxView = +acc.maxView.toFixed(3);
}
