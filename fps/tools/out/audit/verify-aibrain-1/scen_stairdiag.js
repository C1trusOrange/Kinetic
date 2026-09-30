// Verifier: trace of invalidate() calls on the foundry west stair route (unpatched code).
import { BotNav, pullFromEdges } from '/src/ai/BotNav.js';
const f = v => +v.toFixed(2);
const nap = () => new Promise(r => setTimeout(r, 0));
export async function setup(game, report) {
  const C = report.custom = { inv: [], reqs: [] };
  game.autotest.duration = 1e9;
  const DT = 1 / parseFloat(game.params.get('sfps') || '60');
  try {
    const bots = game.bots.list;
    for (let i = 1; i < bots.length; i++) { bots[i].alive = false; bots[i].model.setVisible(false); bots[i].respawnAt = -1; }
    game.player.alive = false; game.player.respawnAt = -1;
    const bot = bots[0]; bot.god = true;
    const br = bot.brain, nav = br.nav;
    br.perceive = () => {}; br.think = () => {};
    br.computeMovement = function (dt, t) { const it = this.intent; it.moveX = 0; it.moveZ = 0; it.speed = 0; this.moveNav(dt, 7.2); };
    br.rescue = () => false;
    const V = game.player.position.constructor;
    const A = new V(-12.49, 5, -4.49), G = new V(-3.5, 9.5, -20.5);
    const wn = game.world.nav;
    // raw route vs pulled
    const raw = wn.findPath(A, G);
    C.raw = raw.slice(0, 4).map(w => [f(w.x), f(w.y), f(w.z), w.type].join(' '));
    const pulled = raw.map(w => { const c = w.clone(); c.type = w.type; return c; });
    pullFromEdges(game.world.collision, pulled);
    C.pulled = pulled.slice(0, 4).map(w => [f(w.x), f(w.y), f(w.z), w.type].join(' '));
    const oInv = BotNav.prototype.invalidate;
    BotNav.prototype.invalidate = function () {
      const wp = this.path && this.path[this.index];
      const p = bot.position;
      if (C.inv.length < 60) C.inv.push({ t: f(game.time), pos: [f(p.x), f(p.y), f(p.z)], g: bot.onGround, idx: this.index, len: this.path ? this.path.length : 0, wp: wp ? [f(wp.x), f(wp.y), f(wp.z), wp.type].join(' ') : null, dy: wp ? f(wp.y - p.y) : null, d: wp ? f(Math.hypot(wp.x - p.x, wp.z - p.z)) : null, at: (new Error().stack.split('\n')[2] || '').trim().replace(/^.*\//, '') });
      return oInv.call(this);
    };
    C.trials = [];
    const NT = parseInt(game.params.get('nt') || '3', 10);
    const settle = parseInt(game.params.get('settle') || '9', 10);
    for (let k = 0; k < NT; k++) {
    C.inv.push('--- trial ' + k);
    bot.velocity.set(0, 0, 0);
    bot.teleportTo(A.clone().add({ x: 0, y: 0.02, z: 0 }), 0);
    for (let i = 0; i < settle; i++) game.update(DT);
    nav.clear(); nav.setGoal(G.clone(), 1.4, 0.5);
    let t = 0, ok = false;
    for (let i = 0; i < 25 / DT; i++) {
      game.update(DT); t += DT;
      if (i % 240 === 239) await nap();
      if (nav.arrived || (Math.hypot(bot.position.x - G.x, bot.position.z - G.z) < 1.6 && Math.abs(bot.position.y - G.y) < 1.5)) { ok = true; break; }
    }
    C.trials.push({ ok, t: f(t) });
    }
    BotNav.prototype.invalidate = oInv;
  } catch (err) { C.error = String(err && err.stack || err); }
  game.autotest.duration = 0;
}
export function drive() {}
