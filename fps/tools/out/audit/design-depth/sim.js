// Bot behaviour sim: counts deaths by weapon, unprovoked falls, time bots spend in each zone, and pickups collected.
import * as THREE from 'three';
let acc = null;
export function setup(game, report) {
  acc = { deaths: {}, falls: [], zoneSecs: {}, pickups: 0, byBot: {} };
  game.player.god = true;
  game.events.on('death', e => {
    const k = e.weapon + (e.attacker ? '' : '(no attacker)');
    acc.deaths[k] = (acc.deaths[k] || 0) + 1;
    if (e.weapon === 'fall') acc.falls.push({ victim: e.victim.name, attacker: e.attacker ? e.attacker.name : null, t: +game.time.toFixed(1), pos: e.victim.position.toArray().map(v => +v.toFixed(0)) });
  });
  game.events.on('pickup', () => { acc.pickups++; });
}
export function drive(t, dt, game, report) {
  const zones = game.world.def.zones || [];
  for (const z of zones) {
    const c = new THREE.Vector3(...z.pos);
    for (const b of game.bots.list) {
      if (!b.alive) continue;
      const dx = b.position.x - c.x, dz = b.position.z - c.z;
      if (dx * dx + dz * dz <= z.radius * z.radius && Math.abs(b.position.y - c.y) <= 3) acc.zoneSecs[z.id] = (acc.zoneSecs[z.id] || 0) + dt;
    }
  }
  // park the (god) player on a spawn so it doesn't matter
  game.input.setVirtual('forward', false);
}
export function finish(game, report) {
  for (const k in acc.zoneSecs) acc.zoneSecs[k] = +acc.zoneSecs[k].toFixed(0);
  acc.botKD = game.bots.list.map(b => `${b.name}:${b.kills}/${b.deaths}`);
  report.custom = acc;
}
