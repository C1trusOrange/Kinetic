// w1-weapons verification scenario: Slipstream speed scaling, Javelin charge / pierce / one-shot numbers, HUD + beam scene, menu arsenal.
// Run: python tools/run.py "index.html?autotest=1&map=sandbox&bots=3&god=1&duration=80&scenario=tools/out/content/w1_test.js" --report --shots ...
import * as THREE from 'three';

const R = { spot: null, smg: [], smgTrials: {}, rail: [], charge: [], walls: [], hitstop: {}, hud: {}, notes: [], errors: [] };
const steps = [];
const windows = [];
let bots = [];
let S = null;          // { pos, yaw }
let armFreeze = false;
let railShotPerf = 0;
let sceneAStart = 0;
let sampleTS = null;
const at = (t, fn, label) => steps.push({ t, fn, label, done: false });
const win = (action, a, b) => windows.push({ action, a, b });
const ACTIONS = ['forward', 'sprint', 'crouch', 'fire', 'jump', 'ads', 'reload'];

function aimAt(g, target) {
  const p = g.player;
  const eye = p.getEyePosition(new THREE.Vector3());
  const d = target.clone().sub(eye);
  p.yaw = Math.atan2(-d.x, -d.z);
  p.pitch = Math.atan2(d.y, Math.hypot(d.x, d.z));
}

function findSpot(g) {
  const p = g.player;
  let best = null;
  for (const sp of g.world.spawnPoints) {
    const eye = sp.position.clone(); eye.y += 1.4;
    const fwd = new THREE.Vector3(-Math.sin(sp.yaw), 0, -Math.cos(sp.yaw));
    const hit = g.combat.raycast(eye, fwd, 48, p);
    const dist = hit ? hit.distance : 48;
    // also require clear ground/side room: probe left/right at 6 m
    const side = new THREE.Vector3(fwd.z, 0, -fwd.x);
    let clear = 0;
    for (const k of [-1, 1]) { const h2 = g.combat.raycast(eye, side.clone().multiplyScalar(k), 4, p); clear += h2 ? h2.distance : 4; }
    if (!best || dist + clear > best.dist + best.clear) best = { pos: sp.position.clone(), yaw: sp.yaw, dist, clear };
  }
  return best;
}

function resetBots(g) {
  for (const b of bots) { b.alive = true; b.health = 400; b.maxHealth = Math.max(b.maxHealth, 400); b.armor = 0; b.spawnProtectedUntil = 0; b.god = false; }
}

function placeBots(g, dists) {
  const fwd = new THREE.Vector3(-Math.sin(S.yaw), 0, -Math.cos(S.yaw));
  bots.forEach((b, i) => {
    const pos = S.pos.clone().addScaledVector(fwd, dists[i]);
    b.teleportTo(pos, S.yaw + Math.PI);
    b.velocity.set(0, 0, 0);
  });
  resetBots(g);
}

function spawnAtS(g) {
  g.player.spawn(S.pos.clone(), S.yaw);
  g.player.god = true;
}

function healthSnapshot() { return bots.map(b => +b.health.toFixed(2)); }

function railCase(g, label, power, aimHead, tFire) {
  const ws = g.weapons;
  const def = ws.current;
  const inv = ws.inv.rail;
  const before = healthSnapshot();
  ws.spreadAngle = 0; ws.bloom = 0;
  inv.ammo = def.magSize;
  const now = g.time;
  ws._fire(def, inv, now, { power });
  R._pending = { label, power, before, t: now };
}

export async function setup(g, report) {
  report.w1 = R;
  window.__W1__ = R;
  const ws = g.weapons;
  const p = g.player;
  p.god = true;
  bots = g.bots.list.slice(0, 3);
  for (const b of bots) {
    b.brain.update = function () { this.intent.fire = false; this.intent.moveX = 0; this.intent.moveZ = 0; this.intent.speed = 0; };
  }
  S = findSpot(g);
  R.spot = { pos: S.pos.toArray().map(v => +v.toFixed(1)), yaw: +S.yaw.toFixed(2), dist: +S.dist.toFixed(1), clear: +S.clear.toFixed(1) };
  for (const id of ['sniper', 'rocket', 'smg', 'rail']) ws.giveWeapon(id);
  R.owned = ws.owned.slice();

  // wrappers: record shots
  const fb = g.combat.fireBullet.bind(g.combat);
  g.combat.fireBullet = (o) => {
    if (o.shooter === p && o.weapon === 'smg') {
      R.smg.push({
        t: +g.time.toFixed(3), trial: R._trial, speed: +p.speed.toFixed(2), m: +ws.momentum.toFixed(3), dmg: +o.damage.toFixed(2),
        tracer: '0x' + Number(o.tracerColor).toString(16), interval: +(ws.nextFireAt - g.time).toFixed(4), spread: +ws.spreadAngle.toFixed(4),
        hudLit: g.hud && g.hud.e.momList ? g.hud.e.momList.filter(i => i.classList.contains('lit')).length : -1,
        hudHot: g.hud ? g.hud.e.mom.classList.contains('hot') : null,
      });
    }
    return fb(o);
  };
  const of = ws._fire.bind(ws);
  ws._fire = (def, inv, now, opts) => {
    if (def.id === 'rail') { R.charge.push({ t: +now.toFixed(2), power: opts && opts.power != null ? +opts.power.toFixed(3) : null, ammoBefore: inv.ammo }); railShotPerf = performance.now() * 0.001; }
    return of(def, inv, now, opts);
  };
  g.events.on('damage', e => {
    if (e.attacker === p && e.weapon === 'rail') (R._dmg = R._dmg || []).push({ t: +g.time.toFixed(2), target: bots.indexOf(e.target), amount: +e.amount.toFixed(2), head: e.headshot });
  });

  const T = 1.0;
  // ---------------------------------------------------------------- smg trials
  at(T, () => { spawnAtS(g); ws._requestSwitch('smg'); R._trial = 'A-stand'; });
  win('fire', T + 1.3, T + 1.9);
  at(T + 2.6, () => { spawnAtS(g); R._trial = 'B-walk'; });
  win('forward', T + 3.0, T + 4.6); win('fire', T + 3.8, T + 4.4);
  at(T + 5.2, () => { spawnAtS(g); R._trial = 'C-slide'; });
  win('forward', T + 5.4, T + 7.6); win('sprint', T + 5.4, T + 6.7); win('crouch', T + 6.5, T + 7.4); win('fire', T + 6.65, T + 7.3);
  at(T + 8.4, () => { R._trial = ''; });

  // ---------------------------------------------------------------- rail: direct numbers
  const B = T + 9.0;
  at(B, () => { spawnAtS(g); placeBots(g, [9, 12.5, 16]); ws._requestSwitch('rail'); });
  win('crouch', B + 1.2, B + 5.9);              // eye at ~1.0 m: a level ray runs through the chests of the three bots
  const cases = [['body p0.4', 0.4, false], ['body p0.7', 0.7, false], ['body p1.0', 1.0, false]];
  cases.forEach(([label, power, head], i) => {
    const t0 = B + 1.7 + i * 1.5;
    at(t0, () => { resetBots(g); const c = new THREE.Vector3(); bots[0].getChestPosition(c); aimAt(g, c); });
    at(t0 + 0.6, () => railCase(g, label, power, head));
    at(t0 + 0.95, () => { const p0 = R._pending; p0.after = healthSnapshot(); p0.delta = p0.before.map((v, k) => +(v - p0.after[k]).toFixed(2)); R.rail.push(p0); });
  });
  // headshot (standing): level ray at eye height through the three heads
  const H = B + 6.5;
  at(H, () => { resetBots(g); });
  at(H + 0.3, () => { const c = new THREE.Vector3(); bots[0].getEyePosition(c); aimAt(g, c); });
  at(H + 1.0, () => railCase(g, 'head p1.0', 1.0, true));
  at(H + 1.4, () => { const p0 = R._pending; p0.after = healthSnapshot(); p0.delta = p0.before.map((v, k) => +(v - p0.after[k]).toFixed(2)); R.rail.push(p0); });

  // ---------------------------------------------------------------- rail: charge state machine via real input
  const C = H + 2.4;
  const holds = [0.3, 0.55, 0.9, 2.0];
  holds.forEach((hold, i) => {
    const t0 = C + i * 3.6;
    at(t0, () => {
      ws.inv.rail.ammo = 4; ws.nextFireAt = 0; resetBots(g);
      const c = new THREE.Vector3(); bots[0].getChestPosition(c); aimAt(g, c);
      R._ch = { hold, ammoBefore: ws.inv.rail.ammo, fires: R.charge.length, dmgN: (R._dmg || []).length, maxCharge: 0 };
    });
    win('fire', t0 + 0.5, t0 + 0.5 + hold);
    at(t0 + 0.5 + hold + 1.0, () => {
      const c = R._ch;
      c.ammoAfter = ws.inv.rail.ammo; c.firedShots = R.charge.length - c.fires; c.shotPower = R.charge.slice(c.fires).map(x => x.power);
      c.dmg = (R._dmg || []).slice(c.dmgN).map(x => x.amount); c.charging = ws.charging;
      R.chargeTests = R.chargeTests || []; R.chargeTests.push(c);
    });
  });
  // sample charge progress + HUD ring text during the 2.0 s hold
  const Cend = C + holds.length * 3.6;

  // ---------------------------------------------------------------- hit-stop on a Javelin kill
  const K = Cend + 0.5;
  at(K, () => { spawnAtS(g); resetBots(g); const c = new THREE.Vector3(); bots[0].getChestPosition(c); aimAt(g, c); bots[0].health = 40; ws.nextFireAt = 0; });
  at(K + 0.8, () => { const c = new THREE.Vector3(); bots[0].getChestPosition(c); aimAt(g, c); });
  at(K + 1.2, () => {
    sampleTS = { t0: performance.now(), min: 1, back: null, killed: false };
    R.hitstop.before = g.timeScale;
    railCase(g, 'kill', 1.0, false);
    R.hitstop.rightAfter = g.timeScale;
    R.hitstop.botAlive = bots[0].alive;
  });

  // ---------------------------------------------------------------- scene A: charge held at READY, then release + beam frozen
  const A = K + 5.5;
  at(A, () => {
    spawnAtS(g); placeBots(g, [10, 14, 18]);
    ws.current.charge.holdLimit = 1e9;         // hold READY for the screenshot
    ws.inv.rail.ammo = 4; ws.nextFireAt = 0;
    sceneAStart = performance.now() * 0.001;
    R.sceneA = { perf: +sceneAStart.toFixed(1), t: +g.time.toFixed(1) };
  });
  at(A + 0.6, () => { const c = new THREE.Vector3(); bots[0].getChestPosition(c); aimAt(g, c); });
  win('fire', A + 1.0, A + 9.0);
  at(A + 3.0, () => { R.hud.ringText = g.hud.e.ringtxt.textContent; R.hud.ringClass = g.hud.e.ring.className; R.hud.cross = g.hud.e.cross.getAttribute('data-style'); R.hud.chargeAmount = ws.chargeAmount; R.hud.slots = g.hud.e.slotList.map(s => s.dataset.id + ':' + (s.classList.contains('owned') ? 'o' : '-') + (s.classList.contains('sel') ? 's' : '')).join(' '); R.hud.ammoW = getComputedStyle(g.hud.e.ammo).width; });
  at(A + 9.05, () => { armFreeze = true; ws.current.charge.holdLimit = 1.2; });
  at(A + 16, () => { if (g.railBeams) g.railBeams.freeze = null; armFreeze = false; });

  // ---------------------------------------------------------------- scene M: menu arsenal
  const M = A + 17;
  at(M, () => { g.menu._go('arsenal'); R.sceneM = { perf: +(performance.now() / 1000).toFixed(1), rows: g.menu.root.querySelectorAll('.ars-row').length }; });
  at(M + 9, () => { g.menu.hide(); });

  // ---------------------------------------------------------------- walls (last: they block the bots)
  const W = M + 10;
  const addWall = (dist, thick) => {
    const fwd = new THREE.Vector3(-Math.sin(S.yaw), 0, -Math.cos(S.yaw));
    const c = S.pos.clone().addScaledVector(fwd, dist); c.y += 1.5;
    const m = new THREE.Matrix4().makeRotationY(S.yaw).setPosition(c);
    g.world.collision.addGeometry(new THREE.BoxGeometry(8, 4, thick), m, 'concrete');
  };
  at(W, () => { spawnAtS(g); placeBots(g, [10, 14, 18]); addWall(5, 0.5); });
  win('crouch', W, W + 8);
  wallCase(W + 0.8, 1.0, 'thin 0.5 m wall, p1.0 (should pierce)');
  wallCase(W + 2.6, 0.8, 'thin 0.5 m wall, p0.8 (below 0.9: blocked)');
  at(W + 4.4, () => addWall(7, 1.4));
  wallCase(W + 5.0, 1.0, 'after a 1.4 m wall behind it, p1.0 (budget exhausted: blocked)');
  R._end = W + 8;
  function wallCase(t0, power, label) {
    at(t0, () => { resetBots(g); const c = new THREE.Vector3(); bots[0].getChestPosition(c); aimAt(g, c); });
    at(t0 + 0.6, () => { const c = new THREE.Vector3(); bots[0].getChestPosition(c); aimAt(g, c); railCase(g, label, power, false); });
    at(t0 + 0.95, () => { const p0 = R._pending; p0.after = healthSnapshot(); p0.delta = p0.before.map((v, k) => +(v - p0.after[k]).toFixed(2)); R.walls.push(p0); });
  }
  report.w1EndAt = R._end;
}

export function drive(t, dt, g) {
  const inp = g.input;
  for (const s of steps) {
    if (!s.done && t >= s.t) {
      s.done = true;
      try { s.fn(); } catch (err) { R.errors.push((s.label || s.t) + ': ' + (err && err.stack ? err.stack.split('\n').slice(0, 3).join(' | ') : String(err))); }
    }
  }
  for (const a of ACTIONS) inp.setVirtual(a, windows.some(w => w.action === a && t >= w.a && t < w.b));
  if (armFreeze && railShotPerf > sceneAStart && sceneAStart > 0 && g.railBeams) {
    g.railBeams.freeze = railShotPerf + 0.03; armFreeze = false;
  }
  if (sampleTS) {
    if (g.timeScale < sampleTS.min) sampleTS.min = g.timeScale;
    if (sampleTS.min < 1 && g.timeScale === 1 && sampleTS.back == null) sampleTS.back = +((performance.now() - sampleTS.t0) / 1000).toFixed(3);
    if (!bots[0].alive) sampleTS.killed = true;
    R.hitstop.min = sampleTS.min; R.hitstop.backAfterSec = sampleTS.back; R.hitstop.killed = sampleTS.killed;
  }
  // keep the frozen bots planted
  if (steps.length && t > 8.8) for (const b of bots) if (b.alive) { b.velocity.x = 0; b.velocity.z = 0; }
}

export function finish(g, report) {
  R.smgSummary = {};
  for (const trial of ['A-stand', 'B-walk', 'C-slide']) {
    const rows = R.smg.filter(r => r.trial === trial);
    if (!rows.length) continue;
    R.smgSummary[trial] = {
      shots: rows.length,
      speed: [Math.min(...rows.map(r => r.speed)), Math.max(...rows.map(r => r.speed))],
      m: [Math.min(...rows.map(r => r.m)), Math.max(...rows.map(r => r.m))],
      dmg: [Math.min(...rows.map(r => r.dmg)), Math.max(...rows.map(r => r.dmg))],
      interval: [Math.min(...rows.map(r => r.interval)), Math.max(...rows.map(r => r.interval))],
      tracers: [...new Set(rows.map(r => r.tracer))],
      hudLit: [Math.min(...rows.map(r => r.hudLit)), Math.max(...rows.map(r => r.hudLit))],
      hudHot: rows.some(r => r.hudHot),
    };
  }
  delete R.smg; // keep the report compact: the summary has the numbers
  R.dmgEvents = R._dmg;
  R.beams = g.railBeams ? 'ok' : 'none';
}
