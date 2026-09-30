const rec = { log: [] };
let phase = 0, t0 = 0;
export function setup(game, report) { report.custom = rec; game.player.god = true; game.weapons.giveWeapon('sniper'); }
export function drive(t, dt, game, report) {
  const w = game.weapons, p = game.player, inp = game.input;
  if (phase === 0 && t > 0.3) { w._requestSwitch('sniper'); phase = 1; t0 = t; }
  if (phase === 1 && t - t0 > 1.2) { inp.setVirtual('ads', true); phase = 2; t0 = t; }
  if (phase === 2 && t - t0 > 1.2) { rec.log.push(['pre-end', { id: w.currentId, scoped: w.scoped, fov: +p.fovMultiplier.toFixed(3), look: p.lookScale, camFov: +game.camera.fov.toFixed(2) }]); game.endMatch('score'); phase = 3; t0 = t; }
  if (phase === 3) { rec.last = { state: game.state, endTimer: game._endTimer, ads: w.adsAmount, scoped: w.scoped, fov: +p.fovMultiplier.toFixed(3), look: p.lookScale, camFov: +game.camera.fov.toFixed(2), vmVisible: w.vm[w.currentId].root.visible, alive: p.alive }; }
}
