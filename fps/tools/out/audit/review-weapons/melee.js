import * as THREE from 'three';
import { Entity } from '/src/core/Entity.js';
const rec = { trials: [] };
let dummy = null, cur = null;
const D = [0.6, 1.0, 1.8, 2.0, 2.15, 2.3, 2.6];
export function setup(game, report) {
  report.custom = rec;
  game.player.god = true;
  dummy = new Entity(game);
  dummy.name = 'Dummy'; dummy.team = 99; dummy.isBot = true;
  dummy.color = new THREE.Color(0xff0000);
  game.addEntity(dummy);
  dummy.spawn(new THREE.Vector3(20, 0, -20), 0);
  dummy.spawnProtectedUntil = 0;
  game.events.on('damage', e => { if (cur && e.target === dummy) cur.dmg.push({ w: e.weapon, a: +e.amount.toFixed(1), head: e.headshot }); });
}
export function drive(t, dt, game, report) {
  const p = game.player, inp = game.input, w = game.weapons;
  const T0 = 1.0, STEP = 1.6;
  const k = Math.floor((t - T0) / STEP);
  if (k < 0 || k >= D.length) { inp.setVirtual('melee', false); return; }
  const lt = t - T0 - k * STEP;
  if (!cur || cur.k !== k) { cur = { k, d: D[k], dmg: [], hp0: 0 }; rec.trials.push(cur); dummy.health = 100; dummy.alive = true; }
  // hold player & dummy
  p.position.set(20, 0, -10); p.velocity.set(0, 0, 0); p.move.place(p.position); p.yaw = 0; p.pitch = 0;
  dummy.position.set(20, 0, -10 - cur.d); dummy.velocity.set(0, 0, 0);
  inp.setVirtual('melee', lt > 0.5 && lt < 0.55);
  cur.hp = dummy.health;
  cur.meleeT = w.meleeT;
}
