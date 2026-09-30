// Functional test for Tempest (arc) + Gale: DPS / chaining, shove distance, splat, self push, reflect, protected
// knockback, bots using both weapons. Run with map=foundry&bots=3 (or sandbox), duration ~40.
import * as THREE from 'three';

const S = { phase: 'init', t0: 0, log: [] };
const UP = new THREE.Vector3(0, 1, 0);
const DOWN = new THREE.Vector3(0, -1, 0);

function floorAt(w, x, y, z) {
  const h = w.raycast(new THREE.Vector3(x, y + 1.0, z), DOWN, 3);
  return h ? h.point.y : null;
}

/** Find a straight, flat lane from a spawn point: returns {P, dir, wall} */
function findLane(game, minWall, maxWall, needWidth) {
  const w = game.world;
  const def = w.def;
  const o = new THREE.Vector3();
  const d = new THREE.Vector3();
  for (const s of def.spawns) {
    const P = new THREE.Vector3(s.pos[0], s.pos[1], s.pos[2]);
    const fy = floorAt(w, P.x, P.y, P.z);
    if (fy === null) continue;
    P.y = fy;
    for (let i = 0; i < 24; i++) {
      const a = i * Math.PI / 12;
      d.set(Math.cos(a), 0, Math.sin(a));
      o.set(P.x, P.y + 1.2, P.z);
      const h = w.raycast(o, d, 40);
      const wall = h ? h.distance : 99;
      if (wall < minWall || wall > maxWall) continue;
      if (h && Math.abs(h.normal.y) > 0.3) continue;
      // flat lane along 0..min(wall - 0.5, 14) m, and a clear lane at 0.5 m height too
      let ok = true;
      const len = Math.min(wall - 0.6, 14);
      for (let k = 1; k <= len && ok; k++) {
        const y = floorAt(w, P.x + d.x * k, P.y, P.z + d.z * k);
        if (y === null || Math.abs(y - P.y) > 0.2) ok = false;
        if (needWidth) {
          for (const side of [-2.2, 2.2]) {
            const y2 = floorAt(w, P.x + d.x * k - d.z * side, P.y, P.z + d.z * k + d.x * side);
            if (y2 === null || Math.abs(y2 - P.y) > 0.2) ok = false;
          }
        }
      }
      if (!ok) continue;
      o.set(P.x, P.y + 0.4, P.z);
      const h2 = w.raycast(o, d, Math.min(wall, 14));
      if (h2 && h2.distance < Math.min(wall, 14) - 0.3) continue;
      return { P: P.clone(), dir: d.clone(), wall };
    }
  }
  return null;
}

function neutral(bot) {
  if (bot._neutral) return;
  bot._neutral = true;
  bot.brain.update = function () {
    const it = this.intent;
    it.moveX = 0; it.moveZ = 0; it.speed = 0; it.jump = false; it.crouch = false; it.fire = false; it.reload = false; it.weapon = null;
  };
}
function unneutral(bot) {
  if (!bot._neutral) return;
  bot._neutral = false;
  delete bot.brain.update;
}

function place(game, P, dir) {
  const p = game.player;
  p.position.copy(P);
  p.move.place(p.position);
  p.velocity.set(0, 0, 0);
  p.yaw = Math.atan2(-dir.x, -dir.z);
  p.pitch = 0;
  p.spawnProtectedUntil = 0;
}

function botAt(game, bot, pos, yawDir) {
  bot.teleportTo(pos, Math.atan2(-yawDir.x, -yawDir.z));
  bot.velocity.set(0, 0, 0);
  bot.spawnProtectedUntil = 0;
  bot.maxHealth = 1e6; bot.health = 1e6; bot.armor = 0;
}

export async function setup(game, report) {
  const c = report.custom = report.custom || {};
  c.lane1 = null;
  const lane1 = findLane(game, 17, 60, true);        // open lane: wall >= 17 m away (arc + free shove distance)
  const lane2 = findLane(game, 9.5, 12.5, false);    // short lane: wall 9.5-12.5 m (splat)
  S.lane1 = lane1; S.lane2 = lane2;
  c.lanes = { lane1: lane1 && { P: lane1.P.toArray().map(v => +v.toFixed(2)), dir: lane1.dir.toArray().map(v => +v.toFixed(2)), wall: +lane1.wall.toFixed(1) },
    lane2: lane2 && { P: lane2.P.toArray().map(v => +v.toFixed(2)), dir: lane2.dir.toArray().map(v => +v.toFixed(2)), wall: +lane2.wall.toFixed(1) } };
  // model triangle counts
  const WM = await import('/src/weapons/WeaponModels.js');
  c.tris = {};
  for (const id of ['arc', 'gale']) {
    c.tris[id] = {
      view: WM.createWeaponModel(id, { view: true }).triangles,
      world: WM.createWeaponModel(id, { view: false }).triangles,
      batched: WM.createWeaponModel(id, { view: false, batched: true }).triangles,
    };
  }
  // event taps
  S.dmg = { arc: {}, gale: 0, splat: 0, botArc: 0, botGale: 0, arcTicks: 0, botArcTicks: 0, botGaleHits: 0 };
  S.first = {}; S.last = {};
  S.events = { splat: [], reflect: 0, shove: 0 };
  game.events.on('damage', e => {
    if (e.weapon === 'arc') {
      const k = e.target.name;
      if (e.attacker === game.player) {
        S.dmg.arc[k] = (S.dmg.arc[k] || 0) + e.amount;
        if (S.first[k] === undefined) S.first[k] = game.time;
        S.last[k] = game.time;
      } else S.dmg.botArc += e.amount;
    } else if (e.weapon === 'gale') {
      if (e.attacker === game.player) S.dmg.gale += e.amount; else { S.dmg.botGale += e.amount; S.dmg.botGaleHits++; }
    } else if (e.weapon === 'splat') S.dmg.splat += e.amount;
  });
  game.events.on('splat', e => S.events.splat.push({ dmg: +e.damage.toFixed(1), drop: +e.drop.toFixed(1), victim: e.victim.name, at: +game.time.toFixed(2), phase: S.phase }));
  game.events.on('reflect', () => S.events.reflect++);
  game.events.on('shove', () => S.events.shove++);
  game.events.on('weapon:fire', e => { if (e.weapon === 'arc' && e.shooter !== game.player) S.dmg.botArcTicks++; });
}

function stepPhase(name, t) { S.phase = name; S.t0 = t; }

export function drive(t, dt, game, report) {
  const c = report.custom;
  const inp = game.input;
  const w = game.weapons;
  const p = game.player;
  const bots = game.bots.list;
  const el = t - S.t0;
  if (!c || !c.lanes || !S.dmg) return;
  switch (S.phase) {
    case 'init':
      if (t < 2.2) return;
      if (!S.lane1) { c.error = 'no lane1'; game.autotest.finish(); return; }
      for (const b of bots) neutral(b);
      place(game, S.lane1.P, S.lane1.dir);
      { const P = S.lane1.P, d = S.lane1.dir;
        const A = P.clone().addScaledVector(d, 8);
        const side = new THREE.Vector3(-d.z, 0, d.x);
        botAt(game, bots[0], A, d.clone().negate());
        botAt(game, bots[1], A.clone().addScaledVector(side, 1.7).addScaledVector(d, 0.5), d.clone().negate());
        botAt(game, bots[2], A.clone().addScaledVector(side, 2.9).addScaledVector(d, 1.0), d.clone().negate());
        c.botNames = bots.map(b => b.name);
        c.botPos = bots.map(b => [b.position.x, b.position.y, b.position.z].map(v => +v.toFixed(2)));
        S.arcStart = bots.map(b => b.health); }
      w.giveWeapon('arc');
      w.giveWeapon('gale');
      w._requestSwitch('arc');
      stepPhase('arc_wait', t);
      break;
    case 'arc_wait':
      if (el > 1.2) { inp.setVirtual('fire', true); stepPhase('arc_fire', t); S.beamMax = 0; S.arcAmmo0 = w.inv.arc.ammo; }
      break;
    case 'arc_fire':
      S.beamMax = Math.max(S.beamMax, game.effects.beams ? game.effects.beams.count : 0);
      if (el > 2.0) {
        inp.setVirtual('fire', false);
        c.arc = { ammoUsed: S.arcAmmo0 - w.inv.arc.ammo, beamInstancesMax: S.beamMax, beamOn: w._beamOn };
        const names = c.botNames;
        c.arc.dps = {};
        for (const k of names) {
          const dur = (S.last[k] ?? 0) - (S.first[k] ?? 0) + 1 / 24;
          c.arc.dps[k] = +((S.dmg.arc[k] || 0) / Math.max(0.05, dur)).toFixed(1);
        }
        c.arc.botPosAfter = bots.map(b => [b.position.x, b.position.y, b.position.z].map(v => +v.toFixed(2)));
        c.arc.total = +Object.values(S.dmg.arc).reduce((a, b) => a + b, 0).toFixed(1);
        c.arc.dmg = Object.fromEntries(Object.entries(S.dmg.arc).map(([k, v]) => [k, +v.toFixed(1)]));
        stepPhase('arc_cool', t);
      }
      break;
    case 'arc_cool':
      if (el > 0.5) {
        c.arc.beamAfter = w._beamOn;
        // ---- Gale shove distance on the open lane (only bot 0 stays in front; the others are moved far away)
        w._requestSwitch('gale');
        const P = S.lane1.P, d = S.lane1.dir;
        place(game, P, d);
        botAt(game, bots[0], P.clone().addScaledVector(d, 4), d.clone().negate());
        botAt(game, bots[1], P.clone().addScaledVector(d, -6), d);
        botAt(game, bots[2], P.clone().addScaledVector(d, -8), d);
        S.shoveStart = bots[0].position.clone();
        S.shovePeak = 0;
        S.splatBefore = S.events.splat.length;
        stepPhase('gale_wait1', t);
      }
      break;
    case 'gale_wait1':
      if (el > 1.0) {
        inp.setVirtual('fire', true);
        S.galeAmmo0 = w.inv.gale.ammo;
        S.hp0 = bots[0].health;
        stepPhase('gale_shove', t);
      }
      break;
    case 'gale_shove': {
      if (el > 0.1) inp.setVirtual('fire', false);
      S.shovePeak = Math.max(S.shovePeak, Math.hypot(bots[0].velocity.x, bots[0].velocity.z));
      if (el > 2.6) {
        const b = bots[0];
        const dd = b.position.clone().sub(S.shoveStart);
        c.gale = {
          ammoUsed: S.galeAmmo0 - w.inv.gale.ammo, shoveDist: +Math.hypot(dd.x, dd.z).toFixed(2), peakSpeed: +S.shovePeak.toFixed(1),
          damage: +(S.hp0 - b.health).toFixed(1), splatEventsOpenLane: S.events.splat.length - S.splatBefore, shoveEvents: S.events.shove,
        };
        stepPhase('self_wait', t);
      }
      break;
    }
    case 'self_wait':
      if (el > 0.4) {
        // ---- self push: aim straight down on the floor (Gale needs ammo: refill)
        p.pitch = -1.5;
        w.inv.gale.ammo = 5; w.ammo = 5;
        p.velocity.set(0, 0, 0);
        S.selfVy = 0; S.selfY0 = p.position.y; S.selfMaxY = p.position.y;
        w.nextFireAt = 0;
        inp.setVirtual('fire', true);
        stepPhase('self_fire', t);
      }
      break;
    case 'self_fire':
      if (el > 0.1) inp.setVirtual('fire', false);
      S.selfVy = Math.max(S.selfVy, p.velocity.y);
      S.selfMaxY = Math.max(S.selfMaxY, p.position.y);
      if (el > 1.4) {
        c.selfPush = { peakVy: +S.selfVy.toFixed(2), rise: +(S.selfMaxY - S.selfY0).toFixed(2) };
        // ---- reflect: a rocket and a grenade from bot 1 fly at the player
        p.pitch = 0;
        place(game, S.lane1.P, S.lane1.dir);
        w.nextFireAt = 0;
        w.inv.gale.ammo = 5; w.ammo = 5;
        const d = S.lane1.dir;
        const org = S.lane1.P.clone().addScaledVector(d, 7).setY(S.lane1.P.y + 1.5);
        S.rocket = game.projectiles.spawnRocket({ owner: bots[1], origin: org, direction: d.clone().negate() });
        S.gren = game.projectiles.spawnGrenade({ owner: bots[2], origin: org.clone().addScaledVector(d, -0.4), velocity: d.clone().multiplyScalar(-8), fuse: 3 });
        S.reflBefore = S.events.reflect;
        inp.setVirtual('fire', true);
        stepPhase('reflect', t);
      }
      break;
    case 'reflect':
      if (el > 0.05) inp.setVirtual('fire', false);
      if (el > 0.12 && !S.reflChecked) {
        S.reflChecked = true;
        const r = S.rocket, g = S.gren, d = S.lane1.dir;
        c.reflect = {
          events: S.events.reflect - S.reflBefore,
          rocketOwnerIsPlayer: r.owner === p, rocketDirDotAim: +r.direction.dot(d).toFixed(3), rocketSpeed: +r.speed.toFixed(1),
          grenadeOwnerIsPlayer: g.owner === p, grenadeVel: g.velocity.toArray().map(v => +v.toFixed(1)), grenadeSpeedAlongAim: +g.velocity.dot(d).toFixed(1),
        };
      }
      if (el > 1.2) {
        // ---- splat lane
        if (!S.lane2) { c.splat = { note: 'no lane2' }; stepPhase('prot', t); break; }
        const P = S.lane2.P, d = S.lane2.dir;
        place(game, P, d);
        w.nextFireAt = 0;
        w.inv.gale.ammo = 5; w.ammo = 5;
        botAt(game, bots[0], P.clone().addScaledVector(d, 3), d.clone().negate());
        botAt(game, bots[1], P.clone().addScaledVector(d, -6), d);
        botAt(game, bots[2], P.clone().addScaledVector(d, -8), d);
        S.splatBefore = S.events.splat.length;
        S.splatHp0 = bots[0].health;
        S.splatStart = bots[0].position.clone();
        S.splatFired = false;
        stepPhase('splat_wait', t);
      }
      break;
    case 'splat_wait':
      if (el > 0.7) { inp.setVirtual('fire', true); stepPhase('splat', t); }
      break;
    case 'splat':
      if (el > 0.1) inp.setVirtual('fire', false);
      if (el > 2.6) {
        const b = bots[0];
        c.splat = {
          wall: +S.lane2.wall.toFixed(1), events: S.events.splat.slice(S.splatBefore), totalHpLost: +(S.splatHp0 - b.health).toFixed(1),
          allSplatEvents: S.events.splat, splatDamage: +S.dmg.splat.toFixed(1), travelled: +Math.hypot(b.position.x - S.splatStart.x, b.position.z - S.splatStart.z).toFixed(2),
        };
        stepPhase('prot', t);
      }
      break;
    case 'prot':
      if (el > 0.2) {
        // ---- spawn-protected entities ignore knockback from others
        const P = S.lane1.P, d = S.lane1.dir;
        place(game, P, d);
        p.pitch = 0;
        w.nextFireAt = 0;
        w.inv.gale.ammo = 5; w.ammo = 5;
        botAt(game, bots[0], P.clone().addScaledVector(d, 4), d.clone().negate());
        bots[0].spawnProtectedUntil = game.time + 5;
        S.protStart = bots[0].position.clone();
        inp.setVirtual('fire', true);
        stepPhase('prot_fire', t);
      }
      break;
    case 'prot_fire':
      if (el > 0.1) inp.setVirtual('fire', false);
      if (el > 1.5) {
        const b = bots[0];
        c.protectedKnockback = { moved: +Math.hypot(b.position.x - S.protStart.x, b.position.z - S.protStart.z).toFixed(2), health: b.health };
        // ---- bots with the arc
        for (const b2 of bots) unneutral(b2);
        p.god = false; p.maxHealth = 1e6; p.health = 1e6;
        place(game, S.lane1.P, S.lane1.dir);
        w._requestSwitch('pistol');
        const P = S.lane1.P, d = S.lane1.dir, side = new THREE.Vector3(-d.z, 0, d.x);
        bots.forEach((b2, i) => {
          botAt(game, b2, P.clone().addScaledVector(d, 9).addScaledVector(side, (i - 1) * 2), d.clone().negate());
          b2.maxHealth = 1e6; b2.health = 1e6;
          b2.inv = {}; b2.owned = [];
          b2._addWeaponInternal('pistol'); b2._addWeaponInternal('arc');
          b2.weaponId = 'pistol';
          b2.selectWeapon('arc');
          b2.equipUntil = 0;
        });
        S.botArc0 = S.dmg.botArc;
        stepPhase('bot_arc', t);
      }
      break;
    case 'bot_arc':
      // keep the test player alive and in place
      p.health = 1e6;
      if (el > 6) {
        c.botArc = { damageToPlayer: +(S.dmg.botArc - S.botArc0).toFixed(1), ticksHeard: S.dmg.botArcTicks, botWeapons: bots.map(b => b.weaponId),
          shots: bots.map(b => b.stats.shots) };
        // ---- bots with the gale (close range)
        const P = S.lane1.P, d = S.lane1.dir, side = new THREE.Vector3(-d.z, 0, d.x);
        place(game, P, d);
        bots.forEach((b2, i) => {
          botAt(game, b2, P.clone().addScaledVector(d, 6).addScaledVector(side, (i - 1) * 2.2), d.clone().negate());
          b2.inv = {}; b2.owned = [];
          b2._addWeaponInternal('pistol'); b2._addWeaponInternal('gale');
          b2.weaponId = 'pistol';
          b2.selectWeapon('gale');
          b2.equipUntil = 0;
        });
        S.botGale0 = S.dmg.botGale; S.botGaleHits0 = S.dmg.botGaleHits; S.botShots0 = bots.map(b => b.stats.shots);
        stepPhase('bot_gale', t);
      }
      break;
    case 'bot_gale':
      p.health = 1e6;
      if (p.position.y < -10 || p.position.distanceTo(S.lane1.P) > 30) place(game, S.lane1.P, S.lane1.dir);
      if (el > 8) {
        c.botGale = { damageToPlayer: +(S.dmg.botGale - S.botGale0).toFixed(1), hits: S.dmg.botGaleHits - S.botGaleHits0,
          botWeapons: bots.map(b => b.weaponId), shots: bots.map((b, i) => b.stats.shots - S.botShots0[i]) };
        S.phase = 'done';
        game.autotest.finish();
      }
      break;
    default:
      break;
  }
}
