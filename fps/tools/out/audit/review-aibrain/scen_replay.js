// Replay one start->goal trial with a single bot and full path logging.
import { BotNav, probeMove } from '/src/ai/BotNav.js';
import { BotBrain } from '/src/ai/BotBrain.js';
const LOG = [];
let bot, br, goal;
const f = (v) => +v.toFixed(2);
export async function setup(game, report) {
  report.custom = { log: LOG };
  const p = game.params;
  const s = p.get('s').split(',').map(Number), g = p.get('g').split(',').map(Number);
  goal = { x: g[0], y: g[1], z: g[2] };
  for (const b of game.bots.list.slice(1)) { b.alive = false; b.model && b.model.setVisible(false); }
  bot = game.bots.list[0]; br = bot.brain; bot.god = true;
  br.think = function () {}; br.perceive = function () {};
  BotBrain.prototype.rescue = function () { LOG.push({ ev: 'rescue' }); return false; };
  if (game.params.get('patchpad')) {
    let src = BotNav.prototype._followPath.toString();
    const before = src;
    src = src.replace('if (dy > 1.3 && dy > d * 0.75) {', 'if (dy > 1.3 && dy > d * 0.75 && !wp.pad) {');
    if (src === before) throw new Error('patch failed');
    BotNav.prototype._followPath = new Function('probeMove', 'return {' + src + '}._followPath')(probeMove);
  }
  const oReq = BotNav.prototype._requestPath;
  BotNav.prototype._requestPath = function () {
    const bud = game.bots._pathBudgetMs > 0;
    oReq.call(this);
    if (!bud) return;
    LOG.push({ ev: 'req', t: f(game.time), pos: bot.position.toArray().map(f), g: bot.onGround, unreach: this.unreachable, mode: this.mode,
      path: this.path ? this.path.map(w => [w.x, w.y, w.z].map(f).join(',') + ':' + w.type + (w.pad ? '*' : '')) : null });
  };
  const oInv = BotNav.prototype.invalidate;
  BotNav.prototype.invalidate = function () {
    const wp = this.path && this.path[this.index];
    LOG.push({ ev: 'inv', t: f(game.time), pos: bot.position.toArray().map(f), idx: this.index, wp: wp ? [wp.x, wp.y, wp.z].map(f).join(',') + ':' + wp.type : null, at: (new Error().stack.split('\n')[2] || '').trim().replace(/http:\/\/[^/]+/, '') });
    return oInv.call(this);
  };
  bot.teleportTo({ x: s[0], y: s[1] + 0.02, z: s[2], clone() { return this; } }, 0);
  bot.position.set(s[0], s[1] + 0.02, s[2]); bot._syncCapsule();
  br.state = 'roam'; br.waitUntil = 0;
  br.nav.clear();
  br.nav.setGoal({ x: goal.x, y: goal.y, z: goal.z, isVector3: true, copy() {}, }, 1.4, 0.5);
  br.nav.goal.set(goal.x, goal.y, goal.z);
}
export function drive(t, dt, game, report) {
  br.state = 'roam'; br.waitUntil = 0;
  if (Math.floor(t * 4) !== Math.floor((t - dt) * 4) && t < 40) {
    const n = br.nav;
    LOG.push({ ev: 'tick', t: f(t), pos: bot.position.toArray().map(f), vy: f(bot.velocity.y), g: bot.onGround, mode: n.mode, idx: n.index, len: n.path ? n.path.length : 0, arr: n.arrived,
      mv: [f(br.intent.moveX), f(br.intent.moveZ), f(br.intent.speed)], j: br.intent.jump });
  }
}
