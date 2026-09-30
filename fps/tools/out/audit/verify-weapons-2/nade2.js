import * as THREE from 'three';
const rec = { explosions: [], damage: [], deaths: [] };
let phase = 0;
export function setup(game, report) {
  report.custom = rec;
  game.events.on('explosion', e => rec.explosions.push({ weapon: e.weapon, owner: e.owner ? e.owner.name : null }));
  game.events.on('damage', e => rec.damage.push({ weapon: e.weapon, amount: +e.amount.toFixed(1), attacker: e.attacker ? (e.attacker === game.player ? 'PLAYER' : e.attacker.name) : null, target: e.target === game.player ? 'PLAYER' : e.target.name }));
  game.events.on('death', e => rec.deaths.push({ weapon: e.weapon, attacker: e.attacker ? (e.attacker === game.player ? 'PLAYER' : e.attacker.name) : null, victim: e.victim === game.player ? 'PLAYER' : e.victim.name }));
}
export function drive(t, dt, game, report) {
  const p = game.player;
  if (t < 1.5) return;
  if (phase === 0) {
    phase = 1;
    rec.mode = game.match.mode;
    const o = p.position.clone(); o.y += 1.0;
    // owner = player, at player's own feet, fuse-detonated (same path as a thrown grenade)
    game.projectiles.spawnGrenade({ owner: p, origin: o, velocity: new THREE.Vector3(0, 0, 0), fuse: 0.1 });
  }
  if (phase === 1 && t > 3.5) { rec.hp = p.health; rec.armor = p.armor; rec.alive = p.alive; phase = 2; }
}
