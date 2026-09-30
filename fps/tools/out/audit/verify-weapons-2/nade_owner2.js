import * as THREE from 'three';
const rec = { damage: [], deaths: [], info: {} };
let step = 0, ts = 0;
export function setup(game, report) {
  report.custom = rec;
  game.events.on('damage', e => rec.damage.push({ t: +game.time.toFixed(2), step, weapon: e.weapon, amount: +e.amount.toFixed(1), attacker: e.attacker ? (e.attacker === game.player ? 'PLAYER' : e.attacker.name) : null, target: e.target === game.player ? 'PLAYER' : e.target.name, targetTeam: e.target.team }));
  game.events.on('death', e => rec.deaths.push({ t: +game.time.toFixed(2), step, weapon: e.weapon, attacker: e.attacker ? (e.attacker === game.player ? 'PLAYER' : e.attacker.name) : null, victim: e.victim === game.player ? 'PLAYER' : e.victim.name }));
}
export function drive(t, dt, game, report) {
  const p = game.player;
  if (t < 1.8) return;
  ts += dt;
  const mate = game.bots.list.find(b => b.team === p.team);
  rec.info.playerTeam = p.team; rec.info.mate = mate ? mate.name : null;
  if (step === 0) {
    // trial 1: grenade thrown by the player on a TEAMMATE bot
    step = 1; ts = 0;
    if (mate) {
      const org = mate.position.clone(); org.y += 0.9;
      rec.info.mateHp0 = mate.health;
      game.projectiles.spawnGrenade({ owner: p, origin: org, velocity: new THREE.Vector3(), fuse: 0.06 });
    }
  } else if (step === 1 && ts > 0.6) {
    rec.info.mateHp1 = mate ? mate.health : null;
    step = 2; ts = 0;
    // trial 2: grenade thrown by the player at its own feet
    p.god = false; p.health = 100; p.armor = 0; p.spawnProtectedUntil = 0;
    const org = p.position.clone(); org.y += 0.9;
    game.projectiles.spawnGrenade({ owner: p, origin: org, velocity: new THREE.Vector3(), fuse: 0.06 });
  } else if (step === 2 && ts > 0.6) {
    rec.info.playerHpAfterSelf = p.health; rec.info.playerAlive = p.alive;
    step = 3;
  }
}
