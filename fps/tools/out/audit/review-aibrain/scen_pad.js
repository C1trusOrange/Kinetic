// Trace what happens when a bot follows a path across a jump pad.
import { BotNav } from '/src/ai/BotNav.js';
const LOG = [];
export async function setup(game, report) {
  report.custom = { log: LOG };
  const origInv = BotNav.prototype.invalidate;
  BotNav.prototype.invalidate = function () {
    const b = this.bot;
    const wp = this.path && this.path[this.index];
    LOG.push({ ev: 'invalidate', t: +game.time.toFixed(2), bot: b.id, ground: b.onGround, pos: b.position.toArray().map(v => +v.toFixed(1)), idx: this.index, len: this.path && this.path.length,
      wp: wp ? [wp.x, wp.y, wp.z].map(v => +v.toFixed(1)).concat([wp.type, !!wp.pad]) : null, stack: (new Error().stack.split('\n')[2] || '').trim() });
    return origInv.call(this);
  };
  const origReq = BotNav.prototype._requestPath;
  BotNav.prototype._requestPath = function () {
    const b = this.bot;
    const bud = game.bots._pathBudgetMs > 0;
    origReq.call(this);
    if (!bud) return;
    LOG.push({ ev: 'req', t: +game.time.toFixed(2), bot: b.id, ground: b.onGround, vy: +b.velocity.y.toFixed(1), pos: b.position.toArray().map(v => +v.toFixed(1)), unreach: this.unreachable, mode: this.mode,
      path: this.path ? this.path.map(w => [w.x, w.y, w.z].map(v => +v.toFixed(1)).concat([w.type, !!w.pad]).join(' ')) : null, goal: this.goal.toArray().map(v => +v.toFixed(1)) });
  };
  // Put a bot next to pad 0 and give it a goal on the pad's landing platform.
  const pad = game.world.jumpPads[0];
  const bot = game.bots.list[0];
  report.custom.pad = { pos: pad.position.toArray(), target: pad.target.toArray(), vel: pad.velocity.toArray() };
  bot.teleportTo(pad.position.clone().add({ x: -6, y: 0.05, z: 0 }), 0);
  // disable other bots' influence
  for (const b of game.bots.list.slice(1)) { b.alive = false; b.model && b.model.setVisible(false); }
  const brain = bot.brain;
  brain.state = 'roam';
  brain.waitUntil = 0;
  brain.nav.setGoal(pad.target.clone(), 1.0, 0.5);
  brain.pickRoamGoal = function () { /* keep the goal */ };
  brain.chooseState = function () {};
  report.custom.bot = bot.id;
}
export function drive(t, dt, game, report) {
  const b = game.bots.list[0];
  const n = b.brain.nav;
  if (Math.floor(t * 4) !== Math.floor((t - dt) * 4) && t < 9) {
    LOG.push({ ev: 'tick', t: +t.toFixed(2), pos: b.position.toArray().map(v => +v.toFixed(1)), vy: +b.velocity.y.toFixed(1), g: b.onGround, mode: n.mode, idx: n.index, arrived: n.arrived, unreach: n.unreachable });
  }
}
