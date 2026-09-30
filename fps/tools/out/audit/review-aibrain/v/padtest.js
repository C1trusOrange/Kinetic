// Jump-pad path following, unpatched vs patched (wp.pad exempt from the "steep waypoint" invalidation).
import { BotNav, probeMove } from '/src/ai/BotNav.js';
const f = v => +v.toFixed(1);
let DT = 1 / 60;
const nap = () => new Promise(r => setTimeout(r, 0));
async function step(game, seconds, dt, cb) {
  const n = Math.round(seconds / dt);
  for (let i = 0; i < n; i++) { game.update(dt); if (cb && cb(i, dt) === false) return; if (i % 240 === 239) await nap(); }
}
let seed = 2024; const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };

function buildQueue(game) {
  const nav = game.world.nav, world = game.world, q = [];
  for (let pi = 0; pi < world.jumpPads.length; pi++) {
    const pad = world.jumpPads[pi];
    const pn = nav.nearestNode(pad.position, 2), tn = nav.nearestNode(pad.target, 3);
    if (!pn || !tn) continue;
    const c = nav._main.filter(n => Math.abs(n.position.y - pn.position.y) < 0.4 && n.position.distanceTo(pn.position) > 6 && n.position.distanceTo(pn.position) < 14 && nav.isConnected(n, pn));
    for (let k = 0; k < 5 && c.length; k++) {
      const a = c[Math.floor(rnd() * c.length)];
      const gc = nav._main.filter(n => Math.abs(n.position.y - tn.position.y) < 0.6 && n.position.distanceTo(tn.position) > 3 && n.position.distanceTo(tn.position) < 14 && nav.isConnected(tn, n) && nav.isConnected(a, n));
      if (!gc.length) continue;
      q.push({ a: a.position.clone(), g: gc[Math.floor(rnd() * gc.length)].position.clone(), pad: pi });
    }
  }
  return q;
}

async function runTrials(game, queue, label) {
  const bot = game.bots.list[0], br = bot.brain, nav = br.nav;
  const res = [];
  let inv = 0;
  const oInv = nav.invalidate.bind(nav);
  nav.invalidate = () => { inv++; return oInv(); };
  for (const tr of queue) {
    bot.velocity.set(0, 0, 0);
    bot.teleportTo(tr.a.clone().add({ x: 0, y: 0.02, z: 0 }), 0);
    await step(game, 0.3, DT);
    nav.clear(); nav.setGoal(tr.g, 1.4, 0.5);
    inv = 0;
    let ok = false, t = 0, air = 0;
    await step(game, 20, DT, (i, dt) => {
      t += dt;
      if (!bot.onGround) air += dt;
      if (nav.arrived || (Math.hypot(bot.position.x - tr.g.x, bot.position.z - tr.g.z) < 1.6 && Math.abs(bot.position.y - tr.g.y) < 1.5)) { ok = true; return false; }
      return true;
    });
    res.push({ pad: tr.pad, ok, t: f(t), inv, air: f(air), a: [f(tr.a.x), f(tr.a.y), f(tr.a.z)], g: [f(tr.g.x), f(tr.g.y), f(tr.g.z)] });
  }
  nav.invalidate = oInv;
  return { label, n: res.length, ok: res.filter(r => r.ok).length, avgT: f(res.reduce((s, r) => s + r.t, 0) / Math.max(1, res.length)), totalInv: res.reduce((s, r) => s + r.inv, 0), fails: res.filter(r => !r.ok).slice(0, 8), all: res.map(r => `${r.pad}:${r.ok ? 'ok' : 'FAIL'}:${r.t}s:inv${r.inv}`) };
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
    const queue = buildQueue(game);
    C.pads = game.world.jumpPads.length;
    C.unpatched = await runTrials(game, queue, 'unpatched');
    // patched: the steep-waypoint check must not apply to a jump-pad landing
    let src = BotNav.prototype._followPath.toString();
    const before = src;
    src = src.replace('if (dy > 1.3 && dy > d * 0.75) {', 'if (dy > 1.3 && dy > d * 0.75 && !wp.pad) {');
    if (src === before) throw new Error('patch failed');
    const mid = src;
    // site 2: "blown off the path" re-plan must not fire while flying a pad arc (launched < 3.5 s ago)
    src = src.replace('if (d > 14 || (Math.abs(dy) > 4 && d < 3)) {', 'if ((d > 14 || (Math.abs(dy) > 4 && d < 3)) && !(this.game.time - this.bot.lastLaunchTime < 3.5)) {');
    if (src === mid) throw new Error('patch2 failed');
    const orig = BotNav.prototype._followPath;
    BotNav.prototype._followPath = new Function('probeMove', 'return {' + src + '}._followPath')(probeMove);
    C.patched = await runTrials(game, queue, 'patched (pad wp exempt + no replan during pad flight)');
    BotNav.prototype._followPath = orig;
  } catch (err) { C.error = String(err && err.stack || err); console.error('[padtest]', err); }
  game.autotest.duration = 0;
}
export function drive() {}
