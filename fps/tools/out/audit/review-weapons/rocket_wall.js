import * as THREE from 'three';
const rec = { trials: [] };
let cur = null;
const D = [0.42, 0.5, 0.7, 1.0, 1.5, 3.0];
export function setup(game, report) {
  report.custom = rec;
  game.events.on('explosion', e => { if (cur) cur.expl.push({ pos: e.position.toArray().map(v => +v.toFixed(2)), owner: e.owner ? 'p' : null }); });
  game.events.on('damage', e => { if (cur && e.target === game.player) cur.dmg.push({ amt: +e.amount.toFixed(1), w: e.weapon, att: e.attacker ? 'p' : null }); });
  game.weapons.giveWeapon('rocket');
}
export function drive(t, dt, game, report) {
  const p = game.player, inp = game.input, w = game.weapons;
  const T0 = 2.5, STEP = 1.5;
  const k = Math.floor((t - T0) / STEP);
  if (k < 0 || k >= D.length) { inp.setVirtual('fire', false); return; }
  const lt = t - T0 - k * STEP;
  if (!cur || cur.k !== k) {
    cur = { k, d: D[k], expl: [], dmg: [], spawn: null, wallZ: -31 };
    rec.trials.push(cur);
    game.projectiles.clear();
    p.health = 100; p.armor = 0;
    w.inv.rocket.ammo = 4; w.inv.rocket.reserve = 16;
    if (w.currentId !== 'rocket') w._requestSwitch('rocket');
  }
  if (lt < 0.2) {
    // hold the player in place
    p.position.set(20, 0, -31 + cur.d + 0.0);
    p.velocity.set(0, 0, 0);
    p.move.place(p.position);
    p.yaw = 0; p.pitch = 0;
  }
  inp.setVirtual('fire', lt > 0.75 && lt < 0.8);
  if (lt > 0.75 && lt < 0.8 && !cur.pre) {
    cur.pre = { pos: p.position.toArray().map(v => +v.toFixed(2)), eye: game.camera.position.toArray().map(v => +v.toFixed(2)), cur: w.currentId, ammo: w.ammo, alive: p.alive };
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(game.camera.quaternion);
    const h = game.world.raycast(game.camera.position, dir, 20);
    cur.pre.wallDist = h ? +h.distance.toFixed(2) : null;
  }
  if (game.projectiles.rockets.length && !cur.spawn) {
    const r = game.projectiles.rockets[0];
    cur.spawn = r.position.toArray().map(v => +v.toFixed(2));
  }
  cur.health = +p.health.toFixed(1);
}
