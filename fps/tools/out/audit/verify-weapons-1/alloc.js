// Count combat.raycast calls / hits made from Projectiles.update while a grenade rests on the floor.
const rec = { frames: 0, calls: 0, hits: 0, trailCalls: 0, restFrames: 0 };
let phase = 0, t0 = 0, counting = false;
export function setup(game, report) {
  report.custom = rec;
  game.player.god = true;
  const cr = game.combat.raycast.bind(game.combat);
  game.combat.raycast = (...a) => { const h = cr(...a); if (counting) { rec.calls++; if (h) rec.hits++; } return h; };
  const pu = game.projectiles.update.bind(game.projectiles);
  game.projectiles.update = (dt) => { const g = game.projectiles.grenades[0]; counting = phase === 2 && !!g && g.resting; if (counting) rec.restFrames++; pu(dt); counting = false; };
  const tr = game.effects.trail.bind(game.effects);
  game.effects.trail = (...a) => { if (phase === 2) rec.trailCalls++; return tr(...a); };
}
export function drive(t, dt, game, report) {
  if (phase === 0 && t > 1.0) {
    const org = game.player.position.clone(); org.y += 0.6; org.x += 1.5;
    game.projectiles.spawnGrenade({ owner: game.player, origin: org, velocity: new org.constructor(0, 0, 0), fuse: 2.5 });
    phase = 1; t0 = t;
  }
  if (phase === 1 && t - t0 > 1.0) { phase = 2; t0 = t; }
  if (phase === 2 && t - t0 > 1.2) { rec.resting = game.projectiles.grenades[0] ? game.projectiles.grenades[0].resting : null; phase = 3; }
}
