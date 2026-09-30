// Foundry route (-12.5,5,-4.4) -> (-3.5,9.5,-20.5): jump waypoint displaced by pullFromEdges. Unpatched vs patched.
import { BotNav, probeMove, pullFromEdges } from '/src/ai/BotNav.js';
const f = v => +v.toFixed(2);
let DT = 1 / 60;
const nap = () => new Promise(r => setTimeout(r, 0));
async function step(game, seconds, dt, cb) {
  const n = Math.round(seconds / dt);
  for (let i = 0; i < n; i++) { game.update(dt); if (cb && cb(i, dt) === false) return; if (i % 240 === 239) await nap(); }
}
async function trials(game, label, N, from, to) {
  const bot = game.bots.list[0], br = bot.brain, nav = br.nav;
  const out = [];
  let inv = 0, req = 0;
  const oInv = nav.invalidate.bind(nav); nav.invalidate = () => { inv++; return oInv(); };
  const oReq = nav._requestPath.bind(nav); nav._requestPath = function () { const b = game.bots._pathBudgetMs > 0; oReq(); if (b) req++; };
  for (let k = 0; k < N; k++) {
    bot.velocity.set(0, 0, 0);
    bot.teleportTo(new bot.position.constructor(from[0], from[1] + 0.02, from[2]), 0);
    await step(game, 0.3, DT);
    nav.clear(); nav.setGoal(new bot.position.constructor(to[0], to[1], to[2]), 1.4, 0.5);
    inv = 0; req = 0;
    let ok = false, t = 0;
    await step(game, 25, DT, (i, dt) => { t += dt; if (nav.arrived) { ok = true; return false; } return true; });
    out.push({ ok, t: f(t), inv, req, end: [f(bot.position.x), f(bot.position.y), f(bot.position.z)] });
  }
  nav.invalidate = oInv; nav._requestPath = oReq;
  return { label, ok: out.filter(o => o.ok).length, N, avgT: f(out.reduce((s, o) => s + o.t, 0) / N), avgInv: f(out.reduce((s, o) => s + o.inv, 0) / N), avgReq: f(out.reduce((s, o) => s + o.req, 0) / N), out };
}
export async function setup(game, report) {
  const C = report.custom = {};
  game.autotest.duration = 1e9;
  DT = 1 / parseFloat(game.params.get('fps') || '60');
  try {
    const bots = game.bots.list;
    for (let i = 1; i < bots.length; i++) { bots[i].alive = false; bots[i].model.setVisible(false); bots[i].respawnAt = -1; }
    game.player.alive = false; game.player.respawnAt = -1;
    const bot = bots[0]; bot.god = true;
    const br = bot.brain;
    br.perceive = () => {}; br.think = () => {};
    br.computeMovement = function (dt, t) { const it = this.intent; it.moveX = 0; it.moveZ = 0; it.speed = 0; this.moveNav(dt, 7.2); };
    br.rescue = () => false;
    const from = (game.params.get('from') || '-12.5,5,-4.4').split(',').map(Number), to = (game.params.get('to') || '-3.5,9.5,-20.5').split(',').map(Number);
    const N = parseInt(game.params.get('n') || '5', 10);
    C.unpatched = await trials(game, 'unpatched', N, from, to);
    let src = BotNav.prototype._requestPath.toString();
    const before = src;
    src = src.replace('pullFromEdges(game.world.collision, p);', 'pfe(game.world.collision, p);');
    if (src === before) throw new Error('patch failed');
    const pfe = (col, path) => { const js = path.filter(w => w.type === 'jump' && !w.pad); js.forEach(w => { w.pad = true; }); pullFromEdges(col, path); js.forEach(w => { delete w.pad; }); return path; };
    const orig = BotNav.prototype._requestPath;
    BotNav.prototype._requestPath = new Function('performance', 'console', 'pfe', 'return {' + src + '}._requestPath')(performance, console, pfe);
    C.patchedJumpNotMoved = await trials(game, 'jump waypoints exempt from pullFromEdges', N, from, to);
    BotNav.prototype._requestPath = orig;
  } catch (err) { C.error = String(err && err.stack || err); console.error('[jumptest]', err); }
  game.autotest.duration = 0;
}
export function drive() {}
