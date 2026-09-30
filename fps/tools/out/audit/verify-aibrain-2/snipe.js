// Finding 9 dynamic: roam bot given an unreachable snipe spot as goal (as pickRoamGoal does, unchecked): how long until the brain re-picks?
import * as THREE from 'three';
const f = v => +v.toFixed(2);
const nap = () => new Promise(r => setTimeout(r, 0));
export async function setup(game, report) {
  const C = report.custom = { trials: [], reach: {} };
  game.autotest.duration = 1e9;
  const bots = game.bots.list;
  for (let i = 1; i < bots.length; i++) { bots[i].alive = false; bots[i].model.setVisible(false); bots[i].respawnAt = -1; }
  const bot = bots[0], br = bot.brain, nav = br.nav;
  const gnav = game.world.nav;
  const spots = game.bots.spots;
  const mainNode = gnav._main[0];
  const cls = s => { const nn = gnav.nearestNode(s.pos, 0.8); return nn ? (nn.main ? 'main' : (gnav.isConnected(mainNode, nn) ? 'trap' : 'unreach')) : 'none'; };
  C.reach.snipe = {}; for (const s of spots.snipe) { const k = cls(s); C.reach.snipe[k] = (C.reach.snipe[k] || 0) + 1; }
  C.reach.cover = {}; for (const s of spots.cover) { const k = cls(s); C.reach.cover[k] = (C.reach.cover[k] || 0) + 1; }
  // pickups unavailable -> roam only
  for (const p of game.world.pickups.list) { p.available = false; }
  br.wantPickup = function () { this._collect = null; return false; };
  br.chooseState = function (t) { this.refreshState(t); };
  br.selectTarget = function () { this.targetRec = null; this.target = null; };
  const NT = parseInt(game.params.get('n') || '4');
  const LIM = parseFloat(game.params.get('lim') || '30');
  const unreach = spots.snipe.filter(s => cls(s) !== 'main');
  const starts = gnav._main.filter((n, i) => i % Math.floor(gnav._main.length / 20) === 0 && n.position.y < 1);
  let picks = 0; let lastStack = null;
  const osg = nav.setGoal.bind(nav);
  nav.setGoal = (p, r, d) => { if (p.distanceTo(nav.goal) > 1) lastStack = new Error().stack.split('\n').slice(2, 6).map(x => x.trim().replace(/^.*\//, '')).join(' < ') + ' state=' + br.state; return osg(p, r, d); };
  const op = br.pickRoamGoal.bind(br);
  for (let k = 0; k < NT && unreach.length; k++) {
    const s = unreach[(k * 7) % unreach.length];
    const a = starts[(k * 3) % starts.length].position;
    bot.velocity.set(0, 0, 0);
    bot.teleportTo(a.clone().add(new THREE.Vector3(0, 0.02, 0)), 0);
    let acc0 = 0; while (acc0 < 0.5) { game.update(1 / 60); acc0 += 1 / 60; }
    br.state = 'roam';
    nav.clear(); nav.setGoal(s.pos, 1.4, 0.5);
    br.waitUntil = 0;
    let t = 0, repick = null, maxStage = 0, dmin = 1e9, path = [];
    const g0 = s.pos.clone();
    for (let i = 0; t < LIM; i++) {
      game.update(1 / 60); t += 1 / 60;
      maxStage = Math.max(maxStage, br.stuckStage || 0);
      dmin = Math.min(dmin, Math.hypot(bot.position.x - g0.x, bot.position.z - g0.z));
      if (repick === null && nav.goal.distanceTo(g0) > 1) { repick = f(t); C.stack = C.stack || []; C.stack.push(lastStack); break; }
      if (Math.round(t * 60) % 120 === 0) path.push([f(bot.position.x), f(bot.position.y), f(bot.position.z)]);
      if (i % 240 === 239) await nap();
    }
    C.trials.push({ spot: [f(s.pos.x), f(s.pos.y), f(s.pos.z)], cls: cls(s), from: [f(a.x), f(a.y), f(a.z)], mode: nav.mode, unr: nav.unreachable, repickAt: repick, maxStage, dmin: f(dmin), track: path.slice(0, 8) });
  }
  game.autotest.duration = game.autotest.t + 0.05;
}
export function drive() {}
