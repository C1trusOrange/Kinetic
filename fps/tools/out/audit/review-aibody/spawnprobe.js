// Probe: what does a bot look like for the first frames after (re)spawn? + death/respawn state resets.
const log = [];
let killed = false;
let respawnSeen = false;
let tKill = 0;
const snap = (t, g, b, tag) => ({
  tag, t: +t.toFixed(3), gt: +g.time.toFixed(3),
  alive: b.alive, onGround: b.onGround, y: +b.position.y.toFixed(3), vy: +b.velocity.y.toFixed(2),
  vis: b.model ? b.model.root.visible : null,
  air: b.model ? +b.model._k.air.toFixed(2) : null,
  airT: b.model ? +b.model._airT.toFixed(3) : null,
  land: b.model ? +b.model._land.toFixed(3) : null,
  noSnapLeft: +(b._noSnapUntil - g.time).toFixed(3),
});

export function setup(game, report) {
  report.custom = report.custom || {};
  report.custom.spawnLog = log;
  report.custom.bots = game.bots.list.length;
}

export function drive(t, dt, game, report) {
  const b = game.bots.list[0];
  if (!b) return;
  if (t < 0.6) log.push(snap(t, game, b, 'start'));
  if (t > 3 && !killed && b.alive) {
    killed = true;
    tKill = t;
    // pre-death state
    report.custom.preDeath = {
      weapon: b.weaponId, owned: b.owned.slice(), reloading: b.reloading, grenades: b.grenades,
      state: b.brain.state, firingUntil: b._firingUntil, hp: b.health, vel: b.velocity.toArray().map(v => +v.toFixed(2)),
      weaponRootParent: b.model.weapon && b.model.weapon.root.parent ? b.model.weapon.root.parent.name : null,
    };
    // make it dirty first: fake a low ammo + reload state
    b.inv[b.weaponId].mag = 1;
    game.combat.kill(b, { attacker: game.player, weapon: 'rifle', point: b.getChestPosition(new game.player.position.constructor()), direction: null });
    report.custom.afterKill = { alive: b.alive, vis: b.model.root.visible, respawnAt: b.respawnAt, gt: game.time, gibs: game.effects.gibList.length };
  }
  if (killed && !b.alive && t - tKill < 3) {
    if (t - tKill < 0.05) report.custom.deadFrameUpdate = { model: b.model.root.visible };
  }
  if (killed && b.alive && !respawnSeen) {
    respawnSeen = true;
    report.custom.respawnAtT = +t.toFixed(2);
    report.custom.postRespawn = {
      weapon: b.weaponId, owned: b.owned.slice(), reloading: b.reloading, grenades: b.grenades,
      state: b.brain.state, vis: b.model.root.visible, hp: b.health, armor: b.armor,
      vel: b.velocity.toArray().map(v => +v.toFixed(2)), mag: b.ammo, reserve: b.reserve,
      crouch: b.crouch, height: b.height,
      brainTarget: b.brain.target ? b.brain.target.name : null, mem: b.brain.mem.size,
      yawVel: b.brain.yawVel, faceAim: b.brain.faceAim,
      modelWeaponParent: b.model.weapon && b.model.weapon.root.parent ? b.model.weapon.root.parent.name : null,
    };
  }
  if (respawnSeen && t - report.custom.respawnAtT < 0.6) log.push(snap(t, game, b, 'respawn'));
}
