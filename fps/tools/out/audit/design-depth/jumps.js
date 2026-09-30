// Compares self-launch of a rocket at the feet vs. the proposed Kinetic Charge (knockback 20 x selfKnock 0.7 = 14) at a few offsets.
import * as THREE from 'three';
const res = [];
let stage = 0, t0 = 0, cur = null;
const tests = [
  { name: 'rocket_at_feet_0.3m', kind: 'rocket', off: 0.3 },
  { name: 'rocket_at_feet_1.0m', kind: 'rocket', off: 1.0 },
  { name: 'charge_20x0.7_at_feet_0.3m', kind: 'charge', off: 0.3 },
  { name: 'charge_20x0.7_at_1.0m', kind: 'charge', off: 1.0 },
  { name: 'charge_20x0.7_at_2.5m', kind: 'charge', off: 2.5 },
];
export function setup(game, report) { game.player.god = true; report.custom = { res }; }
function begin(game, tst) {
  const p = game.player;
  p.spawn(new THREE.Vector3(-8, 0, 0), -Math.PI / 2);
  p.god = true;
  cur = { tst, t0: game.time, maxY: 0, maxX: 0, x0: -8, v0: null };
  const c = new THREE.Vector3(-8 + tst.off, 0.15, 0);
  if (tst.kind === 'rocket') game.combat.radialDamage(c, { radius: 4.8, damage: 95, attacker: p, weapon: 'rocket', knockback: 15, selfScale: 0.35 });
  else game.combat.radialDamage(c, { radius: 7.5, damage: 14, attacker: p, weapon: 'kinetic', knockback: 20 * 0.7, selfScale: 0.2 });
  cur.v0 = p.velocity.toArray().map(v => +v.toFixed(1));
  p.health = 100;
}
export function drive(t, dt, game, report) {
  const p = game.player;
  if (stage < tests.length && !cur && t > 0.4 + stage * 3) { begin(game, tests[stage]); }
  if (cur) {
    cur.maxY = Math.max(cur.maxY, p.position.y);
    cur.maxX = Math.max(cur.maxX, Math.abs(p.position.x - cur.x0));
    if (game.time - cur.t0 > 2.4) {
      res.push({ name: cur.tst.name, v0: cur.v0, apexY: +cur.maxY.toFixed(2), reachX: +cur.maxX.toFixed(1), hp: Math.round(p.health) });
      cur = null; stage++;
    }
  }
}
