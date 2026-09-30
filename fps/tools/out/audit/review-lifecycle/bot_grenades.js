// Real bots in TDM: how many deaths have no attacker, how many are grenade kills, and are teammates hit by grenades?
export function drive() {}
const frames = n => new Promise(res => { let c = 0; const f = () => (++c >= n ? res() : requestAnimationFrame(f)); requestAnimationFrame(f); });

export async function setup(game, report) {
  const out = (window.__LC__ = { done: false, deaths: 0, byWeapon: {}, noAttacker: 0, noAttackerByWeapon: {}, grenadeThrows: 0, explosions: 0, explosionsNoOwner: 0, grenadeDamageToTeammate: 0, grenadeDamageEvents: 0, sumKills: 0, errors: [] });
  const origSpawn = game.projectiles.spawnGrenade.bind(game.projectiles);
  const teams = new Map();
  game.projectiles.spawnGrenade = o => { out.grenadeThrows++; return origSpawn(o); };
  game.events.on('death', e => {
    out.deaths++;
    out.byWeapon[e.weapon] = (out.byWeapon[e.weapon] || 0) + 1;
    if (!e.attacker) { out.noAttacker++; out.noAttackerByWeapon[e.weapon] = (out.noAttackerByWeapon[e.weapon] || 0) + 1; }
  });
  game.events.on('explosion', e => { out.explosions++; if (!e.owner && e.weapon === 'grenade') out.explosionsNoOwner++; });
  game.events.on('damage', e => { if (e.weapon === 'grenade') { out.grenadeDamageEvents++; if (!e.attacker && e.target.team !== undefined) out.grenadeDamageToTeammate += 0; } });
  try {
    const t0 = game.time;
    while (game.time - t0 < 90) await frames(30);
    out.sumKills = game.entities.reduce((a, e) => a + e.kills, 0);
    out.sumDeaths = game.entities.reduce((a, e) => a + e.deaths, 0);
    out.simSeconds = +(game.time - t0).toFixed(1);
  } catch (e) { out.errors.push(String(e && e.stack || e)); }
  out.done = true;
}
