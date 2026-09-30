// Path-following trials: every bot repeatedly walks from a random node to a random reachable node.
import { BotNav, probeMove, pullFromEdges } from '/src/ai/BotNav.js';
import { BotBrain } from '/src/ai/BotBrain.js';

const TRIALS = [];
const state = new Map();
let nav, world;
const cnt = { req: 0, stuck: 0, rescue: 0 };
let seed = 12345;
const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };

export async function setup(game, report) {
  report.custom = { trials: TRIALS, cnt };
  world = game.world; nav = world.nav;
  if (game.params.get('patchpad')) {
    let src = BotNav.prototype._followPath.toString();
    const before = src;
    src = src.replace('if (dy > 1.3 && dy > d * 0.75) {', 'if (dy > 1.3 && dy > d * 0.75 && !wp.pad) {');
    if (src === before) throw new Error('patch failed');
    BotNav.prototype._followPath = new Function('probeMove', 'return {' + src + '}._followPath')(probeMove);
    report.custom.patched = true;
  }
  if (game.params.get('patchjump')) {
    let src = BotNav.prototype._requestPath.toString();
    const before = src;
    src = src.replace('pullFromEdges(game.world.collision, p);', 'pfe(game.world.collision, p);');
    if (src === before) throw new Error('patch2 failed');
    const pfe = (col, path) => { const js = path.filter(w => w.type === 'jump' && !w.pad); js.forEach(w => { w.pad = true; }); pullFromEdges(col, path); js.forEach(w => { if (w.pad) delete w.pad; }); return path; };
    BotNav.prototype._requestPath = new Function('performance', 'console', 'pfe', 'return {' + src + '}._requestPath')(performance, console, pfe);
    report.custom.patchedJump = true;
  }
  report.custom.inv = {};
  report.custom.launch = { intended: 0, unintended: 0 };
  const BotProto = Object.getPrototypeOf(game.bots.list[0]);
  const oLaunch = BotProto.launch;
  BotProto.launch = function (v) {
    const path = this.brain && this.brain.nav.path;
    const intended = !!(path && path.some(w => w.pad));
    report.custom.launch[intended ? 'intended' : 'unintended']++;
    return oLaunch.call(this, v);
  };
  const oInv = BotNav.prototype.invalidate;
  BotNav.prototype.invalidate = function () {
    const wp = this.path && this.path[this.index];
    const at = ((new Error().stack || '').split(String.fromCharCode(10))[2] || '').trim().replace(/^.*\//, '');
    const b0 = this.bot; const post = (game.time - b0.lastLaunchTime) < 4 ? 'postLaunch' : 'noLaunch'; const key = (wp ? (wp.pad ? 'pad' : wp.type) : 'none') + ' ' + post;
    report.custom.inv[key] = (report.custom.inv[key] || 0) + 1;
    return oInv.call(this);
  };
  const oReq = BotNav.prototype._requestPath;
  BotNav.prototype._requestPath = function () { const b = game.bots._pathBudgetMs > 0; oReq.call(this); if (b) { const s = state.get(this.bot); if (s) s.req++; cnt.req++; } };
  const oRec = BotBrain.prototype.recoverStuck;
  BotBrain.prototype.recoverStuck = function (t) { const s = state.get(this.bot); if (s) s.stuck++; cnt.stuck++; return oRec.call(this, t); };
  BotBrain.prototype.rescue = function () { const s = state.get(this.bot); if (s) s.rescue++; cnt.rescue++; return false; };
  for (const b of game.bots.list) {
    const br = b.brain;
    br.think = function () {};
    br.perceive = function () {};
    b.god = true;
    state.set(b, { phase: 'new', req: 0, stuck: 0, rescue: 0, trial: null });
  }
}

let padQueue = null;
function buildPadQueue(game) {
  const q = [];
  const V = nav.nodes[0].position.constructor;
  for (let pi = 0; pi < world.jumpPads.length; pi++) {
    const pad = world.jumpPads[pi];
    const pn = nav.nearestNode(pad.position, 2);
    const tn = nav.nearestNode(pad.target, 3);
    if (!pn || !tn) continue;
    // candidate start nodes: same floor as the pad, 6..14 m away, walk-connected to the pad node
    const c = nav._main.filter(n => Math.abs(n.position.y - pn.position.y) < 0.4 && n.position.distanceTo(pn.position) > 6 && n.position.distanceTo(pn.position) < 14 && nav.isConnected(n, pn));
    for (let k = 0; k < 6 && c.length; k++) {
      const a = c[Math.floor(rnd() * c.length)];
      // goal: a node on the landing level, 5..14 m beyond the landing point
      const gc = nav._main.filter(n => Math.abs(n.position.y - tn.position.y) < 0.6 && n.position.distanceTo(tn.position) > 5 && n.position.distanceTo(tn.position) < 14 && nav.isConnected(tn, n) && nav.isConnected(a, n));
      if (!gc.length) continue;
      const g = gc[Math.floor(rnd() * gc.length)];
      q.push({ a, g, d: a.position.distanceTo(g.position), pad: pi });
    }
  }
  return q;
}
function pickTrial(b, game) {
  if (game.params.get('fs')) {
    const a = game.params.get('fs').split(',').map(Number), g = game.params.get('fg').split(',').map(Number);
    const V = nav.nodes[0].position.constructor;
    const na = nav.nearestNode(new V(...a), 3), ng = nav.nearestNode(new V(...g), 3);
    return { a: { position: new V(...a) }, g: { position: new V(...g) }, d: na.position.distanceTo(ng.position) };
  }
  if (game.params.get('pads')) {
    if (!padQueue) padQueue = buildPadQueue(game);
    return padQueue.shift() || null;
  }
  const main = nav._main;
  for (let k = 0; k < 200; k++) {
    const a = main[Math.floor(rnd() * main.length)];
    const g = main[Math.floor(rnd() * main.length)];
    const d = a.position.distanceTo(g.position);
    if (d < 20 || d > 70) continue;
    return { a, g, d };
  }
  return null;
}

export function drive(t, dt, game, report) {
  for (const b of game.bots.list) {
    const s = state.get(b);
    if (!s || !b.alive) continue;
    const br = b.brain, n = br.nav;
    if (s.phase === 'new') {
      const tr = pickTrial(b, game);
      if (!tr) continue;
      b.teleportTo(tr.a.position.clone().add({ x: 0, y: 0.02, z: 0 }), 0);
      br.state = 'roam'; br.waitUntil = 0;
      n.clear();
      n.setGoal(tr.g.position.clone(), 1.4, 0.5);
      s.phase = 'run'; s.t0 = t; s.req = 0; s.stuck = 0; s.rescue = 0; s.samples = []; s.lastSample = t;
      s.trial = { pad: tr.pad, bot: b.id, a: tr.a.position.toArray().map(v => +v.toFixed(1)), g: tr.g.position.toArray().map(v => +v.toFixed(1)), d: +tr.d.toFixed(1),
                  conn: nav.isConnected(tr.a.position, tr.g.position) };
      br.stuckCheckAt = game.time + 1;
    } else if (s.phase === 'run') {
      br.state = 'roam'; br.waitUntil = 0;
      if (t - s.lastSample >= 1) { s.lastSample = t; s.samples.push([+b.position.x.toFixed(1), +b.position.y.toFixed(1), +b.position.z.toFixed(1), n.mode, n.index, n.path ? n.path.length : 0]); }
      const g = s.trial.g;
      const dist = Math.hypot(b.position.x - g[0], b.position.z - g[2]);
      const dy = Math.abs(b.position.y - g[1]);
      const done = n.arrived || (dist < 1.6 && dy < 1.5);
      const el = t - s.t0;
      if (done || el > 25) {
        s.trial.ok = done; s.trial.time = +el.toFixed(1); s.trial.req = s.req; s.trial.stuck = s.stuck; s.trial.rescue = s.rescue;
        s.trial.finalDist = +dist.toFixed(1); s.trial.finalDy = +dy.toFixed(1);
        if (!done) s.trial.samples = s.samples;
        s.trial.speedAvg = +(s.trial.d / Math.max(0.1, el)).toFixed(1);
        TRIALS.push(s.trial);
        s.phase = 'new';
      }
    }
  }
}

export function finish(game, report) {
  const c = report.custom;
  c.n = TRIALS.length;
  c.ok = TRIALS.filter(x => x.ok).length;
  c.fail = TRIALS.filter(x => !x.ok);
  c.slow = TRIALS.filter(x => x.ok && x.time > (x.d / 4.5)).map(x => ({ ...x, samples: undefined }));
  c.stuckTrials = TRIALS.filter(x => x.stuck > 0).length;
  c.trials = TRIALS.map(x => ({ ok: x.ok, t: x.time, d: x.d, req: x.req, stuck: x.stuck }));
  c.nav = nav.stats;
}
