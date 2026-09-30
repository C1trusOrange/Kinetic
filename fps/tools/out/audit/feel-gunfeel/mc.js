// Monte-Carlo of real hitbox geometry (Combat.raycast) with real spread formulas from WeaponSystem/Entity.
import * as THREE from 'three';
import { Entity } from '/src/core/Entity.js';
import { WEAPONS } from '/src/weapons/WeaponDefs.js';
import { randomInCone } from '/src/core/utils.js';

const lerp = (a, b, t) => a + (b - a) * t;

export async function setup(game, report) {
  const out = report.custom = {};
  const dummy = new Entity(game);
  dummy.alive = true; dummy.id = 999; dummy.team = 999; dummy.name = 'dummy';
  game.entities.push(dummy);
  const realRay = game.world.raycast.bind(game.world);
  game.world.raycast = () => null;   // no walls: measure entity geometry only
  const eye = new THREE.Vector3(0, 1.66, 0);
  const aim = new THREE.Vector3();
  const dir = new THREE.Vector3();
  const N = 3000;

  function falloffMul(def, d) {
    const f = def.falloff;
    if (!f || d <= f.start) return 1;
    const k = Math.min(1, (d - f.start) / Math.max(1e-3, f.end - f.start));
    return 1 - (1 - f.min) * k;
  }

  // stance -> spread before bloom
  function baseSpread(def, stance) {
    const s = def.spread;
    if (stance === 'hip') return s.hip;
    if (stance === 'move') return s.moving;
    if (stance === 'ads') return s.ads;
    if (stance === 'adsmove') return s.ads + 1 * Math.max(0, s.moving - s.hip) * 0.3;
    if (stance === 'air') return s.air;
    return s.hip;
  }

  // one trigger pull at given angle -> {dmg, pelletHits, headHits}
  function pull(def, dist, angle, aimAt) {
    dummy.position.set(0, 0, -dist);
    dummy.height = 1.8;
    const target = aimAt === 'head' ? new THREE.Vector3(0, 1.8 - 0.22, -dist) : new THREE.Vector3(0, 1.8 * 0.62, -dist);
    aim.subVectors(target, eye).normalize();
    let dmg = 0, hits = 0, heads = 0, legs = 0;
    for (let i = 0; i < def.pellets; i++) {
      randomInCone(aim, angle, dir);
      const h = game.combat.raycast(eye, dir, def.range, null);
      if (h && h.entity === dummy) {
        let d = def.damage * falloffMul(def, h.distance);
        if (h.part === 'head') { d *= def.headshotMult; heads++; }
        else if (h.part === 'legs') { d *= 0.8; legs++; }
        dmg += d; hits++;
      }
    }
    return { dmg, hits, heads, legs };
  }

  // 1) per-pull expectations at fixed spread (no bloom)
  const table = {};
  const dists = [5, 10, 15, 20, 30, 50];
  for (const id of ['pistol', 'rifle', 'shotgun', 'sniper']) {
    const def = WEAPONS[id];
    table[id] = {};
    for (const stance of ['hip', 'move', 'ads', 'air']) {
      table[id][stance] = {};
      for (const d of dists) {
        const ang = Math.min(def.spread.max, baseSpread(def, stance));
        let sd = 0, sh = 0, shd = 0, pel = 0;
        for (let n = 0; n < N; n++) { const r = pull(def, d, ang, 'chest'); sd += r.dmg; sh += r.hits; shd += r.heads; pel += def.pellets; }
        table[id][stance][d] = { expDmg: +(sd / N).toFixed(1), hitPct: +(100 * sh / pel).toFixed(0), headPct: +(100 * shd / pel).toFixed(1), ang: +ang.toFixed(4) };
      }
    }
  }
  out.perPull = table;

  // 2) time-to-kill simulation for a stationary target, perfect recoil control, WeaponSystem bloom model.
  function simTTK(id, dist, stance, armor, aimAt, trials) {
    const def = WEAPONS[id];
    const times = [];
    let dead = 0;
    for (let t = 0; t < trials; t++) {
      let hp = 100, ar = armor, bloom = 0, now = 0, ammo = def.magSize, nextFire = 0, shots = 0, reloads = 0;
      const dt = 1 / 240;
      let ok = false;
      while (now < 12) {
        bloom = Math.max(0, bloom - def.spread.recovery * dt);
        if (now >= nextFire && ammo > 0) {
          const ang = Math.min(def.spread.max, baseSpread(def, stance) + bloom);
          const r = pull(def, dist, ang, aimAt);
          // apply as separate hits (armor applies per pellet damage)
          // approximate per-pellet application: apply total per pull in equal chunks
          const chunks = Math.max(1, r.hits);
          const per = r.dmg / chunks;
          for (let c = 0; c < chunks && hp > 0; c++) {
            const a = Math.min(ar, per * 0.6); ar -= a; hp -= Math.min(hp, per - a);
          }
          shots++; ammo--; bloom = Math.min(def.spread.max, bloom + def.spread.perShot);
          nextFire = now + 1 / def.fireRate;
          if (hp <= 0) { ok = true; break; }
          if (ammo === 0) { nextFire = now + def.reloadTime; ammo = def.magSize; reloads++; }
        }
        now += dt;
      }
      if (ok) { times.push(now); dead++; }
    }
    times.sort((a, b) => a - b);
    const med = times.length ? times[Math.floor(times.length / 2)] : null;
    const p90 = times.length ? times[Math.floor(times.length * 0.9)] : null;
    return { killPct: +(100 * dead / trials).toFixed(0), medTTK: med && +med.toFixed(2), p90TTK: p90 && +p90.toFixed(2) };
  }
  const ttk = {};
  for (const id of ['pistol', 'rifle', 'shotgun', 'sniper']) {
    ttk[id] = {};
    for (const stance of ['hip', 'ads']) {
      ttk[id][stance] = {};
      for (const d of [5, 10, 20, 35]) {
        ttk[id][stance][d] = { a0: simTTK(id, d, stance, 0, 'chest', 200), a50: simTTK(id, d, stance, 50, 'chest', 200) };
      }
    }
  }
  out.ttkChest = ttk;

  game.world.raycast = realRay;
  game.entities.splice(game.entities.indexOf(dummy), 1);
}

export function drive() {}
export function finish() {}
