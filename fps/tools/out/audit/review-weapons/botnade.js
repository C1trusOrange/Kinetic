const rec = { expl: { grenade: { n: 0, nullOwner: 0 }, rocket: { n: 0, nullOwner: 0 } }, deaths: [], dmgNullAttacker: 0 };
export function setup(game, report) {
  report.custom = rec;
  game.player.god = true;
  game.events.on('explosion', e => { const r = rec.expl[e.weapon]; if (r) { r.n++; if (!e.owner) r.nullOwner++; } });
  game.events.on('death', e => { if (e.weapon === 'grenade' || e.weapon === 'rocket') rec.deaths.push({ w: e.weapon, attacker: e.attacker ? e.attacker.name : null, victim: e.victim.name }); });
}
export function drive(t, dt, game, report) {
  // make bots use grenades more: give them all grenades
  for (const b of game.bots.list) if (b.alive && b.grenades < 2) b.grenades = 2;
}
