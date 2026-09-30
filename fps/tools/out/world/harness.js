import * as THREE from 'three';
import { Capsule } from 'three/addons/math/Capsule.js';
import { World } from '/src/world/World.js';
import { MapBuilder } from '/src/world/MapBuilder.js';
import { CollisionWorld } from '/src/world/Collision.js';
import { Events } from '/src/core/Events.js';
import { QUALITY_PRESETS, GRAVITY } from '/src/core/constants.js';

const P = new URLSearchParams(location.search);
const mapId = P.get('id') || 'sandbox';
const tests = (P.get('t') || 'pads,pickups,nav').split(',');
const R = (window.__RESULT__ = { done: false });

const renderer = new THREE.WebGLRenderer();
renderer.setSize(64, 64);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(70, 1, 0.05, 700);
const sounds = [];
const game = {
  renderer, scene, camera, events: new Events(), quality: QUALITY_PRESETS.high, time: 0, entities: [], state: 'playing',
  audio: { play: (n) => sounds.push(n), playLoop: () => ({ stop() {}, setVolume() {}, setPosition() {} }) },
};

function makeEntity(name) {
  return {
    name, alive: true, position: new THREE.Vector3(), velocity: new THREE.Vector3(), height: 1.8, radius: 0.4, onGround: false,
    health: 50, armor: 0, ammoGiven: 0, grenades: 0, weapons: new Set(), lastLaunchTime: -999, team: 1,
    heal(n) { if (this.health >= 100) return false; this.health = Math.min(100, this.health + n); return true; },
    addArmor(n) { if (this.armor >= 100) return false; this.armor = Math.min(100, this.armor + n); return true; },
    addAmmo(id, f) { this.ammoGiven += f; return true; },
    addGrenades(n) { if (this.grenades >= 4) return false; this.grenades += n; return true; },
    giveWeapon(id) { if (this.weapons.has(id)) return false; this.weapons.add(id); return true; },
    launch(v) { this.velocity.copy(v); this.onGround = false; this.lastLaunchTime = game.time; this.launched = (this.launched || 0) + 1; },
  };
}

function physicsStep(world, e, dt, cap) {
  e.velocity.y -= GRAVITY * dt;
  cap.start.set(e.position.x, e.position.y + 0.4, e.position.z);
  cap.end.set(e.position.x, e.position.y + 1.4, e.position.z);
  const r = world.collision.moveCapsule(cap, e.velocity, dt);
  e.position.set(cap.start.x, cap.start.y - 0.4, cap.start.z);
  e.onGround = r.onGround;
  return r;
}

async function main() {
  const mod = await import(P.get('mapfile') ? '/' + P.get('mapfile') : `/src/world/maps/${mapId}.js`);
  const def = mod.default;
  const world = new World(game);
  await world.init();
  const t0 = performance.now();
  await world.load(def, {});
  R.loadMs = Math.round(performance.now() - t0);
  R.stats = world.stats;
  R.nav = world.nav.stats;
  R.warnings = world.warnings;
  let lights = 0; scene.traverse(o => { if (o.isLight) lights++; });
  R.lights = lights;

  const cap = new Capsule(new THREE.Vector3(), new THREE.Vector3(), 0.4);

  if (tests.includes('reload')) {
    R.reload = [];
    const files = ['/src/world/maps/sandbox.js', '/tools/out/world/gallery.js', '/tools/out/world/night.js', '/src/world/maps/sandbox.js', '/src/world/maps/sandbox.js'];
    for (const f of files) {
      const d = (await import(f)).default;
      await world.load(d, {});
      // render once so GPU resources exist
      camera.position.set(0, 10, 40); camera.lookAt(0, 0, 0);
      renderer.render(scene, camera);
      let lightsN = 0; scene.traverse(o => { if (o.isLight) lightsN++; });
      R.reload.push({ map: d.id, geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures, children: scene.children.length, lights: lightsN, ms: world.stats.totalMs });
    }
    world.applyQuality(QUALITY_PRESETS.low); renderer.render(scene, camera);
    world.applyQuality(QUALITY_PRESETS.medium); renderer.render(scene, camera);
    world.applyQuality(QUALITY_PRESETS.high); renderer.render(scene, camera);
    world.reset();
    world.unload();
    R.afterUnload = { children: scene.children.length, geometries: renderer.info.memory.geometries, bg: scene.background, env: !!scene.environment, fog: !!scene.fog };
    await world.load(def, {});
  }

  if (tests.includes('wp')) {
    R.wp = world.pickups.list.filter(p => p.type === 'weapon').map(p => {
      const box = new THREE.Box3().setFromObject(p.holder);
      return { id: p.weapon, scale: p.holder.scale.toArray(), pos: p.holder.position.toArray(), kids: p.holder.children.length, kidInfo: p.holder.children.map(c => [c.geometry.attributes.position.count, c.material.type, c.material.color && c.material.color.getHexString(), !!c.geometry.attributes.color]), size: box.getSize(new THREE.Vector3()).toArray().map(v => +v.toFixed(2)),
        geo: p.holder.children.map(c => { c.geometry.computeBoundingBox(); return c.geometry.boundingBox.getSize(new THREE.Vector3()).toArray().map(v => +v.toFixed(2)); }) };
    });
  }

  if (tests.includes('navq')) {
    const nav = world.nav;
    let bad = 0, checked = 0, maxErr = 0;
    const b = world.bounds;
    for (let i = 0; i < 1500; i++) {
      const pos = new THREE.Vector3(b.min.x + Math.random() * (b.max.x - b.min.x), Math.random() * 8 - 1, b.min.z + Math.random() * (b.max.z - b.min.z));
      const md = [2, 6, 10][i % 3];
      const got = nav.nearestNode(pos, md);
      let best = null, bd = md * md;
      for (const n of nav.nodes) {
        const dx = n.position.x - pos.x, dz = n.position.z - pos.z, dy = (n.position.y - pos.y) * 2;
        const d = dx * dx + dz * dz + dy * dy;
        if (d < bd) { bd = d; best = n; }
      }
      checked++;
      if ((got === null) !== (best === null)) { bad++; continue; }
      if (got) {
        const dx = got.position.x - pos.x, dz = got.position.z - pos.z, dy = (got.position.y - pos.y) * 2;
        const gd = dx * dx + dz * dz + dy * dy;
        if (gd > bd + 1e-6) { bad++; maxErr = Math.max(maxErr, Math.sqrt(gd) - Math.sqrt(bd)); }
      }
    }
    R.navq = { checked, bad, maxErr };
  }

  if (tests.includes('tris')) {
    R.tris = {};
    for (const s of def.solids) {
      if (s.type === 'box' && s.min && s.min[1] === -5) continue;
      const b = new MapBuilder({ solids: [s] }, new CollisionWorld(), () => {});
      b.buildGeometry();
      R.tris[s.type] = { visual: b.visualTriCount, collision: b.collisionTriCount };
    }
  }

  if (tests.includes('drops') && def.testDrops) {
    R.drops = [];
    for (const d of def.testDrops) {
      const e = makeEntity('drop');
      e.position.set(d.x, d.y + 6, d.z);
      let landed = false;
      for (let t = 0; t < 4; t += 1 / 120) {
        physicsStep(world, e, 1 / 120, cap);
        if (e.onGround) { landed = true; break; }
      }
      R.drops.push({ note: d.note, expect: d.y, got: +e.position.y.toFixed(2), ok: landed && Math.abs(e.position.y - d.y) < 0.05 });
    }
    R.dropsOk = R.drops.every(d => d.ok);
  }

  if (tests.includes('pads')) {
    R.pads = [];
    for (const [i, pad] of world.jumpPads.entries()) {
      const e = makeEntity('padtest');
      e.position.copy(pad.position);
      game.entities.length = 0; game.entities.push(e);
      game.time += 1;
      world.update(1 / 60);
      const v0 = e.velocity.clone();
      let t = 0, maxY = e.position.y, landed = null;
      for (; t < 8; t += 1 / 120) {
        game.time += 1 / 120;
        physicsStep(world, e, 1 / 120, cap);
        world.update(1 / 120);
        maxY = Math.max(maxY, e.position.y);
        if (t > 0.3 && e.onGround) { landed = e.position.clone(); break; }
      }
      R.pads.push({
        i, v0: v0.toArray().map(v => +v.toFixed(2)), t: +t.toFixed(2), maxY: +maxY.toFixed(2),
        target: pad.target.toArray(), landed: landed && landed.toArray().map(v => +v.toFixed(2)),
        err: landed ? +landed.distanceTo(pad.target).toFixed(2) : null,
        launchCount: e.launched,
      });
    }
    game.entities.length = 0;
  }

  if (tests.includes('pickups')) {
    R.pickups = [];
    const events = [];
    game.events.on('pickup', ev => events.push(ev.pickup.id));
    for (const p of world.pickups.list) {
      const e = makeEntity('pk');
      if (p.type === 'health') e.health = 40;
      e.position.copy(p.position).add(new THREE.Vector3(0.5, 0.05, 0.3));
      game.entities.length = 0; game.entities.push(e);
      const before = p.available;
      world.update(1 / 60);
      const after = p.available;
      const respawnIn = p.nextRespawn - game.time;
      game.entities.length = 0;
      game.time = p.nextRespawn + 0.01;
      world.update(1 / 60);
      R.pickups.push({ id: p.id, type: p.type + (p.weapon ? ':' + p.weapon : ''), before, collected: !after, respawnIn: +respawnIn.toFixed(1), back: p.available });
      game.time += 1;
    }
    R.pickupEvents = events.length;
    R.sounds = Array.from(new Set(sounds));
    const n = world.pickups.nearest('health', new THREE.Vector3(0, 0, 0));
    R.nearestHealth = n && n.position.toArray();
    world.reset();
    R.afterReset = world.pickups.list.every(p => p.available);
  }

  if (tests.includes('nav')) {
    const nav = world.nav;
    const spawns = world.spawnPoints;
    const goals = world.pickups.list.length ? world.pickups.list.map(p => ({ name: `${p.type}${p.weapon ? ':' + p.weapon : ''}#${p.id}`, pos: p.position })) : spawns.map((sp, i) => ({ name: 'spawn' + i, pos: sp.position }));
    const res = { paths: 0, nullPaths: 0, reached: 0, failed: [], byType: {}, pathMs: 0, maxWps: 0 };
    let stepMs = 0;
    const maxGoals = parseInt(P.get('goals') || '99', 10);
    const simulate = P.get('sim') !== '0';
    const jobs = [];
    for (let si = 0; si < spawns.length; si++) {
      for (let gi = 0; gi < Math.min(goals.length, maxGoals); gi++) jobs.push([si, gi]);
    }
    for (const [si, gi] of jobs) {
      const a = spawns[si].position, g = goals[gi];
      const p0 = performance.now();
      const path = nav.findPath(a, g.pos);
      res.pathMs += performance.now() - p0;
      if (!path) { res.nullPaths++; res.failed.push(`spawn${si}->${g.name}: no path`); continue; }
      res.paths++;
      res.maxWps = Math.max(res.maxWps, path.length);
      for (const w of path) res.byType[w.type] = (res.byType[w.type] || 0) + 1;
      if (!simulate) continue;
      const e = makeEntity('bot');
      e.position.copy(a).y += 0.02;
      game.entities.length = 0;
      game.entities.push(e);
      let wi = 0, t = 0, stuck = 0, lastPos = e.position.clone(), ok = false;
      const s0 = performance.now();
      for (; t < 45; t += 1 / 60) {
        const w = path[wi];
        const dx = w.x - e.position.x, dz = w.z - e.position.z;
        const d = Math.hypot(dx, dz);
        const dy = w.y - e.position.y;
        if (d < 0.7 && Math.abs(dy) < 1.2) { wi++; if (wi >= path.length) { ok = true; break; } continue; }
        const sp = 6.2;
        const tx = d > 1e-3 ? dx / d : 0, tz = d > 1e-3 ? dz / d : 0;
        e.velocity.x += (tx * sp - e.velocity.x) * Math.min(1, 12 / 60);
        e.velocity.z += (tz * sp - e.velocity.z) * Math.min(1, 12 / 60);
        if (e.onGround && ((w.type === 'jump' && d < 1.6 && dy > 0.3) || (dy > 0.45 && d < 1.8))) { e.velocity.y = 8.0; e.onGround = false; }
        game.time += 1 / 60;
        for (let k = 0; k < 2; k++) physicsStep(world, e, 1 / 120, cap);
        world.update(1 / 60);
        if (e.position.distanceTo(lastPos) < 0.02) stuck++; else { stuck = 0; lastPos.copy(e.position); }
        if (stuck > 120) break;
        if (e.position.y < world.killY) break;
      }
      stepMs += performance.now() - s0;
      if (ok) res.reached++;
      else res.failed.push(`spawn${si}(${a.x},${a.y},${a.z})->${g.name}(${g.pos.x},${g.pos.y},${g.pos.z}): stuck at wp ${wi}/${path.length} ${JSON.stringify(path[wi] && [path[wi].x, path[wi].y, path[wi].z, path[wi].type])} pos ${e.position.toArray().map(v => +v.toFixed(1))}`);
    }
    game.entities.length = 0;
    res.pathMs = +res.pathMs.toFixed(1);
    res.avgPathMs = +(res.pathMs / Math.max(1, res.paths + res.nullPaths)).toFixed(3);
    res.simMs = Math.round(stepMs);
    res.failed = res.failed.slice(0, 25);
    R.navTest = res;
    R.navSample = res.failed.slice(0, 3);
    const rn = nav.randomNode();
    R.randomNode = rn && rn.position.toArray();
    const rp = nav.randomPointNear(spawns[0].position, 8);
    R.randomPointNear = rp && rp.toArray().map(v => +v.toFixed(1));
    R.isConnected = nav.isConnected(spawns[0].position, goals[0].pos);
  }
  R.done = true;
  document.getElementById('out').textContent = JSON.stringify(R, null, 1);
}
main().catch(err => { R.error = String(err && err.stack || err); R.done = true; document.getElementById('out').textContent = R.error; console.error(err); });
