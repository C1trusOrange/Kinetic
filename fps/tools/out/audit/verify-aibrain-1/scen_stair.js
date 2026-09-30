// Verifier: random ground->upper-level nav trips, unpatched vs. "jump waypoints not moved by pullFromEdges" (patched).
import { BotNav, pullFromEdges, probeMove } from '/src/ai/BotNav.js';
const f = v => +v.toFixed(2);
const nap = () => new Promise(r => setTimeout(r, 0));
async function step(game, seconds, dt, cb) {
  const n = Math.round(seconds / dt);
  for (let i = 0; i < n; i++) { game.update(dt); if (cb && cb(i, dt) === false) return; if (i % 240 === 239) await nap(); }
}
let seed = 777; const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
export async function setup(game, report) {
  const C = report.custom = { variants: {} };
  game.autotest.duration = 1e9;
  const DT = 1 / parseFloat(game.params.get('sfps') || '30');
  const JIT = parseFloat(game.params.get('jit') || '0');
  const NP = parseInt(game.params.get('np') || '20', 10);
  try {
    const bots = game.bots.list;
    for (let i = 1; i < bots.length; i++) { bots[i].alive = false; bots[i].model.setVisible(false); bots[i].respawnAt = -1; }
    game.player.alive = false; game.player.respawnAt = -1;
    const bot = bots[0]; bot.god = true;
    const br = bot.brain, nav = br.nav;
    br.perceive = () => {}; br.think = () => {};
    br.computeMovement = function (dt, t) { const it = this.intent; it.moveX = 0; it.moveZ = 0; it.speed = 0; if (t < this.unstickUntil) { it.moveX = this.unstickDir.x; it.moveZ = this.unstickDir.y; const l = Math.hypot(it.moveX, it.moveZ) || 1; it.moveX /= l; it.moveZ /= l; it.speed = 7; return; } this.moveNav(dt, 7.2); if (t < this.forceJumpUntil && bot.onGround) it.jump = true; };
    br.rescue = () => false;
    const wn = game.world.nav;
    // pairs
    const low = wn._main.filter(n => n.position.y < 0.6), high = wn._main.filter(n => n.position.y > 4.5 && n.position.y < 11);
    const pairs = [];
    let guard = 0;
    while (pairs.length < NP && guard++ < 5000) {
      const a = low[Math.floor(rnd() * low.length)], b = high[Math.floor(rnd() * high.length)];
      const d = Math.hypot(a.position.x - b.position.x, a.position.z - b.position.z);
      if (d < 8 || d > 45) continue;
      if (!wn.isConnected(a, b)) continue;
      pairs.push([a.position.clone(), b.position.clone()]);
    }
    if (game.params.get('a') && game.params.get('g')) {
      pairs.length = 0;
      const A = game.params.get('a').split(',').map(Number), G = game.params.get('g').split(',').map(Number);
      const V = game.player.position.constructor;
      for (let r = 0; r < NP; r++) pairs.push([new V(...A), new V(...G)]);
    }
    C.map = game.world.mapId; C.pairs = pairs.length; C.dt = DT;
    let inv = 0;
    const oInv = BotNav.prototype.invalidate;
    BotNav.prototype.invalidate = function () { inv++; return oInv.call(this); };
    const origReq = BotNav.prototype._requestPath;
    const patchedReq = (() => {
      let src = origReq.toString();
      const b0 = src;
      src = src.replace('pullFromEdges(game.world.collision, p);', 'const _j = p.map(w => (w.type === "jump" && !w.pad) ? w : null); pullFromEdges(game.world.collision, p); for (let i = 0; i < p.length; i++) if (_j[i]) p[i] = _j[i];');
      if (src === b0) throw new Error('patch failed');
      return new Function('pullFromEdges', 'return {' + src + '}._requestPath')(pullFromEdges);
    })();
    for (const variant of ['unpatched', 'jumpExempt']) {
      BotNav.prototype._requestPath = variant === 'unpatched' ? origReq : patchedReq;
      const res = [];
      for (const [a, g] of pairs) {
        bot.velocity.set(0, 0, 0);
        bot.teleportTo(a.clone().add({ x: 0, y: 0.02, z: 0 }), 0);
        await step(game, 0.3, DT);
        nav.clear(); nav.setGoal(g.clone(), 1.4, 0.5);
        inv = 0;
        let ok = false, t = 0, stuckN = 0;
        const oRec = br.recoverStuck; br.recoverStuck = function (tt) { stuckN++; return oRec.call(this, tt); };
        await step(game, 40, DT, (i, dt) => {
          t += dt;
          if (nav.arrived || (Math.hypot(bot.position.x - g.x, bot.position.z - g.z) < 1.6 && Math.abs(bot.position.y - g.y) < 1.5)) { ok = true; return false; }
          return true;
        });
        br.recoverStuck = oRec;
        res.push({ ok, t: f(t), inv, stuck: stuckN, a: a.toArray().map(f), g: g.toArray().map(f) });
      }
      C.variants[variant] = { n: res.length, ok: res.filter(r => r.ok).length, avgT: f(res.reduce((s, r) => s + r.t, 0) / Math.max(1, res.length)), totalInv: res.reduce((s, r) => s + r.inv, 0), totalStuck: res.reduce((s, r) => s + r.stuck, 0), slow: res.filter(r => !r.ok || r.t > 20 || r.inv > 4).map(r => `${r.ok ? 'ok' : 'FAIL'} t${r.t} inv${r.inv} stuck${r.stuck} ${r.a}->${r.g}`), all: res.map(r => `${r.ok ? 'ok' : 'FAIL'}:${r.t}:i${r.inv}:s${r.stuck}`) };
    }
    BotNav.prototype._requestPath = origReq; BotNav.prototype.invalidate = oInv;
  } catch (err) { C.error = String(err && err.stack || err); console.error('[scen_stair]', err); }
  game.autotest.duration = 0;
}
export function drive() {}
