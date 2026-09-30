// Audit scenario 1: Combat unit checks executed in setup() (deterministic, no timing).
import * as THREE from 'three';
import { Entity } from '/src/core/Entity.js';

const TX = -20, TZ = 5;
class Dummy extends Entity {
  constructor(game) { super(game); this.name = 'dummy'; }
}

function distToSeg(p, a, b) {
  const ab = new THREE.Vector3().subVectors(b, a);
  const t = Math.max(0, Math.min(1, new THREE.Vector3().subVectors(p, a).dot(ab) / ab.lengthSq()));
  return p.distanceTo(a.clone().addScaledVector(ab, t));
}

export async function setup(game, report) {
  const c = report.custom = {};
  const cb = game.combat;
  const T = new Dummy(game);
  game.addEntity(T);
  T.team = 900;
  T.spawn(new THREE.Vector3(TX, 0, TZ), 0);
  T.spawnProtectedUntil = 0;

  // ---------- A: vertical scan of hit parts
  const dir = new THREE.Vector3(0, 0, -1);
  const scan = [];
  for (let y = 0.0; y <= 1.9; y += 0.02) {
    const o = new THREE.Vector3(TX, y, TZ + 6);
    const h = cb.raycast(o, dir, 50, game.player);
    scan.push([+y.toFixed(2), h && h.entity === T ? h.part : (h ? 'WORLD' : null), h ? +h.distance.toFixed(3) : null]);
  }
  // compress
  const segs = [];
  for (const [y, part] of scan) {
    const last = segs[segs.length - 1];
    if (last && last.part === part) last.y1 = y; else segs.push({ part, y0: y, y1: y });
  }
  c.scanSegments = segs;

  // ---------- B: ray vs capsule accuracy against brute force marching
  const hb = T.getHitboxes();
  const rng = (() => { let s = 12345; return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296; })();
  let tested = 0, mismatchHit = 0, maxErr = 0, sumErr = 0, nHit = 0, missedByRay = 0, falseHit = 0;
  const worst = [];
  for (let i = 0; i < 4000; i++) {
    const o = new THREE.Vector3(TX + (rng() - 0.5) * 12, 0.2 + rng() * 5, TZ + (rng() - 0.5) * 12);
    const target = new THREE.Vector3(TX + (rng() - 0.5) * 1.6, rng() * 1.9, TZ + (rng() - 0.5) * 1.6);
    const d = target.clone().sub(o).normalize();
    // world blocks?  only test when clear of world
    const w = game.world.raycast(o, d, o.distanceTo(target) + 1);
    if (w) continue;
    // brute force: nearest t where point inside ANY hitbox
    let bt = -1;
    for (let t = 0; t < 30; t += 0.0025) {
      const p = o.clone().addScaledVector(d, t);
      let inside = false;
      for (const b of hb) {
        if (b.type === 'sphere') { if (p.distanceTo(b.center) <= b.radius) inside = true; }
        else if (distToSeg(p, b.start, b.end) <= b.radius) inside = true;
      }
      if (inside) { bt = t; break; }
    }
    const h = cb.raycast(o, d, 50, game.player);
    const ent = h && h.entity === T ? h : null;
    tested++;
    if ((bt >= 0) !== !!ent) {
      mismatchHit++;
      if (bt >= 0) missedByRay++; else falseHit++;
      if (worst.length < 5) worst.push({ o: o.toArray(), d: d.toArray(), bt, ray: ent ? ent.distance : null });
    } else if (ent) {
      const err = Math.abs(bt - ent.distance);
      nHit++;
      sumErr += err;
      if (err > maxErr) maxErr = err;
    }
  }
  c.rayCapsule = { tested, nHit, mismatchHit, missedByRay, falseHit, maxErrM: +maxErr.toFixed(4), meanErrM: +(sumErr / Math.max(1, nHit)).toFixed(4), worst };

  // ---------- C: damage math via fireBullet
  const dmgs = [];
  const evt = [];
  const off = game.events.on('damage', e => evt.push(e));
  function shoot(y, dist, opts = {}) {
    T.health = 100; T.armor = opts.armor ?? 0; T.alive = true; T.spawnProtectedUntil = 0;
    const o = new THREE.Vector3(TX, y, TZ + dist + 0.4);
    const before = T.health;
    const h = cb.fireBullet({
      shooter: game.player, origin: o, direction: dir, damage: 20, weapon: 'rifle', range: 200,
      headshotMult: 2, falloff: opts.falloff, tracerFrom: null,
    });
    return { part: h && h.part, dealt: before - T.health, armor: T.armor, hitDist: h && +h.distance.toFixed(3) };
  }
  game.player.god = true;
  c.bulletBody = shoot(1.1, 5);
  c.bulletLegs = shoot(0.4, 5);
  c.bulletHead = shoot(1.7, 5);
  c.falloffMid = shoot(1.1, 4, { falloff: { start: 2, end: 6, min: 0.5 } });
  c.falloffFar = shoot(1.1, 7, { falloff: { start: 2, end: 6, min: 0.5 } });
  c.armorHalf = shoot(1.1, 5, { armor: 100 });
  c.armorLow = shoot(1.1, 5, { armor: 5 });
  off();
  c.damageEvents = evt.length;

  // ---------- D: radialDamage checks
  const results = {};
  function explode(center, o = {}) {
    T.health = 100; T.armor = 0; T.alive = true; T.spawnProtectedUntil = 0; T.velocity.set(0, 0, 0);
    cb.radialDamage(center, { radius: 5, damage: 100, attacker: game.player, weapon: 'rocket', knockback: 15, selfScale: 0.35, ...o });
    return { hp: T.health, v: T.velocity.toArray().map(x => +x.toFixed(2)) };
  }
  results.adjacent = explode(new THREE.Vector3(TX, 0.9, TZ + 1.5)); // 1.5 m away, same height
  results.atEdge = explode(new THREE.Vector3(TX, 0.9, TZ + 4.9));
  results.outside = explode(new THREE.Vector3(TX, 0.9, TZ + 5.6));
  results.under = explode(new THREE.Vector3(TX, 0.05, TZ)); // below feet, directly under
  results.centerInside = explode(new THREE.Vector3(TX, 0.9, TZ)); // at the entity chest
  results.above = explode(new THREE.Vector3(TX, 2.6, TZ)); // above head
  c.radial = results;

  // dead attacker / friendly / god
  T.team = 1; // pretend friendly to a hypothetical attacker on team 1
  const friend = new Dummy(game); game.addEntity(friend); friend.team = 1; friend.spawn(new THREE.Vector3(TX + 8, 0, TZ + 3), 0); friend.spawnProtectedUntil = 0;
  T.health = 100;
  cb.radialDamage(new THREE.Vector3(TX, 0.9, TZ + 1.5), { radius: 5, damage: 100, attacker: friend, weapon: 'rocket', knockback: 15 });
  c.friendlyRadial = { hp: T.health, v: T.velocity.toArray().map(x => +x.toFixed(2)) };
  T.team = 900;
  game.removeEntity(friend);
  game.player.god = false;
}

export function drive(t, dt, game, report) {}
