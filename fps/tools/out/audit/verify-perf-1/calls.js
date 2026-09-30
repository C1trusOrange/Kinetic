// verify-perf-1: draw-call attribution (bots, shadow pass, pickups, projectiles) via interleaved A/B in one frame.
import * as THREE from 'three';
const G = window.__GAME__;
const R = window.__VP1__ = { done: false, out: {} };
const r = G.renderer;
const origRender = G.render.bind(G);
const med = a => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
function measure(fn, reps = 1) {
  r.info.reset();
  fn();
  return { calls: r.info.render.calls, tris: r.info.render.triangles };
}
function timed(cfgs, reps) {
  const res = {};
  for (const k of Object.keys(cfgs)) res[k] = { t: [], calls: 0, tris: 0 };
  for (let i = 0; i < reps; i++) {
    for (const [k, cfg] of Object.entries(cfgs)) {
      cfg.on();
      r.info.reset();
      const t0 = performance.now();
      origRender();
      const dt = performance.now() - t0;
      res[k].t.push(dt); res[k].calls = r.info.render.calls; res[k].tris = r.info.render.triangles;
      cfg.off();
    }
  }
  const out = {};
  for (const k of Object.keys(res)) out[k] = { calls: res[k].calls, tris: res[k].tris, cpuMedMs: +med(res[k].t).toFixed(2) };
  return out;
}
function countMeshes(root) {
  let meshes = 0; const mats = new Set(), geos = new Set();
  root.traverse(o => { if (o.isMesh) { meshes++; mats.add(o.material); geos.add(o.geometry); } });
  return { meshes, mats: mats.size, geos: geos.size };
}
let measured = false;
G.render = function () {
  if (!measured && G.state === 'playing' && G.time > 2.5) {
    measured = true;
    try { runMeasure(); } catch (e) { console.error('[vp1] measure failed', e && e.stack || e); }
    R.done = true;
  }
  origRender();
};
function runMeasure() {
  const bots = G.bots.list.filter(b => b.model && b.alive);
  const out = R.out;
  out.botCount = bots.length;
  out.botMeshes = bots.map(b => ({ weapon: b.weaponId, body: countMeshes(b.model.root).meshes, total: countMeshes(b.model.root).meshes, weaponMeshes: b.model.weapon ? countMeshes(b.model.weapon.root).meshes : 0, weaponMats: b.model.weapon ? countMeshes(b.model.weapon.root).mats : 0 }));
  // rocket/grenade model mesh counts
  out.rocketPoolGroup = countMeshes(G.projectiles._rocketPool[0].group);
  out.grenadePoolGroup = countMeshes(G.projectiles._grenadePool[0].group);
  // place bots in a fan in front of the camera so all are in the main-pass frustum
  const cam = G.camera; cam.updateMatrixWorld();
  const fwd = new THREE.Vector3(); cam.getWorldDirection(fwd);
  const right = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0)).normalize();
  const saved = bots.map(b => b.model.root.position.clone());
  const savedVis = bots.map(b => b.model.root.visible);
  bots.forEach((b, i) => {
    const k = i - (bots.length - 1) / 2;
    b.model.root.position.copy(cam.position).addScaledVector(fwd, 9 + (i % 2) * 3).addScaledVector(right, k * 1.6);
    b.model.root.position.y = cam.position.y - 1.6;
    b.model.root.visible = true;
    b.model.root.updateMatrixWorld(true);
  });
  const botMeshes = [];
  for (const b of bots) b.model.root.traverse(o => { if (o.isMesh) botMeshes.push(o); });
  const savedCast = botMeshes.map(m => m.castShadow);
  const pk = G.world.pickups && G.world.pickups.group;
  const cfgs = {
    full: { on() {}, off() {} },
    noBots: { on() { bots.forEach(b => b.model.root.visible = false); }, off() { bots.forEach(b => b.model.root.visible = true); } },
    botsNoCast: { on() { botMeshes.forEach(m => m.castShadow = false); }, off() { botMeshes.forEach((m, i) => m.castShadow = savedCast[i]); } },
    shadowFrozen: { on() { r.shadowMap.autoUpdate = false; }, off() { r.shadowMap.autoUpdate = true; } },
    noPickups: { on() { if (pk) pk.visible = false; }, off() { if (pk) pk.visible = true; } },
  };
  out.ab = timed(cfgs, 25);
  // projectiles: 1 rocket, 3 rockets in view (deltas vs full)
  const rockets = [];
  const spawn = n => { for (let i = 0; i < n; i++) rockets.push(G.projectiles.spawnRocket({ owner: null, origin: cam.position.clone().addScaledVector(fwd, 6 + i).addScaledVector(right, i - 1), direction: fwd.clone() })); };
  const clearR = () => { G.projectiles.clear(); rockets.length = 0; };
  const rk = {};
  for (const n of [1, 3]) { spawn(n); r.info.reset(); origRender(); rk['rockets' + n] = { calls: r.info.render.calls, tris: r.info.render.triangles }; clearR(); }
  r.info.reset(); origRender(); rk.none = { calls: r.info.render.calls, tris: r.info.render.triangles };
  out.rockets = rk;
  // restore
  bots.forEach((b, i) => { b.model.root.position.copy(saved[i]); b.model.root.visible = savedVis[i]; });
  // pickups stats
  if (pk) { let m = 0; pk.traverse(o => { if (o.isMesh) m++; }); out.pickupMeshes = m; out.pickupCulledFalse = (() => { let c = 0; pk.traverse(o => { if (o.isMesh && o.frustumCulled === false) c++; }); return c; })(); }
  out.shadowType = r.shadowMap.type; out.shadowSize = G.world.sun && G.world.sun.shadow && G.world.sun.shadow.mapSize ? [G.world.sun.shadow.mapSize.x, G.world.sun.shadow.mapSize.y] : null;
}
export function drive(t, dt, game) { game.player.god = true; }
export function finish(game, report) { report.custom = R.out; }
