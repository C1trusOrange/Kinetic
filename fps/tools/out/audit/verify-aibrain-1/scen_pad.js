// Verifier: bot (isolated brain, moveNav only) walks toward the landing platform of each jump pad.
import { BotNav, probeMove } from '/src/ai/BotNav.js';
const f = v => +v.toFixed(2);
const nap = () => new Promise(r => setTimeout(r, 0));
async function step(game, seconds, dt, cb) {
  const n = Math.round(seconds / dt);
  for (let i = 0; i < n; i++) { game.update(dt); if (cb && cb(i, dt) === false) return; if (i % 240 === 239) await nap(); }
}
export async function setup(game, report) {
  const C = report.custom = { trials: [] };
  game.autotest.duration = 1e9;
  const DT = 1 / 60;
  try {
    const bots = game.bots.list;
    for (let i = 1; i < bots.length; i++) { bots[i].alive = false; bots[i].model.setVisible(false); bots[i].respawnAt = -1; }
    game.player.alive = false; game.player.respawnAt = -1;
    const bot = bots[0]; bot.god = true;
    const br = bot.brain, nav = br.nav;
    br.perceive = () => {}; br.think = () => {};
    br.computeMovement = function (dt, t) { const it = this.intent; it.moveX = 0; it.moveZ = 0; it.speed = 0; this.moveNav(dt, 7.2); };
    br.rescue = () => false;
    const world = game.world, wn = world.nav;
    let inv = [], reqs = [];
    const oInv = BotNav.prototype.invalidate;
    BotNav.prototype.invalidate = function () {
      const wp = this.path && this.path[this.index];
      inv.push({ t: f(game.time), y: f(bot.position.y), g: bot.onGround, idx: this.index, wp: wp ? [f(wp.x), f(wp.y), f(wp.z), wp.type, !!wp.pad].join(' ') : null, at: (new Error().stack.split('\n')[2] || '').trim().replace(/^.*\//, '') });
      return oInv.call(this);
    };
    const oReq = BotNav.prototype._requestPath;
    BotNav.prototype._requestPath = function () {
      const before = game.bots._pathBudgetMs;
      oReq.call(this);
      reqs.push({ t: f(game.time), y: f(bot.position.y), g: bot.onGround, vy: f(bot.velocity.y), unreach: this.unreachable, mode: this.mode, path: this.path ? this.path.slice(0, 4).map(w => [f(w.x), f(w.y), f(w.z), w.type, w.pad ? 'P' : ''].join(' ')) : null });
    };
    const patch = game.params.get('patch');
    if (patch) {
      let src = BotNav.prototype._followPath.toString();
      const b0 = src;
      src = src.replace('if (dy > 1.3 && dy > d * 0.75) {', 'if (dy > 1.3 && dy > d * 0.75 && !wp.pad) {');
      if (src === b0) throw new Error('patch failed');
      if (patch === '2') {
        const m = src;
        src = src.replace('if (d > 14 || (Math.abs(dy) > 4 && d < 3)) {', 'if ((d > 14 || (Math.abs(dy) > 4 && d < 3)) && !(this.game.time - this.bot.lastLaunchTime < 3.5)) {');
        if (src === m) throw new Error('patch2 failed');
      }
      BotNav.prototype._followPath = new Function('probeMove', 'return {' + src + '}._followPath')(probeMove);
    }
    const pads = world.jumpPads;
    C.pads = pads.map(p => ({ pos: p.position.toArray().map(f), target: p.target.toArray().map(f), vel: p.velocity.toArray().map(f) }));
    const only = game.params.get('pad');
    for (let pi = 0; pi < pads.length; pi++) {
      if (only !== null && +only !== pi) continue;
      const pad = pads[pi];
      const pn = wn.nearestNode(pad.position, 2), tn = wn.nearestNode(pad.target, 3);
      if (!pn || !tn) continue;
      // starts: same-level main nodes 5-12 m from the pad node, connected to it
      const starts = wn._main.filter(n => Math.abs(n.position.y - pn.position.y) < 0.4 && n.position.distanceTo(pn.position) > 5 && n.position.distanceTo(pn.position) < 12 && wn.isConnected(n, pn));
      const goals = wn._main.filter(n => Math.abs(n.position.y - tn.position.y) < 0.6 && n.position.distanceTo(tn.position) < 6 && wn.isConnected(tn, n));
      const nT = Math.min(5, starts.length);
      for (let k = 0; k < nT; k++) {
        const a = starts[Math.floor(k * starts.length / nT)];
        const g = goals[(k * 3) % Math.max(1, goals.length)];
        if (!a || !g || !wn.isConnected(a, g)) continue;
        bot.velocity.set(0, 0, 0);
        bot.teleportTo(a.position.clone().add({ x: 0, y: 0.02, z: 0 }), 0);
        await step(game, 0.3, DT);
        nav.clear(); nav.setGoal(g.position.clone(), 1.4, 0.5);
        inv = []; reqs = [];
        let ok = false, t = 0, air = 0, launched = 0, maxY = -1e9;
        const trace = [];
        let lastLaunch = -1;
        await step(game, 20, DT, (i, dt) => {
          t += dt;
          if (!bot.onGround) air += dt;
          if (bot.lastLaunchTime !== lastLaunch && bot.lastLaunchTime > 0) { lastLaunch = bot.lastLaunchTime; launched++; }
          maxY = Math.max(maxY, bot.position.y);
          if (Math.floor(t * 4) !== Math.floor((t - dt) * 4) && t < 20) {
            const wp = nav.path && nav.path[nav.index];
            trace.push([f(t), bot.position.toArray().map(f).join(','), 'vy' + f(bot.velocity.y), bot.onGround ? 'G' : 'A', nav.mode, 'i' + nav.index + '/' + (nav.path ? nav.path.length : 0), wp ? [f(wp.x), f(wp.y), f(wp.z), wp.type, wp.pad ? 'P' : ''].join(' ') : '-'].join(' | '));
          }
          if (nav.arrived || (Math.hypot(bot.position.x - g.position.x, bot.position.z - g.position.z) < 1.6 && Math.abs(bot.position.y - g.position.y) < 1.5)) { ok = true; return false; }
          return true;
        });
        C.trials.push({ pad: pi, k, ok, t: f(t), air: f(air), launched, inv: inv.length, invSites: inv.slice(0, 3), nreq: reqs.length, from: a.position.toArray().map(f), goal: g.position.toArray().map(f), reqs: reqs.slice(0, 12), trace });
      }
    }
    BotNav.prototype.invalidate = oInv; BotNav.prototype._requestPath = oReq;
    C.summary = pads.map((_, pi) => { const r = C.trials.filter(x => x.pad === pi); return { pad: pi, n: r.length, ok: r.filter(x => x.ok).length, avgT: f(r.reduce((s, x) => s + x.t, 0) / Math.max(1, r.length)), avgInv: f(r.reduce((s, x) => s + x.inv, 0) / Math.max(1, r.length)), avgAir: f(r.reduce((s, x) => s + x.air, 0) / Math.max(1, r.length)) }; });
  } catch (err) { C.error = String(err && err.stack || err); console.error('[scen_pad]', err); }
  game.autotest.duration = 0;
}
export function drive() {}
