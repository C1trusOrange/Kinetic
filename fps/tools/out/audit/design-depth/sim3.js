// Like sim.js but keeps a per-bot ring buffer and dumps the last frames before every 'fall' death (to see WHY bots fall).
import * as THREE from 'three';
let acc = null;
const buf = new Map();
export function setup(game, report) {
  acc = { deaths: {}, falls: [], total: 0, netSecs: 0, botSecs: 0 };
  game.player.god = true;
  game.events.on('death', e => {
    acc.total++;
    acc.deaths[e.weapon] = (acc.deaths[e.weapon] || 0) + 1;
    if (e.weapon === 'fall') {
      const b = buf.get(e.victim) || [];
      const last = b.slice(-90).filter((_, i) => i % 6 === 0);
      acc.falls.push({ victim: e.victim.name, attacker: e.attacker ? e.attacker.name : null, t: +game.time.toFixed(1), tail: last });
    }
  });
}
export function drive(t, dt, game) {
  for (const b of game.bots.list) {
    if (!b.alive) continue;
    acc.botSecs += dt; if (b.position.y < -5 && b.position.y > -9) acc.netSecs += dt;
    let a = buf.get(b); if (!a) { a = []; buf.set(b, a); }
    a.push({ t: +game.time.toFixed(2), p: [b.position.x, b.position.y, b.position.z].map(v => +v.toFixed(1)), v: [b.velocity.x, b.velocity.y, b.velocity.z].map(v => +v.toFixed(1)), s: b.brain.state, g: b.onGround, dodge: b.brain.dodgeUntil > game.time, hp: Math.round(b.health), w: b.weaponId });
    if (a.length > 120) a.shift();
  }
}
export function finish(game, report) { acc.netSecs = +acc.netSecs.toFixed(0); acc.botSecs = +acc.botSecs.toFixed(0); report.custom = acc; }
