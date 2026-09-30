let killed = false, frozen = false;
export function setup(game, report) {
  report.custom = report.custom || {};
  const b = game.bots.list[0];
  const V = b.position.constructor;
  b.brain.update = () => {};
  b.teleportTo(new V(0, 0, 24), 0);
  b.yaw = 0;
  // stub out other bots
  for (const o of game.bots.list.slice(1)) { o.brain.update = () => {}; o.teleportTo(new V(-15, 0, 24), 0); }
  game.player.position.set(0, 0, 40);
  game.player.god = true;
}
export function drive(t, dt, game, report) {
  const b = game.bots.list[0];
  const V = b.position.constructor;
  if (!killed && t > 1.0) {
    killed = true;
    report.custom.preKill = { vis: b.model.root.visible, wparent: b.model.weapon.root.parent.name };
    game.combat.kill(b, { attacker: game.player, weapon: 'rifle', point: b.getChestPosition(new V()), direction: new V(0.3, 0.2, -1).normalize() });
    report.custom.gibs = game.effects.gibList.length;
    report.custom.gibNames = game.effects.gibList.map(g => g.mesh.name);
    report.custom.gibPos = game.effects.gibList.map(g => g.mesh.position.toArray().map(v => +v.toFixed(2)));
  }
  if (killed && !frozen && t > 1.35) { frozen = true; game.timeScale = 0; report.custom.frozen = true; report.custom.gibPosAfter = game.effects.gibList.map(g => g.mesh.position.toArray().map(v => +v.toFixed(2))); }
}
