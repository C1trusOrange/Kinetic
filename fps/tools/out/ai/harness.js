// Headless AI harness: real Combat / Collision / MapBuilder / NavGraph / BotManager with light mocks for the rest.
// Runs the simulation faster than real time (no rendering). Results end up in window.__H__ (and #out).
//   ?test=ffa&bots=6&dur=60&diff=normal&mode=ffa&seed=1
//   ?test=aim&weapon=rifle&dist=25&move=1&diff=normal&dur=30
//   ?test=nav&bots=4&dur=90
//   add &mockweapons=1&mockbot=1 to isolate from parallel work on WeaponModels / BotModel
import * as THREE from 'three';
import { Events } from '/src/core/Events.js';
import { Combat } from '/src/core/Combat.js';
import { Entity } from '/src/core/Entity.js';
import { CollisionWorld } from '/src/world/Collision.js';
import { MapBuilder } from '/src/world/MapBuilder.js';
import { NavGraph } from '/src/world/NavGraph.js';
import { BotManager } from '/src/ai/BotManager.js';
import { RESPAWN_DELAY } from '/src/core/constants.js';
import { mulberry32 } from '/src/core/utils.js';
import { WEAPONS, GRENADE } from '/src/weapons/WeaponDefs.js';

const Q = new URLSearchParams(location.search);
const num = (k, d) => (Q.has(k) ? parseFloat(Q.get(k)) : d);
const errors = [];
window.addEventListener('error', e => errors.push(String(e.message)));
const origError = console.error;
console.error = (...a) => { errors.push(a.map(String).join(' ').slice(0, 400)); origError(...a); };

if (Q.has('seed')) {
  const r = mulberry32(parseInt(Q.get('seed'), 10) || 1);
  Math.random = r;
}

// ---------------------------------------------------------------- mocks

class MockEffects {
  constructor() { this.c = { tracer: 0, impact: 0, hitSpark: 0, muzzleFlash: 0, gibs: 0, explosion: 0 }; }
  impact() { this.c.impact++; }
  hitSpark(p, n, e) { this.c.hitSpark++; if (e && e.model && e.model.flashHit) e.model.flashHit(); }
  tracer() { this.c.tracer++; }
  muzzleFlash() { this.c.muzzleFlash++; }
  flashLight() {}
  explosion() { this.c.explosion++; }
  trail() {}
  gibs() { this.c.gibs++; }
  dust() {}
  clear() {}
}

class MockAudio {
  constructor() { this.plays = {}; }
  play(name) { this.plays[name] = (this.plays[name] || 0) + 1; }
  playLoop() { return { setVolume() {}, setRate() {}, setPosition() {}, stop() {} }; }
}

class MockProjectiles {
  constructor(game) { this.game = game; this.grenades = []; this.rockets = []; this.explosions = 0; this.rocketsFired = 0; this.grenadesThrown = 0; }
  spawnGrenade({ owner, origin, velocity, fuse }) {
    this.grenadesThrown++;
    this.grenades.push({ position: origin.clone(), velocity: velocity.clone(), fuse, owner });
  }
  spawnRocket({ owner, origin, direction, speed = 42, damage = 105, splashDamage = 95, radius = 4.8 }) {
    this.rocketsFired++;
    this.rockets.push({ position: origin.clone(), dir: direction.clone(), speed, damage, splashDamage, radius, owner, life: 6 });
  }
  explode(pos, { owner, weapon, radius, damage, knockback }) {
    this.explosions++;
    this.game.combat.radialDamage(pos, { radius, damage, attacker: owner, weapon, knockback, selfScale: weapon === 'rocket' ? 0.35 : GRENADE.selfScale });
    this.game.effects.explosion(pos, { radius });
    this.game.events.emit('explosion', { position: pos.clone(), radius, owner, weapon });
  }
  update(dt) {
    const g = this.game;
    for (let i = this.grenades.length - 1; i >= 0; i--) {
      const gr = this.grenades[i];
      gr.fuse -= dt;
      gr.velocity.y -= 24 * dt;
      const step = gr.velocity.clone().multiplyScalar(dt);
      const len = step.length();
      if (len > 1e-5) {
        const dir = step.clone().multiplyScalar(1 / len);
        const hit = g.world.collision.raycast(gr.position, dir, len + 0.05);
        if (hit) {
          gr.position.copy(hit.point).addScaledVector(hit.normal, 0.06);
          const vn = gr.velocity.dot(hit.normal);
          gr.velocity.addScaledVector(hit.normal, -(1 + 0.45) * vn).multiplyScalar(0.8);
        } else gr.position.add(step);
      }
      if (gr.fuse <= 0) {
        this.grenades.splice(i, 1);
        this.explode(gr.position, { owner: gr.owner, weapon: 'grenade', radius: GRENADE.radius, damage: GRENADE.damage, knockback: GRENADE.knockback });
      }
    }
    for (let i = this.rockets.length - 1; i >= 0; i--) {
      const r = this.rockets[i];
      r.life -= dt;
      const len = r.speed * dt;
      const hit = g.combat.raycast(r.position, r.dir, len, r.owner);
      if (hit || r.life <= 0) {
        this.rockets.splice(i, 1);
        const p = hit ? hit.point.clone().addScaledVector(hit.normal, 0.15) : r.position.clone();
        if (hit && hit.entity) g.combat.applyDamage(hit.entity, { amount: r.damage, attacker: r.owner, weapon: 'rocket', point: hit.point, direction: r.dir });
        this.explode(p, { owner: r.owner, weapon: 'rocket', radius: r.radius, damage: r.splashDamage, knockback: 15 });
      } else r.position.addScaledVector(r.dir, len);
    }
  }
  clear() { this.grenades.length = 0; this.rockets.length = 0; }
}

class MockPickups {
  constructor(game, defs) {
    this.game = game;
    this.list = (defs || []).map((p, i) => ({
      id: i, type: p.type, weapon: p.weapon || null, amount: p.amount || 0,
      position: new THREE.Vector3(...p.pos), available: true, respawnTime: p.type === 'weapon' ? 25 : p.type === 'armor' ? 25 : 20, nextRespawn: 0,
    }));
    this.collected = {};
  }
  nearest(type, position, { weapon, availableOnly = true } = {}) {
    let best = null, bd = Infinity;
    for (const p of this.list) {
      if (p.type !== type || (weapon && p.weapon !== weapon) || (availableOnly && !p.available)) continue;
      const d = p.position.distanceToSquared(position);
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  }
  update() {
    const g = this.game;
    for (const p of this.list) {
      if (!p.available) { if (g.time >= p.nextRespawn) p.available = true; continue; }
      for (const e of g.entities) {
        if (!e.alive) continue;
        const dx = e.position.x - p.position.x, dz = e.position.z - p.position.z, dy = e.position.y - p.position.y;
        if (dx * dx + dz * dz > 1.3 * 1.3 || Math.abs(dy) > 1.6) continue;
        let used = false;
        switch (p.type) {
          case 'health': used = e.heal(p.amount || 50); break;
          case 'armor': used = e.addArmor(p.amount || 50); break;
          case 'ammo': used = e.addAmmo(null, 0.5); break;
          case 'grenades': used = e.addGrenades(p.amount || 2); break;
          case 'weapon': used = e.giveWeapon(p.weapon); break;
          default: break;
        }
        if (used) {
          p.available = false;
          p.nextRespawn = g.time + p.respawnTime;
          this.collected[p.type] = (this.collected[p.type] || 0) + 1;
          g.events.emit('pickup', { entity: e, pickup: p });
          break;
        }
      }
    }
  }
}

/** A player stand-in used as a scripted target. */
class Dummy extends Entity {
  constructor(game) {
    super(game);
    this.isPlayer = true;
    this.name = 'Dummy';
    this.maxHealth = 100;
  }
  spawn(pos, yaw) { super.spawn(pos, yaw); }
}

class HGame {
  constructor(def, opts = {}) {
    this.def = def;
    this.time = 0;
    this.events = new Events();
    this.entities = [];
    this._nid = 1;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera();
    this.camera.position.set(0, 10, 0);
    this.spectate = true;
    this.effects = new MockEffects();
    this.audio = new MockAudio();
    this.combat = new Combat(this);
    this.projectiles = new MockProjectiles(this);
    this.match = { mode: opts.mode || 'ffa', over: false, teamScores: { 1: 0, 2: 0 } };
    this.deaths = {};
    this.killLog = [];
    this.player = new Dummy(this);

    const collision = new CollisionWorld();
    const warnings = [];
    const builder = new MapBuilder(def, collision, m => warnings.push(m));
    this.builder = builder;
    builder.buildGeometry();
    collision.build();
    const bounds = new THREE.Box3(new THREE.Vector3(...def.bounds.min), new THREE.Vector3(...def.bounds.max));
    const pads = (def.jumpPads || []).map(jp => {
      const position = new THREE.Vector3(...jp.pos);
      const velocity = new THREE.Vector3();
      let target = null;
      if (jp.target) {
        target = new THREE.Vector3(...jp.target);
        const g = 24, apex = jp.apex ?? 3;
        const top = Math.max(position.y, target.y) + Math.max(0.2, apex);
        const vy = Math.sqrt(2 * g * (top - position.y));
        const T = vy / g + Math.sqrt(2 * Math.max(0.01, top - target.y) / g);
        velocity.set((target.x - position.x) / T, vy, (target.z - position.z) / T);
      } else if (jp.velocity) velocity.set(...jp.velocity);
      return { position, radius: 1.1, velocity, target };
    });
    const t0 = performance.now();
    const nav = NavGraph.build(builder.getNavTriangles(), bounds, { mapId: def.id, def, jumpPads: pads, flags: builder.getNavFlags ? builder.getNavFlags() : undefined });
    this.navMs = performance.now() - t0;
    this.warnings = warnings;
    this.world = {
      collision, nav, bounds, killY: def.killY, def, jumpPads: pads,
      spawnPoints: def.spawns.map(s => ({ position: new THREE.Vector3(...s.pos), yaw: s.yaw || 0 })),
      pickups: new MockPickups(this, def.pickups),
      raycast: (o, d, m) => collision.raycast(o, d, m),
    };
    if (Q.has('nonav')) {
      // stub nav like the placeholder World: no nodes, no paths
      this.world.nav = { nodes: [], stats: {}, nearestNode: () => null, findPath: () => null, randomNode: () => null, randomPointNear: () => null, isConnected: () => false, debugObject: () => new THREE.Group() };
    }
    this.bots = new BotManager(this);
    this.bots.init();
    this.events.on('death', e => this._onDeath(e));
  }
  addEntity(e) { e.id = this._nid++; if (!this.entities.includes(e)) this.entities.push(e); return e; }
  removeEntity(e) { const i = this.entities.indexOf(e); if (i >= 0) this.entities.splice(i, 1); }
  getEnemiesOf(e) { return this.entities.filter(o => o !== e && o.alive && o.team !== e.team); }
  respawnEntity(e) {
    const sp = this.pickSpawnPoint(e);
    e.spawn(sp.position.clone(), sp.yaw);
    this.events.emit('spawn', { entity: e });
  }
  pickSpawnPoint(entity) {
    const spawns = this.world.spawnPoints;
    let best = spawns[0], bestScore = -Infinity;
    const v1 = new THREE.Vector3(), v2 = new THREE.Vector3();
    for (const sp of spawns) {
      let minEnemy = 70, visible = 0, occupied = false;
      v2.copy(sp.position); v2.y += 1.6;
      for (const o of this.entities) {
        if (o === entity || !o.alive) continue;
        const d = o.position.distanceTo(sp.position);
        if (d < 1.6) occupied = true;
        if (o.team === entity.team) continue;
        if (d < minEnemy) minEnemy = d;
        if (d < 50 && this.combat.canSee(o.getEyePosition(v1), v2)) visible++;
      }
      const score = minEnemy - visible * 30 - (occupied ? 1000 : 0) + Math.random() * 14 - (sp === entity._lastSpawn ? 20 : 0);
      if (score > bestScore) { bestScore = score; best = sp; }
    }
    entity._lastSpawn = best;
    return best;
  }
  _onDeath({ victim, attacker, weapon }) {
    victim.deaths++;
    victim.streak = 0;
    this.deaths[weapon] = (this.deaths[weapon] || 0) + 1;
    if (attacker && attacker !== victim) {
      attacker.kills++;
      attacker.streak++;
      if (this.match.mode === 'tdm' && attacker.team !== victim.team) this.match.teamScores[attacker.team]++;
    } else victim.kills = Math.max(0, victim.kills - 1);
    this.killLog.push({ t: +this.time.toFixed(1), victim: victim.name, attacker: attacker ? attacker.name : null, weapon });
    victim.respawnAt = this.time + (victim.isPlayer ? RESPAWN_DELAY.player : RESPAWN_DELAY.bot);
  }
  updatePads() {
    this.padLaunches = this.padLaunches || 0;
    for (const pad of this.world.jumpPads) {
      for (const e of this.entities) {
        if (!e.alive) continue;
        const dx = e.position.x - pad.position.x, dz = e.position.z - pad.position.z;
        if (dx * dx + dz * dz > pad.radius * pad.radius || Math.abs(e.position.y - pad.position.y) > 0.7) continue;
        if (this.time - e.lastLaunchTime < 0.5) continue;
        e.launch(pad.velocity.clone());
        this.padLaunches++;
      }
    }
  }
  step(dt) {
    this.time += dt;
    if (this.script) this.script(this, dt);
    this.bots.update(dt);
    this.projectiles.update(dt);
    this.world.pickups.update(dt);
    this.updatePads();
    for (const e of this.entities) {
      if (e.alive) {
        if (e.position.y < this.world.killY) this.combat.kill(e, { attacker: null, weapon: 'fall' });
      } else if (e.respawnAt >= 0 && this.time >= e.respawnAt && !this.noRespawn) this.respawnEntity(e);
    }
  }
}

// ---------------------------------------------------------------- helpers

async function loadDef() {
  const path = Q.get('map') || '/tools/out/ai/testmap.js';
  return (await import(path)).default;
}

function botStats(game) {
  return game.bots.list.map(b => ({
    name: b.name, team: b.team, kills: b.kills, deaths: b.deaths, hp: Math.round(b.health), weapon: b.weaponId,
    shots: b.stats.shots, pellets: b.stats.pelletHits, dmg: Math.round(b.stats.damage), gren: b.stats.grenades,
    pos: b.position.toArray().map(v => +v.toFixed(1)),
  }));
}

function tableRows(game, inst) {
  const st = botStats(game), dg = inst.summary();
  return st.map((b, i) => {
    const d = dg[i];
    return `${b.name.padEnd(8)} k${b.kills}/d${b.deaths} hp${String(b.hp).padStart(3)} ${b.weapon.padEnd(7)} shots${String(b.shots).padStart(4)} hit${String(b.pellets).padStart(3)} dmg${String(b.dmg).padStart(4)} g${b.gren} | dist${String(d.dist).padStart(4)} idle${d.idle} stuck${d.stuck} air${d.air}% v${d.maxSpeed} minY${d.minY} ${JSON.stringify(d.states)}`;
  });
}

/** Wrap per-bot diagnostics: state histogram, distance, idle time, stuck recoveries. */
function instrument(game) {
  const rec = new Map();
  for (const b of game.bots.list) {
    const r = { states: {}, dist: 0, last: null, idle: 0, stuck: 0, aliveT: 0, airT: 0, maxSpeed: 0, jumps: 0, minY: 1e9,
      yawPrev: null, yawVelPrev: 0, flips: 0, flipT: 0, jerkSum: 0, jerkN: 0, bodyPrev: null, bodyVelPrev: 0, bodyFlips: 0, bodyT: 0, pitchPrev: null, pitchVelPrev: 0, pFlips: 0, overlapT: 0, overlapMin: 9 };
    rec.set(b, r);
    const orig = b.brain.recoverStuck.bind(b.brain);
    b.brain.recoverStuck = t => {
      r.stuck++;
      if (r.stuck <= 6) {
        const n = b.brain.nav;
        (window.__stuck = window.__stuck || []).push({ b: b.name, t: +t.toFixed(1), pos: b.position.toArray().map(v => +v.toFixed(1)), goal: n.goal.toArray().map(v => +v.toFixed(1)), mode: n.mode, idx: n.index, wp: n.path && n.path[n.index] ? n.path[n.index].toArray().map(v => +v.toFixed(1)) : null, wpType: n.path && n.path[n.index] ? n.path[n.index].type : null, path: n.path ? n.path.slice(0, 8).map(w => w.toArray().map(v => +v.toFixed(1)).join(',') + (w.type ? ':' + w.type : '')).join(' ') : null, state: b.brain.state, vel: [+b.velocity.x.toFixed(1), +b.velocity.z.toFixed(1)], onGround: b.onGround });
      }
      return orig(t);
    };
  }
  return {
    rec,
    sample(dt) {
      for (const [b, r] of rec) {
        // ring buffer of the last 2 s for fall diagnostics
        if (b.alive) {
          (r.ring = r.ring || []).push([+game.time.toFixed(2), +b.position.x.toFixed(1), +b.position.y.toFixed(1), +b.position.z.toFixed(1), b.onGround ? 1 : 0, +b.speed.toFixed(1), b.brain.state, +(game.time - b.lastDamageTime).toFixed(1), b.brain.intent.jump ? 1 : 0, b.brain.nav.mode, +b.velocity.y.toFixed(1)]);
          if (r.ring.length > 120) r.ring.shift();
          if (b.position.y < -3 && !r.fallLogged) {
            r.fallLogged = true;
            (window.__falls = window.__falls || []).push({ b: b.name, ring: r.ring.filter((_, i) => i % 6 === 0).map(a => a.join(' ')) });
          }
        } else r.fallLogged = false;

        if (!b.alive) { r.last = null; continue; }
        r.aliveT += dt;
        // smoothness: yaw velocity sign flips (only counting meaningful speeds), angular jerk, body-yaw flicker
        const wrap = a => { a = (a + Math.PI) % (2 * Math.PI); if (a < 0) a += 2 * Math.PI; return a - Math.PI; };
        if (r.yawPrev !== null) {
          const yv = wrap(b.yaw - r.yawPrev) / dt;
          if (Math.abs(yv) > 0.4 && Math.abs(r.yawVelPrev) > 0.4 && yv * r.yawVelPrev < 0) r.flips++;
          r.jerkSum += Math.abs(yv - r.yawVelPrev) / dt; r.jerkN++;
          r.yawVelPrev = yv;
          const bv = wrap(b.bodyYaw - r.bodyPrev) / dt;
          if (Math.abs(bv) > 0.4 && Math.abs(r.bodyVelPrev) > 0.4 && bv * r.bodyVelPrev < 0) r.bodyFlips++;
          r.bodyVelPrev = bv;
          const pv = (b.pitch - r.pitchPrev) / dt;
          if (Math.abs(pv) > 0.4 && Math.abs(r.pitchVelPrev) > 0.4 && pv * r.pitchVelPrev < 0) r.pFlips++;
          r.pitchVelPrev = pv;
        }
        r.yawPrev = b.yaw; r.bodyPrev = b.bodyYaw; r.pitchPrev = b.pitch;
        for (const [o] of rec) {
          if (o === b || !o.alive) continue;
          const dx = o.position.x - b.position.x, dz = o.position.z - b.position.z;
          const d = Math.hypot(dx, dz);
          if (d < 0.6 && Math.abs(o.position.y - b.position.y) < 1.2) r.overlapT += dt / 2;
          if (Math.abs(o.position.y - b.position.y) < 1.2 && d < r.overlapMin) r.overlapMin = d;
        }
        const s = b.brain.state;
        r.states[s] = (r.states[s] || 0) + dt;
        if (r.last) r.dist += Math.hypot(b.position.x - r.last.x, b.position.z - r.last.z);
        r.last = b.position.clone();
        if (b.brain.intent.speed > 1 && b.speed < 0.3) r.idle += dt;
        if (!b.onGround) r.airT += dt;
        r.maxSpeed = Math.max(r.maxSpeed, b.speed);
        r.minY = Math.min(r.minY, b.position.y);
        if (!b.position.x === b.position.x) errors.push('NaN position');
      }
    },
    summary() {
      const out = [];
      for (const [b, r] of rec) {
        const st = {};
        for (const k in r.states) st[k] = +(r.states[k] / Math.max(0.01, r.aliveT) * 100).toFixed(0);
        out.push({ flipsPerMin: +(r.flips / Math.max(1, r.aliveT) * 60).toFixed(1), bodyFlipsPerMin: +(r.bodyFlips / Math.max(1, r.aliveT) * 60).toFixed(1), pitchFlipsPerMin: +(r.pFlips / Math.max(1, r.aliveT) * 60).toFixed(1), jerk: +(r.jerkSum / Math.max(1, r.jerkN)).toFixed(0), overlapS: +r.overlapT.toFixed(1), overlapMin: +r.overlapMin.toFixed(2), stuckLog: r.stuckLog, name: b.name, alive: +r.aliveT.toFixed(0), dist: +r.dist.toFixed(0), idle: +r.idle.toFixed(1), stuck: r.stuck, air: +(r.airT / Math.max(0.01, r.aliveT) * 100).toFixed(0), maxSpeed: +r.maxSpeed.toFixed(1), minY: +r.minY.toFixed(1), states: st });
      }
      return out;
    },
  };
}

async function runSteps(game, seconds, dt, inst, onStep) {
  const n = Math.round(seconds / dt);
  const t0 = performance.now();
  let maxStep = 0;
  for (let i = 0; i < n; i++) {
    const s0 = performance.now();
    game.step(dt);
    if (inst) inst.sample(dt);
    if (onStep) onStep(game, i * dt);
    maxStep = Math.max(maxStep, performance.now() - s0);
    if ((i & 255) === 255) await new Promise(r => setTimeout(r, 0));
  }
  return { wallMs: +(performance.now() - t0).toFixed(0), avgStepMs: +((performance.now() - t0) / n).toFixed(3), maxStepMs: +maxStep.toFixed(2) };
}

/** Optional rendering (?render=1): real-time loop with chase / overview camera for screenshots. */
async function setupRender(game) {
  const { initTextures, preloadMaterials } = await import('/src/world/Textures.js');
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.shadowMap.enabled = true;
  document.body.appendChild(renderer.domElement);
  document.getElementById('out').style.display = 'none';
  initTextures(renderer);
  await preloadMaterials(game.builder.materialNames);
  const mapGroup = game.builder.createMeshes();
  mapGroup.traverse(o => { if (o.isMesh) { o.receiveShadow = true; } });
  game.scene.add(mapGroup);
  const sun = new THREE.DirectionalLight(0xfff0d8, 2.6);
  sun.position.set(-20, 40, 14);
  sun.castShadow = true;
  Object.assign(sun.shadow.camera, { left: -50, right: 50, top: 50, bottom: -50, far: 150 });
  sun.shadow.mapSize.set(2048, 2048);
  game.scene.add(sun, new THREE.HemisphereLight(0xbcd4ff, 0x4a4034, 1.0));
  game.scene.background = new THREE.Color(0x8fb0d8);
  game.scene.traverse(o => { if (o.isMesh && !o.material.map && o.parent !== mapGroup) o.castShadow = true; });
  const cam = game.camera;
  cam.fov = 70; cam.aspect = window.innerWidth / window.innerHeight; cam.near = 0.1; cam.far = 400; cam.updateProjectionMatrix();
  const camMode = Q.get('cam') || 'chase';
  const follow = num('follow', 0);
  const tmp = new THREE.Vector3(), fwd = new THREE.Vector3(), look = new THREE.Vector3();
  return {
    render(dt) {
      game.scene.traverse(o => { if (o.isMesh && o.castShadow === false && o.material && !o.material.map) o.castShadow = true; });
      if (camMode === 'over') {
        cam.position.set(0, 55, 60); cam.lookAt(0, 0, 0);
      } else {
        let t = game.bots.list[follow];
        if (!t || !t.alive) t = game.bots.list.find(b => b.alive);
        if (t) {
          fwd.set(-Math.sin(t.yaw), 0, -Math.cos(t.yaw));
          tmp.copy(t.position).addScaledVector(fwd, -3.6); tmp.y += 2.2;
          cam.position.lerp(tmp, 1 - Math.exp(-5 * dt));
          look.copy(t.position); look.y += 1.3; look.addScaledVector(fwd, 2.5);
          cam.lookAt(look);
        }
      }
      renderer.render(game.scene, cam);
    },
  };
}

function spawnAll(game) {
  for (const e of game.entities) { e.kills = 0; e.deaths = 0; game.respawnEntity(e); }
}

// ---------------------------------------------------------------- tests

const tests = {
  async ffa(def) {
    const mode = Q.get('mode') || 'ffa';
    const game = new HGame(def, { mode });
    game.match.mode = mode;
    game.bots.spawnBots(num('bots', 6), Q.get('diff') || 'normal', mode);
    const tPrep = performance.now();
    await game.bots.prepare(game.world);
    game.prepareMs = +(performance.now() - tPrep).toFixed(0);
    spawnAll(game);
    const inst = instrument(game);
    let perf;
    if (Q.has('render')) {
      const r = await setupRender(game);
      const dur = num('dur', 60);
      let last = performance.now();
      await new Promise(resolve => {
        const loop = () => {
          const now = performance.now();
          const dt = Math.min(0.05, (now - last) / 1000);
          last = now;
          game.step(dt);
          inst.sample(dt);
          r.render(dt);
          if (game.time < dur) requestAnimationFrame(loop); else resolve();
        };
        requestAnimationFrame(loop);
      });
      perf = { rendered: true };
    } else {
      perf = await runSteps(game, num('dur', 60), 1 / 60, inst);
    }
    return {
      prepareMs: game.prepareMs, perf, pathStats: game.bots.pathStats, navMs: +game.navMs.toFixed(0), navStats: game.world.nav.stats, warnings: game.warnings,
      spots: { cover: game.bots.spots.cover.length, snipe: game.bots.spots.snipe.length },
      teamScores: game.match.teamScores, deaths: game.deaths,
      effects: game.effects.c, audio: game.audio.plays, explosions: game.projectiles.explosions,
      rockets: game.projectiles.rocketsFired, grenades: game.projectiles.grenadesThrown, pickups: game.world.pickups.collected,
      diag: inst.summary(), table: tableRows(game, inst), killLog: game.killLog.slice(-8),
    };
  },

  /** Physics sanity: one bot, scripted walk on flat ground; logs ground state. */
  async phys(def) {
    const game = new HGame(def, { mode: 'ffa' });
    const bot = game.bots.spawnBots(1, 'normal', 'ffa')[0];
    game.noRespawn = true;
    game.respawnEntity = e => e.spawn(new THREE.Vector3(-20, 0, 34), 0);
    game.respawnEntity(bot);
    bot.god = true;
    bot.brain.thinkAt = 1e9;
    bot.brain.perceiveAt = 1e9;
    const log = [];
    let t = 0;
    game.script = (g, dt) => {
      t += dt;
      const it = bot.brain.intent;
      if (t > 1 && t < 4) { it.moveX = 1; it.moveZ = 0; it.speed = 6; }
      bot.brain.updateMovement = () => {};
      if (t > 4 && t < 4.05) it.jump = true;
      if (Math.abs(t * 60 % 12) < 1) log.push([+t.toFixed(2), +bot.position.x.toFixed(2), +bot.position.y.toFixed(3), bot.onGround, +bot.speed.toFixed(2)]);
    };
    await runSteps(game, 6, 1 / 60, null);
    return { log };
  },

  /** Line-of-sight regression: no seeing / shooting through walls; positive control through a doorway. */
  async los(def) {
    const out = [];
    const cases = [
      ['wall', [-25, 0, 9], [-25, 0, 2]],
      ['wall_close', [-25, 0, 6.2], [-25, 0, 3.6]],
      ['door', [-12.5, 0, 10], [-12.5, 0, 1]],
    ];
    for (const diff of ['normal', 'insane']) for (const [name, bp, dp] of cases) {
      const game = new HGame(def, { mode: 'ffa' });
      game.noRespawn = true;
      const bot = game.bots.spawnBots(1, diff, 'ffa')[0];
      await game.bots.prepare(game.world);
      game.addEntity(game.player);
      const dummy = game.player;
      game.respawnEntity = e => (e === bot ? e.spawn(new THREE.Vector3(...bp), 0) : e.spawn(new THREE.Vector3(...dp), 0));
      game.respawnEntity(bot);
      game.respawnEntity(dummy);
      dummy.maxHealth = 1e6; dummy.health = 1e6; dummy.spawnProtectedUntil = 0;
      bot.brain.updateMovement = () => {};
      let visibleT = 0, hitDmg = 0;
      game.events.on('damage', e => { if (e.attacker === bot && e.target === dummy) hitDmg += e.amount; });
      game.script = (g, dt) => {
        dummy.health = 1e6;
        dummy.velocity.set(0, 0, 0); // the dummy has no physics: drop knockback so leading stays sane
        const r = bot.brain.mem.get(dummy);
        if (r && r.visible) visibleT += dt;
      };
      await runSteps(game, 15, 1 / 60, null);
      out.push({ diff, name, weapon: bot.weaponId, visibleT: +visibleT.toFixed(2), shots: bot.stats.shots, dmg: Math.round(hitDmg), impacts: game.effects.c.impact });
    }
    return { out };
  },

  /** Print nav paths: ?from=x,y,z&to=x,y,z */
  async path(def) {
    const game = new HGame(def, { mode: 'ffa' });
    const f = new THREE.Vector3(...Q.get('from').split(',').map(Number));
    const t = new THREE.Vector3(...Q.get('to').split(',').map(Number));
    const nav = game.world.nav;
    const p = nav.findPath(f, t);
    const nn = nav.nearestNode(f, 6);
    return { start: nn ? nn.position ? nn.position.toArray() : nn : null, path: p ? p.map(w => w.toArray().map(v => +v.toFixed(1)).join(',') + ':' + (w.type || '') + (w.pad ? ':pad' : '')) : null };
  },

  /** Trace one bot following a path: ?from=x,y,z&to=x,y,z&dur=15 */
  async trace(def) {
    const game = new HGame(def, { mode: 'ffa' });
    const bot = game.bots.spawnBots(1, 'normal', 'ffa')[0];
    game.noRespawn = true;
    const f = new THREE.Vector3(...Q.get('from').split(',').map(Number));
    const t = new THREE.Vector3(...Q.get('to').split(',').map(Number));
    game.respawnEntity = e => e.spawn(f.clone(), 0);
    game.respawnEntity(bot);
    bot.god = true;
    bot.brain.thinkAt = 1e9; bot.brain.perceiveAt = 1e9;
    const log = [];
    let next = 0;
    game.script = g => {
      const br = bot.brain;
      br.state = 'roam'; br.waitUntil = 0;
      br.nav.setGoal(t, 1.4, 0.5);
      if (g.time >= next) {
        next += num('every', 0.5);
        const nv = br.nav;
        const wp = nv.path && nv.path[nv.index];
        if (g.time < num('from_t', 0)) return;
        log.push([+g.time.toFixed(2), bot.position.toArray().map(v => +v.toFixed(2)).join(','), 'v' + bot.velocity.toArray().map(v => +v.toFixed(1)).join(','), bot.onGround ? 'G' : 'A', nv.mode, nv.index + '/' + (nv.path ? nv.path.length : 0), wp ? wp.toArray().map(v => +v.toFixed(1)).join(',') + ':' + wp.type : '-', br.intent.jump ? 'J' : '', nv.arrived ? 'ARR' : ''].join(' '));
      }
    };
    await runSteps(game, num('dur', 20), 1 / 60, null);
    return { log };
  },

  /** Print raycast results: ?rays=x,y,z,dx,dy,dz;x,y,z,dx,dy,dz (max distance 20) */
  async rays(def) {
    const game = new HGame(def, { mode: 'ffa' });
    const out = [];
    for (const r of Q.get('rays').split(';')) {
      const v = r.split(',').map(Number);
      const o = new THREE.Vector3(v[0], v[1], v[2]);
      const d = new THREE.Vector3(v[3], v[4], v[5]).normalize();
      const h = game.world.collision.raycast(o, d, 20);
      out.push(r + ' -> ' + (h ? `d${h.distance.toFixed(2)} p(${h.point.toArray().map(x => x.toFixed(2))}) n(${h.normal.toArray().map(x => x.toFixed(2))})` : 'none'));
    }
    return { out };
  },

  /** Time nav.findPath over many random pairs. */
  async pathcost(def) {
    const game = new HGame(def, { mode: 'ffa' });
    const nav = game.world.nav;
    const times = [];
    let nulls = 0;
    for (let i = 0; i < num('n', 300); i++) {
      const a = nav.randomNode(), b = nav.randomNode();
      const pa = a.position || a, pb = b.position || b;
      const t0 = performance.now();
      const p = nav.findPath(pa, pb);
      times.push(performance.now() - t0);
      if (!p) nulls++;
    }
    times.sort((x, y) => x - y);
    const q = f => +times[Math.floor(times.length * f)].toFixed(2);
    return { n: times.length, nulls, p50: q(0.5), p90: q(0.9), p99: q(0.99), max: +times[times.length - 1].toFixed(2), navStats: nav.stats };
  },

  /** Which grenade arc does the solver choose (low / high) for a target at distance ?d ? */
  async arc(def) {
    const out = [];
    for (const d of [8, 12, 16, 20, 24]) {
      const game = new HGame(def, { mode: 'ffa' });
      const bot = game.bots.spawnBots(1, 'normal', 'ffa')[0];
      game.noRespawn = true;
      game.respawnEntity = e => e.spawn(new THREE.Vector3(-12, 0, 35), -Math.PI / 2);
      game.respawnEntity(bot);
      bot.grenades = 3;
      let cap = null;
      bot.throwGrenade = (v, fuse) => { cap = { v: v.toArray().map(x => +x.toFixed(1)), ang: +(Math.atan2(v.y, Math.hypot(v.x, v.z)) * 57.3).toFixed(0), fuse: +fuse.toFixed(2) }; return true; };
      const ok = bot.brain.throwGrenadeAt(new THREE.Vector3(-12 + d, 0, 35));
      out.push({ d, ok, ...cap });
    }
    return { out };
  },

  async cap(def) {
    const game = new HGame(def, { mode: 'ffa' });
    const { Capsule } = await import('three/addons/math/Capsule.js');
    const cap = new Capsule(new THREE.Vector3(-20, 0.4, 34), new THREE.Vector3(-20, 1.4, 34), 0.4);
    const v = new THREE.Vector3(3, -0.4, 0);
    const log = [];
    for (let i = 0; i < 12; i++) {
      v.y = -0.4;
      const r = game.world.collision.moveCapsule(cap, v, 1 / 60);
      log.push([i, +cap.start.y.toFixed(4), r.onGround, r.hitWall, +v.y.toFixed(3), +r.groundNormal.y.toFixed(2)]);
    }
    const out = [];
    for (const md of [1, 10, 30, 60, 1000]) for (const y of [5, 0.4]) {
      const h = game.world.collision.raycast(new THREE.Vector3(-20, y, 34), new THREE.Vector3(0, -1, 0), md);
      out.push([md, y, h ? +h.distance.toFixed(3) : null]);
    }
    out.push(['box', game.world.collision.octree.box.min.toArray(), game.world.collision.octree.box.max.toArray()]);
    const hu = game.world.collision.raycast(new THREE.Vector3(-20, -0.5, 34), new THREE.Vector3(0, 1, 0), 10);
    return { log, out, hu: hu && [hu.distance, hu.normal.toArray()], tris: game.world.collision.triangleCount };
  },

  /** One bot vs a scripted dummy: hit rates per weapon / distance / movement. */
  async aim(def) {
    const results = [];
    const weapons = (Q.get('weapon') || 'rifle,pistol,shotgun,sniper,rocket').split(',');
    const dists = (Q.get('dist') || '12,25,45').split(',').map(Number);
    const moves = (Q.get('move') || '0,1').split(',').map(Number);
    const diffs = (Q.get('diff') || 'normal').split(',');
    const reps = num('reps', 1);
    const agg = new Map();
    for (let rep = 0; rep < reps; rep++) for (const diff of diffs) for (const w of weapons) for (const dist of dists) for (const mv of moves) {
      const game = new HGame(def, { mode: 'ffa' });
      game.noRespawn = true;
      const bot = game.bots.spawnBots(1, diff, 'ffa')[0];
      await game.bots.prepare(game.world);
      game.addEntity(game.player);
      // open area: south strip (z 26..38)
      const dummy = game.player;
      dummy.maxHealth = 1e6;
      const bp = new THREE.Vector3(-20, 0, 34);
      game.respawnEntity = e => {
        if (e === bot) e.spawn(bp.clone(), Math.PI / 2 * -1);
        else e.spawn(new THREE.Vector3(-20 + dist, 0, 34), 0);
      };
      game.respawnEntity(bot);
      game.respawnEntity(dummy);
      dummy.health = 1e6;
      dummy.spawnProtectedUntil = 0;
      bot.inv = { pistol: bot.inv.pistol };
      bot.owned = ['pistol'];
      bot._addWeaponInternal(w === 'pistol' ? 'pistol' : w);
      if (w === 'pistol') bot.owned = ['pistol'];
      bot.inv[w].reserve = 999; // keep shooting
      bot.weaponId = w;
      bot.model.setWeapon(bot._getWeaponModel(w));
      bot.equipUntil = 0;
      bot.brain.weaponCheckAt = 1e9; // keep the weapon
      bot.brain.nextGrenadeAt = 1e9;
      bot.grenades = 0;
      let dmg = 0, hits = 0, hs = 0;
      game.events.on('damage', e => { if (e.attacker === bot && e.target === dummy) { dmg += e.amount; hits++; if (e.headshot) hs++; } });
      let t = 0, sdir = 1, nextChange = 0, vz = 0, jumpUntil = 0, jy = 0, jvy = 0;
      game.script = (g, dt) => {
        t += dt;
        dummy.health = Math.max(dummy.health, 1e5);
        dummy.spawnProtectedUntil = 0;
        if (mv === 0) { dummy.velocity.set(0, 0, 0); dummy.position.z = 34; return; }
        // human-like strafing: random durations, occasional stops, exponential accel, sometimes a jump
        if (t >= nextChange) {
          const r = Math.random();
          sdir = r < 0.2 ? 0 : (Math.random() < 0.5 ? -1 : 1);
          nextChange = t + 0.25 + Math.random() * 1.1;
          if (Math.random() < 0.08 && jy === 0) jvy = 7.5;
        }
        vz += (sdir * 5.6 - vz) * (1 - Math.exp(-9 * dt));
        dummy.position.z += vz * dt;
        if (dummy.position.z > 38) { dummy.position.z = 38; sdir = -1; vz = Math.min(vz, 0); }
        if (dummy.position.z < 27) { dummy.position.z = 27; sdir = 1; vz = Math.max(vz, 0); }
        if (jvy !== 0 || jy > 0) { jvy -= 24 * dt; jy = Math.max(0, jy + jvy * dt); if (jy === 0) jvy = 0; }
        dummy.position.y = jy;
        dummy.velocity.set(0, jvy, vz);
      };
      const dur = num('dur', 15);
      await runSteps(game, dur, 1 / 60, null);
      const pel = WEAPONS[w].pellets || 1;
      const key = [diff, w, dist, mv].join('|');
      let a = agg.get(key);
      if (!a) { a = { diff, weapon: w, dist, move: mv, shots: 0, pelletHits: 0, pel, dmg: 0, dur: 0, headshots: 0 }; agg.set(key, a); results.push(a); }
      a.shots += bot.stats.shots; a.pelletHits += bot.stats.pelletHits; a.dmg += dmg; a.dur += dur; a.headshots += hs;
    }
    for (const a of results) {
      a.acc = +(a.pelletHits / Math.max(1, a.shots * a.pel) * 100).toFixed(0);
      a.dps = +(a.dmg / a.dur).toFixed(1);
      a.sps = +(a.shots / a.dur).toFixed(2);
    }
    return { results };
  },

  /** Navigation: bots forced to travel between far-apart points; counts arrivals, stuck events, falls. */
  async nav(def) {
    const game = new HGame(def, { mode: 'ffa' });
    game.noRespawn = false;
    game.bots.spawnBots(num('bots', 4), 'normal', 'ffa');
    await game.bots.prepare(game.world);
    spawnAll(game);
    const inst = instrument(game);
    // make bots peaceful: they cannot see enemies (hidden through team trick) - use god + same team
    for (const b of game.bots.list) b.team = 1;
    // goals: every spawn point and pickup of the map that the nav graph can reach from the first spawn
    let goals = [];
    for (const sp of def.spawns) goals.push(sp.pos);
    for (const pk of def.pickups || []) goals.push(pk.pos);
    const nav0 = game.world.nav;
    const from = new THREE.Vector3(...def.spawns[0].pos);
    const total = goals.length;
    goals = goals.filter(g => {
      const gv = new THREE.Vector3(...g);
      const p = nav0.findPath(from, gv);
      if (!p || !p.length) return false;
      const l = p[p.length - 1];
      return Math.hypot(l.x - gv.x, l.z - gv.z) < 3.5 && Math.abs(l.y - gv.y) < 2.6;
    });
    const stat = new Map();
    for (const b of game.bots.list) stat.set(b, { arrivals: 0, goalIdx: (Math.random() * goals.length) | 0, since: 0 });
    game.script = g => {
      for (const b of g.bots.list) {
        if (!b.alive) continue;
        const s = stat.get(b);
        b.god = true;
        const br = b.brain;
        const goal = new THREE.Vector3(...goals[s.goalIdx]);
        br.state = 'roam'; br.waitUntil = 0;
        br.nav.setGoal(goal, 1.4, 0.5);
        br.thinkAt = 1e9; // disable state logic; only navigation
        if (br.nav.arrived || g.time - s.since > 40) {
          if (br.nav.arrived) s.arrivals++;
          s.goalIdx = (s.goalIdx + 1 + ((Math.random() * (goals.length - 2)) | 0)) % goals.length;
          s.since = g.time;
        }
      }
    };
    const perf = await runSteps(game, num('dur', 90), 1 / 60, inst);
    return {
      perf, navStats: game.world.nav.stats, deaths: game.deaths, goals: goals.length, totalGoals: total, padLaunches: game.padLaunches || 0, pads: game.world.jumpPads.length,
      bots: game.bots.list.map(b => ({ name: b.name, arrivals: stat.get(b).arrivals, pos: b.position.toArray().map(v => +v.toFixed(1)) })),
      diag: inst.summary(),
    };
  },
};

(async () => {
  const H = { done: false };
  window.__H__ = H;
  try {
    const def = await loadDef();
    const name = Q.get('test') || 'ffa';
    const res = await tests[name](def);
    Object.assign(H, res);
  } catch (err) {
    H.crash = String(err && err.stack || err);
    errors.push(H.crash);
  }
  H.errors = errors.slice(0, 20);
  H.done = true;
  document.getElementById('out').textContent = 'done';
})();
