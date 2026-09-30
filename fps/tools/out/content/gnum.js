// Numeric + visual scenario for the special grenades (sandbox, 3 bots frozen unless stated, god player).
// Run: python tools/run.py "index.html?autotest=1&map=sandbox&bots=3&diff=hard&script=idle&god=1&duration=37.2&scenario=tools/out/content/gnum.js" --report --shot tools/out/content/gnum_end.png --eval "window.__SHEET__"
import * as THREE from 'three';
import { GRENADE_TYPES } from '/src/weapons/WeaponDefs.js';

const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
const UP = V3(0, 1, 0);
const R = { errors: [], notes: [] };
let G = null;
let C = null;            // open test centre (floor point)
let floorY = 0;
let wallSpot = null;
const done = new Set();
const dmgLog = [];
const S = {};            // sampling state

// ------------------------------------------------------------------ contact sheet (2x2 of 800x450)
const QP = new URLSearchParams(location.search);
const TW = +(QP.get('tw') || 400), TH = Math.round(TW * 9 / 16);
let sheet = null, sctx = null, capName = null, capSlot = 0;
function installCapture(game) {
  sheet = document.createElement('canvas');
  sheet.width = TW * 2; sheet.height = TH * 2;
  sctx = sheet.getContext('2d');
  sctx.fillStyle = '#000'; sctx.fillRect(0, 0, sheet.width, sheet.height);
  const orig = game.render.bind(game);
  game.render = function () {
    orig();
    if (capName) {
      const c = game.renderer.domElement;
      const x = (capSlot % 2) * TW, y = Math.floor(capSlot / 2) * TH;
      sctx.drawImage(c, 0, 0, c.width, c.height, x, y, TW, TH);
      sctx.fillStyle = '#fff'; sctx.font = '20px monospace'; sctx.fillText(capName, x + 10, y + 26);
      window.__SHEET__ = sheet.toDataURL('image/jpeg', 0.7);
      capName = null;
    }
  };
}
function cap(name, slot, camPos, target) {
  const d = V3(target.x - camPos.x, target.y - camPos.y, target.z - camPos.z).normalize();
  const yaw = Math.atan2(-d.x, -d.z);
  const pitch = Math.asin(d.y);
  G.fixedCam = [camPos.x, camPos.y, camPos.z, yaw, pitch];
  capName = name; capSlot = slot;
  S.uncamAt = G.time + 0.05;
}

// ------------------------------------------------------------------ helpers
const at = (t, name, fn) => ({ t, name, fn });
const safe = (name, fn) => { try { fn(); } catch (e) { R.errors.push(name + ': ' + (e && e.stack || e)); console.error('[gnum] ' + name, e); } };
const hd = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
function place(e, x, z, yaw = 0) {
  const pos = V3(C.x + x, floorY, C.z + z);
  if (e.isPlayer) e.spawn(pos, yaw); else e.teleportTo(pos, yaw);
  e.spawnProtectedUntil = 0; e.shockedUntil = 0; e.armor = 0; e.maxHealth = 1000; e.health = 1000; e.velocity.set(0, 0, 0);
}
function nade(type, owner, x, y, z, vel, fuse) {
  return G.projectiles.spawnGrenade({ owner, origin: V3(C.x + x, floorY + y, C.z + z), velocity: vel || V3(0, -6, 0), fuse: fuse ?? GRENADE_TYPES[type].fuse, type });
}
const P = () => G.player;
const bots = () => G.bots.list;
const fromC = (dx, dz) => V3(C.x + dx, floorY + 1.0, C.z + dz);

function findOpenSpot(game) {
  const w = game.world;
  const dirs = []; for (let i = 0; i < 8; i++) dirs.push(V3(Math.cos(i * Math.PI / 4), 0, Math.sin(i * Math.PI / 4)));
  const down = V3(0, -1, 0);
  for (let x = -24; x <= 24; x += 4) for (let z = -24; z <= 24; z += 4) {
    const h0 = w.raycast(V3(x, 3, z), down, 8);
    if (!h0 || h0.normal.y < 0.95) continue;
    let ok = true;
    for (const d of dirs) {
      if (w.raycast(V3(x, h0.point.y + 1.2, z), d, 14)) { ok = false; break; }
      const hp = w.raycast(V3(x + d.x * 11, h0.point.y + 3, z + d.z * 11), down, 8);
      if (!hp || Math.abs(hp.point.y - h0.point.y) > 0.2) { ok = false; break; }
    }
    if (ok) return { x, z, y: h0.point.y };
  }
  return null;
}
function findWallSpot(game) {
  const w = game.world;
  const down = V3(0, -1, 0);
  const dirs = [V3(1, 0, 0), V3(-1, 0, 0), V3(0, 0, 1), V3(0, 0, -1)];
  for (let x = -28; x <= 28; x += 2) for (let z = -28; z <= 28; z += 2) {
    const h0 = w.raycast(V3(x, 3, z), down, 8);
    if (!h0 || h0.normal.y < 0.95 || Math.abs(h0.point.y) > 0.3) continue;
    for (const d of dirs) {
      const hit = w.raycast(V3(x, h0.point.y + 1.2, z), d, 6);
      if (!hit || hit.distance < 2.3 || hit.distance > 3.2) continue;
      const back = w.raycast(V3(x, h0.point.y + 1.2, z), V3(-d.x, 0, -d.z), 6);
      if (back) continue;
      const fl = w.raycast(V3(x - d.x * 4.5, h0.point.y + 3, z - d.z * 4.5), down, 8);
      if (!fl || Math.abs(fl.point.y - h0.point.y) > 0.2) continue;
      return { x, z, y: h0.point.y, dir: d, wallDist: hit.distance };
    }
  }
  return null;
}

const freezeAI = function () {
  const it = this.intent;
  it.moveX = it.moveZ = it.speed = 0;
  it.fire = it.jump = it.reload = false;
};

// ------------------------------------------------------------------ setup
export async function setup(game, report) {
  G = game;
  window.__GAME__ = game;
  report.custom = R;
  if (game.world.mapId === 'gtest') {
    C = V3(0, 0, 0); floorY = 0;
    wallSpot = { x: -27.2, y: 0, z: 0, dir: V3(-1, 0, 0), wallDist: 2.8 };
  } else {
    const spot = findOpenSpot(game);
    if (!spot) { R.errors.push('no open spot found'); C = V3(0, 0, 20); floorY = 0; } else { C = V3(spot.x, spot.y, spot.z); floorY = spot.y; }
    wallSpot = findWallSpot(game);
  }
  R.centre = [C.x, C.y, C.z];
  R.wallSpot = wallSpot ? { x: wallSpot.x, z: wallSpot.z, dir: [wallSpot.dir.x, wallSpot.dir.z], wallDist: +wallSpot.wallDist.toFixed(2) } : null;
  for (const b of bots()) { b.brain.update = freezeAI; b.god = false; }
  G.events.on('damage', e => {
    if (['vortex', 'static', 'kinetic', 'grenade'].includes(e.weapon)) dmgLog.push({ t: +G.time.toFixed(2), w: e.weapon, target: e.target.name, amt: +e.amount.toFixed(1) });
  });
  installCapture(game);
  const [A, B, D] = bots();
  place(P(), 0, 24, 0);
  place(A, 0, 26); place(B, 2, 26); place(D, -2, 26);
}

// ------------------------------------------------------------------ schedule
const steps = [
  // ------------------------------------------------------------ VORTEX
  at(1.0, 'vortex-start', () => {
    const [A, B] = bots();
    place(A, 8.4, 0); place(B, -4.5, 0); place(P(), 0, 7, 0);
    S.v = { t0: G.time, maxA: 0, minA: 99, minB: 99, minP: 99, maxYA: 0, maxYB: 0, maxYP: 0, offGroundA: false, samples: [], rocket: null, rocketMax: 0, collapsed: false, post: { A: 0, B: 0, P: 0 } };
    S.v.hp0 = { A: A.health, B: B.health };
    S.v.d0 = { A: hd(A.position, C), B: hd(B.position, C), P: hd(P().position, C) };
    const g = nade('vortex', P(), 0, 0.7, 0, V3(0, -8, 0));
    S.v.g = g;
  }),
  at(2.6, 'vortex-cap', () => cap('VORTEX active', 0, V3(C.x - 11, floorY + 3.2, C.z - 11), V3(C.x, floorY + 1.2, C.z))),
  at(2.4, 'vortex-rocket', () => {
    const o = V3(C.x, floorY + 1.0, C.z - 8);
    S.v.rocket = G.projectiles.spawnRocket({ owner: P(), origin: o, direction: V3(1, 0, 0) });
    S.v.rocketDir0 = V3(1, 0, 0);
  }),
  at(6.2, 'vortex-end', () => {
    const [A, B] = bots();
    const v = S.v;
    R.vortex = {
      d0: v.d0, minDist: { A: +v.minA.toFixed(2), B: +v.minB.toFixed(2), P: +v.minP.toFixed(2) },
      maxYAboveFloor: { A: +v.maxYA.toFixed(2), B: +v.maxYB.toFixed(2), P: +v.maxYP.toFixed(2) },
      botAPeeledOff: v.offGroundA, rocketMaxDeflectionDeg: +(v.rocketMax * 180 / Math.PI).toFixed(1),
      collapsePeakSpeed: { A: +v.post.A.toFixed(1), B: +v.post.B.toFixed(1), P: +v.post.P.toFixed(1) },
      dmg: dmgLog.filter(d => d.w === 'vortex').reduce((a, d) => { a[d.target] = +((a[d.target] || 0) + d.amt).toFixed(1); return a; }, {}),
      collapseAt: v.collapseT != null ? +(v.collapseT - v.t0).toFixed(2) : null,
      samples: v.samples,
    };
  }),
  // ------------------------------------------------------------ STATIC
  at(7.0, 'static-setup', () => {
    const [A, B, D] = bots();
    place(A, 5, 0); place(B, -9, 0); place(D, 0, 14); place(P(), 0, 1.5, 0);
    S.s = { hp0: { A: A.health, B: B.health, D: D.health } };
  }),
  at(7.3, 'static-throw', () => { nade('static', P(), 0, 0.3, 0, V3(0, 0, 0), 0.05); S.s.tThrow = G.time; }),
  at(7.36, 'static-cap', () => cap('STATIC burst', 1, V3(C.x - 9, floorY + 3.0, C.z - 8), V3(C.x, floorY + 1.0, C.z))),
  at(7.7, 'static-read', () => {
    const [A, B, D] = bots();
    const rem = e => +(e.shockedUntil - G.time).toFixed(2);
    R.static = {
      shockRemaining: { A: rem(A), B: rem(B), D: rem(D), self: rem(P()) },
      damage: { A: +(S.s.hp0.A - A.health).toFixed(1), B: +(S.s.hp0.B - B.health).toFixed(1), D: +(S.s.hp0.D - D.health).toFixed(1) },
    };
  }),
  at(8.6, 'static-run-setup', () => {
    const [A, B, D] = bots();
    place(A, 0, 20); place(B, 3, 20); place(D, -3, 20);
    place(P(), -11, 0, -Math.PI / 2);
    S.run = { base: [], shocked: [], t0: G.time };
    S.runOn = true;
  }),
  at(10.0, 'static-run-throw', () => {
    const [, , D] = bots();
    const p = P().position;
    D.brain.update = freezeAI;
    G.projectiles.spawnGrenade({ owner: D, origin: V3(p.x + 2.5, floorY + 0.3, p.z), velocity: V3(0, 0, 0), fuse: 0.05, type: 'static' });
    S.run.tThrow = G.time;
  }),
  at(11.8, 'static-run-end', () => {
    S.runOn = false;
    const mean = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
    R.staticPlayer = {
      baselineSprint: +mean(S.run.base).toFixed(2), shockedMax: +Math.max(0, ...S.run.shocked).toFixed(2), shockedMean: +mean(S.run.shocked).toFixed(2),
      shockDuration: S.run.shockEnd != null ? +(S.run.shockEnd - S.run.tThrow).toFixed(2) : null,
    };
  }),
  // ------------------------------------------------------------ KINETIC
  at(12.5, 'kin-setup', () => {
    const [A, B, D] = bots();
    place(A, 2.0, 0); place(B, 0, 20); place(D, 3, 20); place(P(), 0, -20, 0);
    S.k = { hp0: A.health, p0: A.position.clone(), peak: 0, peakY: 0, frames: 0, on: false };
  }),
  at(12.8, 'kin-throw', () => { nade('kinetic', P(), 0, 0.2, 0, V3(0, 0, 0), 0.05); S.k.on = true; S.k.t0 = G.time; }),
  at(12.86, 'kin-cap', () => cap('KINETIC blast', 2, V3(C.x - 9, floorY + 3.0, C.z + 9), V3(C.x + 1, floorY + 1.0, C.z))),
  at(14.4, 'kin-read', () => {
    const [A] = bots();
    S.k.on = false;
    R.kinetic = {
      enemyAt2m: { peakSpeed: +S.k.peak.toFixed(1), peakHeight: +S.k.peakY.toFixed(2), slideDist: +hd(A.position, S.k.p0).toFixed(1), damage: +(S.k.hp0 - A.health).toFixed(1), firstFrameVel: S.k.first },
    };
  }),
  at(14.6, 'kin-self-setup', () => {
    const [A, B, D] = bots();
    place(A, 0, 22); place(B, 3, 22); place(D, -3, 22); place(P(), 0, 0, 0);
    P().god = false; P().maxHealth = 100; P().health = 100;
    S.ks = { y0: P().position.y, peak: 0, hp0: 100 };
  }),
  at(15.0, 'kin-self-throw', () => { nade('kinetic', P(), 0, 0.02, 0, V3(0, 0, 0), 0.05); S.ks.on = true; S.ks.t0 = G.time; }),
  at(17.4, 'kin-self-read', () => {
    S.ks.on = false;
    R.kineticSelf = { apexAboveFeet: +S.ks.peak.toFixed(2), healthLost: +(100 - P().health).toFixed(1), firstVel: S.ks.first };
    P().god = true; P().health = 100;
  }),
  at(17.6, 'kin-splat-setup', () => {
    const [A, B, D] = bots();
    place(B, 0, 22); place(D, 3, 22);
    if (!wallSpot) { R.notes.push('no wall spot'); return; }
    // bot near the wall; the charge lands on the far side so the shove points into the wall
    const w = wallSpot;
    A.teleportTo(V3(w.x, w.y, w.z), 0); A.health = A.maxHealth = 1000; A.velocity.set(0, 0, 0); A.spawnProtectedUntil = 0;
    place(P(), 0, -26, 0);
    S.sp = { hp0: A.health };
  }),
  at(18.0, 'kin-splat-throw', () => {
    if (!wallSpot) return;
    const w = wallSpot;
    dmgLog.length = 0;
    const A = bots()[0];
    const o = V3(w.x - w.dir.x * 1.9, w.y + 0.25, w.z - w.dir.z * 1.9);
    S.sp.dbg = { botPos: A.position.toArray().map(v => +v.toFixed(2)), origin: o.toArray().map(v => +v.toFixed(2)), los: G.combat.canSee(o, A.getChestPosition(V3(0, 0, 0))) };
    G.projectiles.spawnGrenade({ owner: P(), origin: o, velocity: V3(0, 0, 0), fuse: 0.05, type: 'kinetic' });
    S.sp.on = true;
    S.sp.peakV = 0;
  }),
  at(19.6, 'kin-splat-read', () => {
    const [A] = bots();
    R.kineticSplat = { totalDamage: +(S.sp ? S.sp.hp0 - A.health : 0).toFixed(1), events: dmgLog.filter(d => d.w === 'kinetic'), dbg: S.sp && S.sp.dbg, peakBotSpeed: S.sp && +S.sp.peakV.toFixed(1), botFinalX: +A.position.x.toFixed(2) };
  }),
  // ------------------------------------------------------------ SMOKE
  at(20.0, 'smoke-setup', () => {
    const [A, B, D] = bots();
    place(D, 0, 22);
    place(A, -7, 0, -Math.PI / 2); place(B, 7, 0, Math.PI / 2);
    place(P(), 0, 24, 0);
    A.brain.updateMovement = function () { const it = this.intent; it.moveX = it.moveZ = it.speed = 0; };
    // A gets its real brain back and hunts a visible, standing B... B is a bot (enemy), so no player needed
    A.brain.update = Object.getPrototypeOf(A.brain).update;
    for (const k of Object.keys(A.nades)) A.nades[k] = 0;
    A.grenades = 0;
    A.health = A.maxHealth = 1000;
    S.m = { losAt: null, vis: [], t0: 0 };
  }),
  at(21.6, 'smoke-pre', () => {
    const [A, B] = bots();
    const eyeA = A.getEyePosition(V3(0, 0, 0)), eyeB = B.getEyePosition(V3(0, 0, 0));
    const rec = A.brain.targetRec;
    R.smoke = {
      preSee: G.combat.canSee(eyeA, eyeB), preSeeSmokeFlag: G.combat.canSee(eyeA, eyeB, { smoke: true }),
      botAHasTarget: !!rec, botASeesTarget: !!(rec && rec.visible),
    };
    S.smokeEyes = { a: eyeA, b: eyeB };
  }),
  at(21.7, 'smoke-pop', () => {
    const [A, B] = bots();
    S.m.t0 = G.time;
    G.projectiles.detonate('smoke', V3(C.x, floorY + 0.07, C.z), UP, P());
    S.m.hpB0 = B.health;
  }),
  at(21.8, 'smoke-check', () => {
    const [A, B] = bots();
    const eyeA = A.getEyePosition(V3(0, 0, 0)), eyeB = B.getEyePosition(V3(0, 0, 0));
    R.smoke.postSee = G.combat.canSee(eyeA, eyeB);
    R.smoke.postSeeSmokeFlag = G.combat.canSee(eyeA, eyeB, { smoke: true });
    R.smoke.chordM = +G.combat.smokeChord(eyeA, eyeB).toFixed(2);
    R.smoke.smokesLen = G.combat.smokes.length;
    // blast through the cloud is not shielded
    G.projectiles.explode(V3(C.x + 1, floorY + 0.15, C.z), { owner: P(), weapon: 'grenade', normal: UP });
    R.smoke.fragThroughSmokeDamageToB = +(S.m.hpB0 - B.health).toFixed(1);
  }),
  at(23.2, 'smoke-cap', () => cap('SMOKE cloud', 3, V3(C.x - 11, floorY + 2.2, C.z + 10), V3(C.x, floorY + 1.6, C.z))),
  at(24.0, 'smoke-veil', () => {
    place(P(), 0, 0.5, 0);           // inside the cloud
  }),
  at(24.9, 'smoke-veil-read', () => {
    const fx = G.projectiles.types.fx;
    R.smoke.veilInside = +fx.screen.smoke.toFixed(2);
    R.smoke.overlayOpacity = fx._overlay ? fx._overlay.smoke.style.opacity : null;
    place(P(), 0, 24, 0);
  }),
  at(27.0, 'smoke-los-read', () => {
    const vis = S.m.vis;
    const firstFalse = vis.find(s => s.v === false);
    R.smoke.botSawTargetBeforePop = vis.length ? vis[0].v : null;
    R.smoke.losLostAfterPopSec = firstFalse ? +(firstFalse.t - S.m.t0).toFixed(2) : null;
    R.smoke.visibleFractionAfterPop = vis.length ? +(vis.filter(s => s.v).length / vis.length).toFixed(2) : null;
    R.smoke.samples = vis.length;
  }),
  at(31.5, 'smoke-expire', () => {
    R.smoke.smokesAfter9s = G.combat.smokes.length;
    const before = G.projectiles.types.fx.clouds.length;
    for (let i = 0; i < 8; i++) G.projectiles.detonate('smoke', V3(C.x + i * 0.5, floorY + 0.07, C.z), UP, P());
    R.smoke.smokesAfter8Pops = G.combat.smokes.length;
    R.smoke.fxCloudsCap = G.projectiles.types.fx.clouds.length;
  }),
  // ------------------------------------------------------------ UX
  at(32.5, 'ux-setup', () => {
    const w = G.weapons;
    for (const [i, b] of bots().entries()) place(b, i * 2, 26);
    G.combat.smokes.length = 0;
    place(P(), 0, 0, 0);
    Object.assign(w.nades, { frag: 2, vortex: 1, static: 0, kinetic: 1, smoke: 1 });
    w.grenadeType = 'frag';
    S.ux = { seq: [], step: 0, t: G.time };
    R.ux = { cycle: [], fullCarry: null, crate: null };
    // max carry + crate
    const fake = { amount: 2, extra: null, lastGrant: null };
    const inv = w.nades;
    G.weapons.addGrenades(10, 'vortex');
    R.ux.vortexAfterAdd10 = inv.vortex;
    for (const t of ['frag', 'vortex', 'static', 'kinetic', 'smoke']) inv[t] = GRENADE_TYPES[t].maxCarry;
    R.ux.fullCrateConsumed = P().addGrenades(2, 'frag');
    inv.vortex = 1; inv.static = 0; inv.kinetic = 1; inv.smoke = 1; inv.frag = 2;
  }),
  at(33.0, 'ux-x1', () => { G.input.setVirtual('grenadeNext', true); }),
  at(33.3, 'ux-x1r', () => { G.input.setVirtual('grenadeNext', false); R.ux.cycle.push(G.weapons.grenadeType); }),
  at(33.5, 'ux-x2', () => { G.input.setVirtual('grenadeNext', true); }),
  at(33.8, 'ux-x2r', () => { G.input.setVirtual('grenadeNext', false); R.ux.cycle.push(G.weapons.grenadeType); }),
  at(34.0, 'ux-x3', () => { G.input.setVirtual('grenadeNext', true); }),
  at(34.3, 'ux-x3r', () => { G.input.setVirtual('grenadeNext', false); R.ux.cycle.push(G.weapons.grenadeType); }),
  at(34.5, 'ux-x4', () => { G.input.setVirtual('grenadeNext', true); }),
  at(34.8, 'ux-x4r', () => { G.input.setVirtual('grenadeNext', false); R.ux.cycle.push(G.weapons.grenadeType); }),
  // select vortex, throw it (hold G 0.5 s), then G again with the empty vortex -> auto-select
  at(35.0, 'ux-x5', () => { G.input.setVirtual('grenadeNext', true); }),
  at(35.3, 'ux-x5r', () => { G.input.setVirtual('grenadeNext', false); R.ux.cycle.push(G.weapons.grenadeType); G.input.setVirtual('grenade', true); }),
  at(36.0, 'ux-throw1', () => { G.input.setVirtual('grenade', false); }),
  at(36.8, 'ux-thrown1', () => {
    const list = G.projectiles.grenades.filter(g => g.owner === P());
    R.ux.throw1 = { types: list.map(g => g.type), nadesAfter: { ...G.weapons.nades }, selected: G.weapons.grenadeType };
    G.input.setVirtual('grenade', true);
  }),
  at(37.1, 'ux-throw2', () => { G.input.setVirtual('grenade', false); }),
  at(37.8, 'ux-thrown2', () => {
    const list = G.projectiles.grenades.filter(g => g.owner === P());
    R.ux.throw2 = { types: list.map(g => g.type), nadesAfter: { ...G.weapons.nades }, selected: G.weapons.grenadeType };
    // leave the player selecting a special with the HUD chip visible
    G.weapons.nades.vortex = 2; G.weapons.nades.smoke = 2; G.weapons.grenadeType = 'vortex';
    G.projectiles.clear();
  }),
  at(38.1, 'end-smoke', () => {
    G.projectiles.detonate('smoke', V3(P().position.x, floorY + 0.07, P().position.z), UP, P());
  }),
  at(38.5, 'freeze', () => { G.timeScale = 0.05; R.frozenAt = G.time; }),
];

// ------------------------------------------------------------------ per-frame
export function drive(t, dt, game, report) {
  const now = game.time;
  if (S.uncamAt && now >= S.uncamAt) { game.fixedCam = null; S.uncamAt = 0; }
  for (const s of steps) {
    if (done.has(s.name) || t < s.t) continue;
    done.add(s.name);
    safe(s.name, s.fn);
  }
  safe('sample', () => {
    const [A, B] = bots();
    const v = S.v;
    if (v && now >= v.t0 && !R.vortex) {
      const cdist = e => hd(e.position, C);
      const dA = cdist(A), dB = cdist(B), dP = cdist(P());
      v.maxA = Math.max(v.maxA, dA); v.minA = Math.min(v.minA, dA); v.minB = Math.min(v.minB, dB); v.minP = Math.min(v.minP, dP);
      v.maxYA = Math.max(v.maxYA, A.position.y - floorY); v.maxYB = Math.max(v.maxYB, B.position.y - floorY); v.maxYP = Math.max(v.maxYP, P().position.y - floorY);
      if (!A.onGround) v.offGroundA = true;
      if (v.samples.length < 40 && Math.floor((now - v.t0) * 4) > v.samples.length) v.samples.push({ t: +(now - v.t0).toFixed(2), dA: +dA.toFixed(1), dB: +dB.toFixed(1), dP: +dP.toFixed(1) });
      const g = v.g;
      if (!v.collapsed && g && !G.projectiles.grenades.includes(g)) { v.collapsed = true; v.collapseT = now; }
      if (v.collapsed) {
        const sp = e => Math.hypot(e.velocity.x, e.velocity.y, e.velocity.z);
        v.post.A = Math.max(v.post.A, sp(A)); v.post.B = Math.max(v.post.B, sp(B)); v.post.P = Math.max(v.post.P, sp(P()));
      }
      const r = v.rocket;
      if (r && r.active) {
        const dot = Math.min(1, r.direction.dot(v.rocketDir0));
        v.rocketMax = Math.max(v.rocketMax, Math.acos(dot));
      }
    }
    if (S.runOn) {
      const sp = Math.hypot(P().velocity.x, P().velocity.z);
      const el = now - S.run.t0;
      game.input.setVirtual('forward', true); game.input.setVirtual('sprint', true);
      if (S.run.tThrow == null) { if (el > 1.0) S.run.base.push(sp); }
      else {
        if (P().isShocked()) { if (now - S.run.tThrow > 0.25) S.run.shocked.push(sp); S.run.shockEnd = now; }
      }
    } else if (S.run) {
      game.input.setVirtual('forward', false); game.input.setVirtual('sprint', false);
    }
    const k = S.k;
    if (k && k.on) {
      const A = bots()[0];
      const sp = Math.hypot(A.velocity.x, A.velocity.y, A.velocity.z);
      if (k.first == null && now > k.t0 + 0.06) k.first = { speed: +sp.toFixed(1), vy: +A.velocity.y.toFixed(1) };
      k.peak = Math.max(k.peak, sp); k.peakY = Math.max(k.peakY, A.position.y - floorY);
    }
    if (S.sp && S.sp.on) S.sp.peakV = Math.max(S.sp.peakV, Math.hypot(bots()[0].velocity.x, bots()[0].velocity.z));
    const ks = S.ks;
    if (ks && ks.on) {
      const p = P();
      if (ks.first == null && now > ks.t0 + 0.06) ks.first = { vy: +p.velocity.y.toFixed(1), vh: +Math.hypot(p.velocity.x, p.velocity.z).toFixed(1) };
      ks.peak = Math.max(ks.peak, p.position.y - floorY);
    }
    const m = S.m;
    if (m && t >= 21.0 && t < 26.9) {
      const A = bots()[0];
      const rec = A.brain.targetRec;
      m.vis.push({ t: now, v: !!(rec && rec.visible) });
    }
  });
}

export function finish(game, report) {
  R.dmgLogTail = dmgLog.slice(-12);
  R.notesCount = R.notes.length;
  R.stats = {
    smokesFinal: game.combat.smokes.length,
    grenadesFinal: game.projectiles.grenades.length,
  };
  window.__SHEET__ = window.__SHEET__ || null;
  if (QP.has('sheetview') && sheet) {
    // show the contact sheet full-window so the harness screenshot captures it
    sheet.style.cssText = 'position:fixed;left:0;top:0;width:100vw;height:100vh;z-index:99999;background:#000;';
    document.body.appendChild(sheet);
  }
}
