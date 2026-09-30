// Headless-ish simulation harness: steps game.update() synchronously inside setup() (no rendering between steps).
// ?test=navwalk|fight  &trials=N  &simtime=S
import * as THREE from 'three';

const nap = () => new Promise(r => setTimeout(r, 0));
const _go = new THREE.Vector3(), _gd = new THREE.Vector3(0, -1, 0);
const fmt = v => `${v.x.toFixed(1)},${v.y.toFixed(1)},${v.z.toFixed(1)}`;

function groundGap(game, pos) {
  const r = game.world.collision.raycast(_go.set(pos.x, pos.y + 0.3, pos.z), _gd, 60);
  return r ? r.distance - 0.3 : 99;
}

let DT = 1 / 60;
async function step(game, seconds, dt = DT, cb = null) {
  const n = Math.round(seconds / dt);
  for (let i = 0; i < n; i++) {
    game.update(dt);
    if (cb && cb(i, dt) === false) return i;
    if (i % 240 === 239) await nap();
  }
  return n;
}

// ---------------------------------------------------------------- navwalk
async function navwalk(game, report) {
  const P = game.params;
  const trials = parseInt(P.get('trials') || '40', 10);
  const nav = game.world.nav;
  const bots = game.bots.list;
  const bot = bots[0];
  for (let i = 1; i < bots.length; i++) { bots[i].alive = false; bots[i].model.setVisible(false); bots[i].respawnAt = -1; }
  bot.god = true;
  const br = bot.brain;
  br.perceive = () => {};
  br.think = () => {};
  br.computeMovement = function (dt, t) {
    const it = this.intent;
    it.moveX = 0; it.moveZ = 0; it.speed = 0;
    this.moveNav(dt, 7.2);
  };
  let stuckEvents = 0, rescues = 0;
  const oRec = br.recoverStuck.bind(br);
  br.recoverStuck = function (t) { stuckEvents++; return oRec(t); };
  const oRes = br.rescue.bind(br);
  br.rescue = function () { const r = oRes(); if (r) rescues++; return r; };
  game.player.alive = false;
  game.player.respawnAt = -1;

  const results = [];
  const main = nav._main;
  for (let k = 0; k < trials; k++) {
    const A = main[Math.floor(Math.random() * main.length)];
    const B = main[Math.floor(Math.random() * main.length)];
    if (A === B) { k--; continue; }
    bot.velocity.set(0, 0, 0);
    bot.teleportTo(A.position, 0);
    await step(game, 0.4);
    // The bot must stand on the node now (settle)
    const path = nav.findPath(A.position, B.position);
    const pathLen = path ? path.reduce((s, p, i) => s + p.distanceTo(i ? path[i - 1] : A.position), 0) : -1;
    const pathTypes = path ? path.map(p => p.type).join(',') : '';
    br.nav.clear();
    br.nav.setGoal(B.position, 1.2, 2.5);
    const s0 = stuckEvents;
    const goalPos = B.position.clone();
    let arrivedT = -1, minY = 1e9, t0 = game.time;
    const limit = Math.max(20, (pathLen > 0 ? pathLen : 60) / 5 + 12);
    let elapsed = 0;
    let modeFlips = 0, lastMode = br.nav.mode;
    await step(game, limit, DT, (i, dt) => {
      elapsed += dt;
      minY = Math.min(minY, bot.position.y);
      if (br.nav.mode !== lastMode) { modeFlips++; lastMode = br.nav.mode; }
      if (br.nav.arrived) { arrivedT = elapsed; return false; }
      return true;
    });
    const dist = Math.hypot(bot.position.x - goalPos.x, bot.position.z - goalPos.z);
    results.push({
      k, A: fmt(A.position), B: fmt(B.position), pathLen: +pathLen.toFixed(1), pathNull: !path, arrived: arrivedT >= 0, t: +arrivedT.toFixed(1),
      distEnd: +dist.toFixed(1), dyEnd: +(bot.position.y - goalPos.y).toFixed(1), stuck: stuckEvents - s0, modeFlips, minDy: +(minY - Math.min(A.position.y, B.position.y)).toFixed(1), types: pathTypes.slice(0, 60),
      unreachable: br.nav.unreachable,
    });
  }
  const ok = results.filter(r => r.arrived).length;
  report.custom.navwalk = {
    trials, ok, fail: results.filter(r => !r.arrived && !r.pathNull).length, pathNull: results.filter(r => r.pathNull).length,
    stuckEvents, rescues, failures: results.filter(r => !r.arrived).slice(0, 25), slow: results.filter(r => r.arrived && r.pathLen > 0 && r.t > r.pathLen / 4 + 8).slice(0, 10),
  };
}

// ---------------------------------------------------------------- fight
async function fight(game, report) {
  const P = game.params;
  const simtime = parseFloat(P.get('simtime') || '300');
  const bots = game.bots.list;
  const stat = {
    stuckRecover: 0, stuckList: [], rescue: [], ignoredSets: [], stateTime: {}, idleStuck: [], findPathNull: [], repath: 0, pathReq: 0, stateFlips: 0,
    kills: 0, deaths: 0, falls: 0,
  };
  const nav = game.world.nav;
  const origFind = nav.findPath.bind(nav);
  nav.findPath = function (from, to) {
    const res = origFind(from, to);
    if (!res && stat.findPathNull.length < 30) stat.findPathNull.push(`t=${game.time.toFixed(0)} from=${fmt(from)} to=${fmt(to)} sNode=${!!this.nearestNode(from, 8)} gNode=${!!this.nearestNode(to, 8)}`);
    return res;
  };
  game.player.god = true;
  stat.selfDamage = {}; stat.friendlyAttempts = 0; stat.shotsAtProtected = 0; stat.suicides = {}; stat.chaseUnreach = 0; stat.chaseTime = 0; stat.grenadesThrown = 0;
  game.events.on('damage', e => { if (e.attacker && e.attacker === e.target && e.attacker.isBot) stat.selfDamage[e.weapon] = (stat.selfDamage[e.weapon] || 0) + Math.round(e.amount); });
  game.events.on('death', e => { if (e.attacker === e.victim && e.victim.isBot) stat.suicides[e.weapon] = (stat.suicides[e.weapon] || 0) + 1; });
  const oApply = game.combat.applyDamage.bind(game.combat);
  game.combat.applyDamage = function (t, info) { const a = info.attacker; if (a && a.isBot && a !== t && a.team === t.team) stat.friendlyAttempts++; return oApply(t, info); };
  for (const bot of bots) {
    const oFire = bot._fire.bind(bot);
    bot._fire = function (def, inv) { const r = this.brain.targetRec; if (r && r.ent.isProtected && r.ent.isProtected() && r.ent.spawnProtectedUntil - game.time > 0.3) stat.shotsAtProtected++; return oFire(def, inv); };
    const oGr = bot.throwGrenade.bind(bot);
    bot.throwGrenade = function (v, fuse) { const r = oGr(v, fuse); if (r) stat.grenadesThrown++; return r; };
    const br = bot.brain;
    const nv = br.nav;
    const oRec = br.recoverStuck.bind(br);
    br.recoverStuck = function (t) {
      stat.stuckRecover++;
      const w = nv.path && nv.path[nv.index];
      if (stat.stuckList.length < 400) stat.stuckList.push({ t: +t.toFixed(0), bot: bot.name, st: this.state, mode: nv.mode, pos: fmt(bot.position), wp: w ? fmt(w) + ':' + w.type + (w.pad ? '*' : '') : null, idx: nv.index, len: nv.path ? nv.path.length : 0, goal: fmt(nv.goal), stage: this.stuckStage + 1, tgt: this.targetRec ? (this.targetRec.visible ? 'vis' : 'mem') : '-' });
      return oRec(t);
    };
    const oRes = br.rescue.bind(br);
    br.rescue = function () { const r = oRes(); if (r) stat.rescue.push(`t=${game.time.toFixed(0)} ${bot.name} state=${this.state} stage=${this.stuckStage}`); return r; };
    const oIg = br._ignored.set.bind(br._ignored);
    br._ignored.set = function (k, v) {
      stat.ignoredSets.push({ t: +game.time.toFixed(1), bot: bot.name, pickup: k.type + (k.weapon ? ':' + k.weapon : ''), dur: +(v - game.time).toFixed(0), air: !bot.onGround, gap: +groundGap(game, bot.position).toFixed(1), state: br.state, navmode: nv.mode, unreachable: nv.unreachable });
      return oIg(k, v);
    };
    const oEnter = br.enterState.bind(br);
    br.enterState = function (n, t) { if (n !== this.state) stat.stateFlips++; return oEnter(n, t); };
    const oReq = nv._requestPath.bind(nv);
    nv._requestPath = function () { stat.pathReq++; return oReq(); };
  }
  const samples = new Map();
  let nextSample = 0;
  let sec = 0;
  await step(game, simtime, DT, (i, dt) => {
    sec += dt;
    if (sec < 0.5) return true;
    sec = 0;
    const t = game.time;
    for (const bot of bots) {
      if (!bot.alive) { samples.delete(bot); continue; }
      const br = bot.brain;
      stat.stateTime[br.state] = (stat.stateTime[br.state] || 0) + 0.5;
      if (br.state === 'chase') { stat.chaseTime += 0.5; if (br.nav.mode === 'direct' && br.nav.unreachable) stat.chaseUnreach += 0.5; }
      let s = samples.get(bot);
      if (!s) { samples.set(bot, { x: bot.position.x, z: bot.position.z, since: t }); continue; }
      const moved = Math.hypot(bot.position.x - s.x, bot.position.z - s.z);
      if (moved > 0.6) { s.x = bot.position.x; s.z = bot.position.z; s.since = t; }
      else if (t - s.since > 8 && stat.idleStuck.length < 40) {
        stat.idleStuck.push({ t: +t.toFixed(0), bot: bot.name, state: br.state, navmode: br.nav.mode, hasGoal: br.nav.hasGoal, arrived: br.nav.arrived, searching: br.searching, pos: fmt(bot.position), goal: fmt(br.nav.goal), wait: +(br.waitUntil - t).toFixed(1), speed: +br.intent.speed.toFixed(1), hp: Math.round(bot.health) });
        s.since = t;
      }
    }
    return true;
  });
  stat.kills = bots.reduce((a, b) => a + b.kills, 0);
  stat.deaths = bots.reduce((a, b) => a + b.deaths, 0);
  stat.ignoredSets = stat.ignoredSets.slice(0, 40);
  const cl = new Map();
  for (const e of stat.stuckList) { const [x, y, z] = e.pos.split(',').map(Number); const k = `${Math.round(x / 3) * 3},${Math.round(y)},${Math.round(z / 3) * 3}`; const c = cl.get(k) || { n: 0, ex: e }; c.n++; cl.set(k, c); }
  stat.stuckClusters = [...cl.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, 12).map(([k, v]) => ({ cell: k, n: v.n, ex: v.ex }));
  report.custom.fight = stat;
  report.custom.pathStats = game.bots.pathStats;
  report.custom.navStats = nav.stats;
}

export async function setup(game, report) {
  report.custom = report.custom || {};
  game.autotest.duration = 1e9;
  const test = game.params.get('test') || 'fight';
  DT = 1 / parseFloat(game.params.get('fps') || '60');
  const t0 = performance.now();
  try {
    if (test === 'navwalk') await navwalk(game, report);
    else await fight(game, report);
  } catch (err) {
    console.error('[sim] failed', err);
    report.custom.error = String(err && err.stack || err);
  }
  report.custom.wallMs = Math.round(performance.now() - t0);
  report.custom.simTime = +game.time.toFixed(1);
  game.autotest.duration = 0;
}

export function drive() {}
