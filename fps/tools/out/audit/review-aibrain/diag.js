// Diagnostic scenario: instruments every bot's brain / nav and logs anomalies.
// Player is kept out of the way (god, idle, teleported to a spawn far from action is not needed).
import * as THREE from 'three';
const LOG = [];
const _go = new THREE.Vector3(), _gd = new THREE.Vector3(0, -1, 0);
const stat = {
  stuckRecover: 0, rescue: 0, teleports: 0, ignoredSets: [], pathReq: 0, pathNull: 0, pathNullAir: 0,
  stateTime: {}, idleStuck: [], unreachableAir: 0, unreachableGround: 0, findPathNullNoNode: 0, findPathNullComp: 0,
  drops: 0, padUses: 0,
};
const samples = new Map();

function groundGap(game, pos) {
  const r = game.world.collision.raycast(_go.set(pos.x, pos.y + 0.3, pos.z), _gd, 60);
  return r ? r.distance - 0.3 : 99;
}

export function setup(game, report) {
  report.custom = report.custom || {};
  const nav = game.world.nav;
  const origFind = nav.findPath.bind(nav);
  nav.findPath = function (from, to) {
    const s = this.nearestNode(from, 8), g = this.nearestNode(to, 8);
    const res = origFind(from, to);
    if (!res) {
      if (!s || !g) stat.findPathNullNoNode++;
      else if (s.comp !== g.comp) stat.findPathNullComp++;
      if (!s || !g) LOG.push(`t=${game.time.toFixed(1)} findPath null: s=${!!s} g=${!!g} from=${from.x.toFixed(1)},${from.y.toFixed(1)},${from.z.toFixed(1)} to=${to.x.toFixed(1)},${to.y.toFixed(1)},${to.z.toFixed(1)}`);
    }
    return res;
  };
  for (const bot of game.bots.list) {
    const br = bot.brain;
    const nv = br.nav;
    const oRec = br.recoverStuck.bind(br);
    br.recoverStuck = function (t) { stat.stuckRecover++; LOG.push(`t=${t.toFixed(1)} ${bot.name} recoverStuck stage=${this.stuckStage + 1} state=${this.state} navmode=${nv.mode} pos=${bot.position.x.toFixed(1)},${bot.position.y.toFixed(1)},${bot.position.z.toFixed(1)}`); return oRec(t); };
    const oRes = br.rescue.bind(br);
    br.rescue = function () { const r = oRes(); if (r) { stat.rescue++; LOG.push(`t=${game.time.toFixed(1)} ${bot.name} RESCUE teleport state=${this.state}`); } return r; };
    const oIg = br._ignored.set.bind(br._ignored);
    br._ignored.set = function (k, v) {
      const gap = groundGap(game, bot.position);
      stat.ignoredSets.push({ t: +game.time.toFixed(1), bot: bot.name, pickup: k.type + (k.weapon ? ':' + k.weapon : ''), dur: +(v - game.time).toFixed(0), air: !bot.onGround, gap: +gap.toFixed(1), state: br.state, navmode: nv.mode, unreachable: nv.unreachable });
      return oIg(k, v);
    };
    const oReq = nv._requestPath.bind(nv);
    nv._requestPath = function () {
      const before = this.mode;
      oReq();
      if (this.mode === 'direct' && !this.path) {
        // request ran (budget available) and produced no path
      }
    };
  }
  report.custom.setupDone = true;
}

let lastSample = -1;
export function drive(t, dt, game, report) {
  if (t - lastSample < 0.5) return;
  lastSample = t;
  for (const bot of game.bots.list) {
    if (!bot.alive) { samples.delete(bot); continue; }
    const br = bot.brain;
    stat.stateTime[br.state] = (stat.stateTime[br.state] || 0) + 0.5;
    let s = samples.get(bot);
    if (!s) { s = { x: bot.position.x, z: bot.position.z, y: bot.position.y, since: t }; samples.set(bot, s); continue; }
    const moved = Math.hypot(bot.position.x - s.x, bot.position.z - s.z);
    if (moved > 0.6) { s.x = bot.position.x; s.z = bot.position.z; s.y = bot.position.y; s.since = t; }
    else if (t - s.since > 6) {
      stat.idleStuck.push({ t: +t.toFixed(1), bot: bot.name, state: br.state, navmode: br.nav.mode, hasGoal: br.nav.hasGoal, arrived: br.nav.arrived, searching: br.searching, pos: bot.position.toArray().map(v => +v.toFixed(1)), goal: br.nav.goal.toArray().map(v => +v.toFixed(1)), wait: +(br.waitUntil - t).toFixed(1), speed: +br.intent.speed.toFixed(1) });
      s.since = t;
    }
  }
}

export function finish(game, report) {
  report.custom.stat = stat;
  report.custom.log = LOG.slice(0, 80);
  report.custom.nav = game.world.nav.stats;
  report.custom.pathStats = game.bots.pathStats;
}
