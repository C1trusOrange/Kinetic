// Measures knockback distances of the proposed Kinetic Charge (real Combat.radialDamage) and Repulsor-style impulses,
// plus ring-out attribution through the kill plane.
import * as THREE from 'three';
let stage = 0, t0 = 0, rec = null;
const log = [];
export function setup(game, report) {
  report.custom = { runs: [] };
  game.player.god = true;
  window.__deaths = [];
  game.events.on('death', e => window.__deaths.push({ victim: e.victim.name, attacker: e.attacker ? e.attacker.name : null, weapon: e.weapon, t: +game.time.toFixed(2) }));
}
function start(game, name, fn) {
  rec = { name, t0: game.time, maxD: 0, maxH: 0, startY: 0, startX: 0, samples: [], died: false, deathWeapon: null, deathAttacker: null };
  fn(rec);
}
export function drive(t, dt, game, report) {
  const bot = game.bots.list[0];
  const p = game.player;
  // keep the player parked far away & still
  if (stage === 0 && t > 0.6) {
    p.god = true;
    stage = 1; t0 = t;
    bot.god = false;
    bot.teleportTo(new THREE.Vector3(0, 0, 0), 0);
    p.position.set(-16, 0, 10);
    start(game, 'kinetic22_at_2.0m', r => {
      bot.brain.intent.speed = 0;
      r.startX = bot.position.x; r.startY = bot.position.y;
      const center = new THREE.Vector3(-2.0, 0.6, 0);
      game.combat.radialDamage(center, { radius: 7.5, damage: 10, attacker: p, weapon: 'kinetic', knockback: 22, selfScale: 0.25 });
      r.v0 = bot.velocity.toArray().map(v => +v.toFixed(1));
    });
  }
  if (rec) {
    const dx = bot.position.x - rec.startX;
    rec.maxD = Math.max(rec.maxD, Math.hypot(dx, bot.position.z));
    rec.maxH = Math.max(rec.maxH, bot.position.y - rec.startY);
    if (!bot.alive && !rec.died) {
      rec.died = true;
      rec.deathT = +(game.time - rec.t0).toFixed(2);
      rec.deathPos = bot.position.toArray().map(v => +v.toFixed(1));
    }
    rec.endX = +bot.position.x.toFixed(1);
    if (game.time - rec.t0 > 3.0 || rec.died) {
      report.custom.runs.push({ name: rec.name, v0: rec.v0, maxHoriz: +rec.maxD.toFixed(1), maxUp: +rec.maxH.toFixed(1), endX: rec.endX, died: rec.died, deathT: rec.deathT, deathPos: rec.deathPos });
      rec = null;
      stage++;
      t0 = t;
      if (!bot.alive) { game.respawnEntity(bot); }
    }
  }
  const idle = !rec;
  if (idle && stage === 2 && t - t0 > 0.5) {
    stage = 3;
    bot.teleportTo(new THREE.Vector3(14, 0, 0), 0);
    start(game, 'kinetic22_near_edge_x14_ringout', r => {
      r.startX = bot.position.x; r.startY = bot.position.y;
      const center = new THREE.Vector3(12.0, 0.6, 0);
      game.combat.radialDamage(center, { radius: 7.5, damage: 10, attacker: p, weapon: 'kinetic', knockback: 22, selfScale: 0.25 });
      r.v0 = bot.velocity.toArray().map(v => +v.toFixed(1));
    });
  }
  if (idle && stage === 4 && t - t0 > 0.5) {
    stage = 5;
    if (!bot.alive) game.respawnEntity(bot);
    bot.teleportTo(new THREE.Vector3(0, 0, 0), 0);
    bot.lastAttacker = null;
    start(game, 'repulsor_style_push23_at_2m', r => {
      r.startX = bot.position.x; r.startY = bot.position.y;
      const v = new THREE.Vector3(23 * (1 - 0.6 * 2 / 9.5), 4.5, 0);
      bot.applyImpulse(v);
      r.v0 = bot.velocity.toArray().map(v => +v.toFixed(1));
    });
  }
  if (idle && stage === 6 && t - t0 > 0.5) {
    stage = 7;
    if (!bot.alive) game.respawnEntity(bot);
    bot.teleportTo(new THREE.Vector3(0, 0, 0), 0);
    start(game, 'repulsor_style_push23_at_8m', r => {
      r.startX = bot.position.x; r.startY = bot.position.y;
      const v = new THREE.Vector3(23 * (1 - 0.6 * 8 / 9.5), 4.5, 0);
      bot.applyImpulse(v);
      r.v0 = bot.velocity.toArray().map(v => +v.toFixed(1));
    });
  }
  // player self-impulse tests (measure only)
  if (idle && stage === 8 && t - t0 > 0.5) {
    stage = 9; t0 = t;
    p.position.set(-10, 0, 10);
    p.spawn(new THREE.Vector3(-10, 0, 10), 0);
    p.god = true;
    p._imp = { y0: 0, maxY: 0, maxX: 0, x0: -10, t0: game.time, name: 'player_self_down_shot_12.8up' };
    p.applyImpulse(new THREE.Vector3(0, 12.8, 0));
  }
  if (stage === 9) {
    const i = p._imp;
    i.maxY = Math.max(i.maxY, p.position.y - i.y0);
    if (game.time - i.t0 > 2.5) {
      report.custom.runs.push({ name: i.name, maxUp: +i.maxY.toFixed(2) });
      stage = 10; t0 = t;
      p.spawn(new THREE.Vector3(-10, 0, 10), 0);
      p.god = true;
      p._imp = { y0: 0, maxY: 0, maxX: 0, x0: -10, t0: game.time, name: 'player_recoil_8_horizontal_ground' };
      p.applyImpulse(new THREE.Vector3(8, 0, 0));
    }
  }
  if (stage === 10) {
    const i = p._imp;
    i.maxX = Math.max(i.maxX, p.position.x - i.x0);
    if (game.time - i.t0 > 2.5) {
      report.custom.runs.push({ name: i.name, slideDist: +i.maxX.toFixed(2) });
      stage = 11; t0 = t;
      p.spawn(new THREE.Vector3(-10, 0, 10), 0);
      p.god = true;
      p._imp = { y0: 0, maxY: 0, maxX: 0, x0: -10, t0: game.time, name: 'player_kinetic_launch_21_at_35deg' };
      p.applyImpulse(new THREE.Vector3(21 * Math.cos(0.6), 21 * Math.sin(0.6) + 5, 0));
    }
  }
  if (stage === 11) {
    const i = p._imp;
    i.maxY = Math.max(i.maxY, p.position.y - i.y0);
    i.maxX = Math.max(i.maxX, p.position.x - i.x0);
    if (game.time - i.t0 > 3.0) {
      report.custom.runs.push({ name: i.name, maxUp: +i.maxY.toFixed(2), maxX: +i.maxX.toFixed(2), landedY: +p.position.y.toFixed(1), alive: p.alive });
      stage = 12;
    }
  }
}
export function finish(game, report) {
  report.custom.stage = stage;
  report.custom.killEvents = window.__deaths || [];
}
