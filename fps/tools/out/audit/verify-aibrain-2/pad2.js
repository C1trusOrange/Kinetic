// Finding 1: pad ride replan. Bot near each pad, goal = pad target; step game at fixed 60 Hz.
import { BotNav, probeMove } from '/src/ai/BotNav.js';
const f = v => +v.toFixed(1);
const nap = () => new Promise(r => setTimeout(r, 0));
async function step(game, seconds, dt, cb) {
  const n = Math.round(seconds / dt);
  for (let i = 0; i < n; i++) { game.update(dt); if (cb && cb(i, dt) === false) return; if (i % 240 === 239) await nap(); }
}
export async function setup(game, report) {
  const C = report.custom = { trials: [] };
  game.autotest.duration = 1e9;
  const bots = game.bots.list;
  for (let i = 1; i < bots.length; i++) { bots[i].alive = false; bots[i].model.setVisible(false); bots[i].respawnAt = -1; }
  const bot = bots[0], br = bot.brain, nav = br.nav;
  if (game.params.get('patch') === '1') {
    const src = BotNav.prototype._followPath.toString().replace('dy > 1.3 && dy > d * 0.75', 'dy > 1.3 && dy > d * 0.75 && !wp.pad');
    BotNav.prototype._followPath = eval('(function ' + src.replace(/^_followPath/, '') + ')');
  }
  br.chooseState = function () {};
  br.pickRoamGoal = function () {};
  const world = game.world, gnav = world.nav;
  const only = (game.params.get('pads') || '0,1,2,3').split(',').map(Number);
  let inv = 0; const invLog = [];
  const oInv = nav.invalidate.bind(nav);
  nav.invalidate = () => {
    inv++;
    const wp = nav.path && nav.path[nav.index];
    invLog.push({ t: f(game.time), g: bot.onGround, pos: [f(bot.position.x), f(bot.position.y), f(bot.position.z)], idx: nav.index, wp: wp ? [f(wp.x), f(wp.y), f(wp.z), wp.type, !!wp.pad].join(' ') : null, st: (new Error().stack.split('\n')[2] || '').trim().slice(-40) });
    return oInv();
  };
  const dirtyLog = [];
  for (const pi of only) {
    const pad = world.jumpPads[pi];
    const pn = gnav.nearestNode(pad.position, 2), tn = gnav.nearestNode(pad.target, 3);
    // start: main-area node at same level 6-12 m away connected to pn
    const cands = gnav._main.filter(n => Math.abs(n.position.y - pn.position.y) < 0.4 && n.position.distanceTo(pn.position) > 6 && n.position.distanceTo(pn.position) < 12 && gnav.isConnected(n, pn));
    const goals = gnav._main.filter(n => Math.abs(n.position.y - tn.position.y) < 0.6 && n.position.distanceTo(tn.position) < 6 && n.position.distanceTo(tn.position) > 0.5);
    const far = game.params.get('far') === '1'; const NT = parseInt(game.params.get('nt') || '3');
    const gc = far ? gnav._main.filter(n => Math.abs(n.position.y - tn.position.y) < 0.6 && n.position.distanceTo(tn.position) > 3 && n.position.distanceTo(tn.position) < 14 && gnav.isConnected(tn, n)) : [];
    for (let k = 0; k < NT && cands.length; k++) {
      const a = cands[(k * 7919) % cands.length].position; const g = far ? gc[(k * 104729) % gc.length].position : tn.position;
      bot.velocity.set(0, 0, 0);
      bot.teleportTo(a.clone().add({ x: 0, y: 0.02, z: 0 }), 0);
      await step(game, 0.3, 1 / 60);
      nav.clear(); nav.setGoal(g.clone(), 1.4, 0.5);
      inv = 0; invLog.length = 0;
      let ok = false, t = 0, air = 0, maxY = -99, launches = 0, lastL = bot.lastLaunchTime;
      await step(game, 20, 1 / 60, () => {
        t += 1 / 60; if (!bot.onGround) air += 1 / 60;
        maxY = Math.max(maxY, bot.position.y);
        if (bot.lastLaunchTime !== lastL) { launches++; lastL = bot.lastLaunchTime; }
        if (Math.hypot(bot.position.x - g.x, bot.position.z - g.z) < 1.6 && Math.abs(bot.position.y - g.y) < 1.5 && bot.onGround) { ok = true; return false; }
        return true;
      });
      C.trials.push({ pad: pi, ok, t: f(t), air: f(air), inv, launches });
    }
  }
  nav.invalidate = oInv;
  game.autotest.duration = game.autotest.t + 0.05;
  C.summary = C.trials.map(r => `${r.pad}:${r.ok ? 'ok' : 'FAIL'}:${r.t}s air${r.air} inv${r.inv} launches${r.launches}`);
}
export function drive() {}
