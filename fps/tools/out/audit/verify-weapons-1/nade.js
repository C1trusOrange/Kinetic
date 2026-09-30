// Verify: real thrown grenade (input path) -> explosion owner
const rec = { explosions: [], phase: [] };
export function setup(game, report) {
  report.custom = rec;
  game.events.on('explosion', e => rec.explosions.push({ t: +game.time.toFixed(2), weapon: e.weapon, ownerIsPlayer: e.owner === game.player, ownerIsBot: !!(e.owner && e.owner !== game.player), owner: e.owner ? e.owner.name : null }));
  game.events.on('damage', e => { if (e.weapon === 'grenade') (rec.dmg = rec.dmg || []).push({ attacker: e.attacker ? e.attacker.name : null, target: e.target === game.player ? 'PLAYER' : e.target.name, amount: +e.amount.toFixed(1) }); });
}
let phase = 0, t0 = 0;
export function drive(t, dt, game, report) {
  const inp = game.input;
  if (phase === 0 && t > 1.0) { inp.setVirtual('grenade', true); phase = 1; t0 = t; rec.phase.push(['hold', t]); }
  if (phase === 1 && t - t0 > 0.5) { inp.setVirtual('grenade', false); phase = 2; t0 = t; rec.phase.push(['release', t]); rec.grenadesLive = game.projectiles.grenades.length; }
  if (phase === 2 && t - t0 > 0.3) { rec.grenadesLive2 = game.projectiles.grenades.length; phase = 3; }
  // also direct bot-owned grenade at player's feet
  if (phase === 3 && t - t0 > 5) {
    const bot = game.bots.list[0];
    const org = game.player.position.clone(); org.y += 0.5;
    game.projectiles.spawnGrenade({ owner: bot, origin: org, velocity: new (org.constructor)(0,0,0), fuse: 0.1 });
    rec.phase.push(['botnade at player', t]);
    phase = 4;
  }
}
