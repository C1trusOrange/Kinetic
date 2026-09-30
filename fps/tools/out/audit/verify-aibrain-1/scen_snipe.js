// Verifier: a roaming sniper heads for a snipe spot that is unreachable (not in the main SCC): what does it do, how long until it re-picks?
const f = v => +v.toFixed(1);
const nap = () => new Promise(r => setTimeout(r, 0));
async function step(game, seconds, dt, cb) {
  const n = Math.round(seconds / dt);
  for (let i = 0; i < n; i++) { game.update(dt); if (cb && cb(i, dt) === false) return; if (i % 240 === 239) await nap(); }
}
export async function setup(game, report) {
  const C = report.custom = { trials: [] };
  game.autotest.duration = 1e9;
  const DT = 1 / 30;
  try {
    const bots = game.bots.list;
    for (let i = 1; i < bots.length; i++) { bots[i].alive = false; bots[i].model.setVisible(false); bots[i].respawnAt = -1; }
    game.player.alive = false; game.player.respawnAt = -1;
    const bot = bots[0]; bot.god = true;
    const br = bot.brain, nav = br.nav, wn = game.world.nav;
    br.wantPickup = () => false;
    const V = game.player.position.constructor;
    const spots = game.bots.spots.snipe;
    const bad = spots.filter(s => { const n = wn.nearestNode(s.pos, 1); return n && !n.main && !n.fromMain; });
    const good = spots.filter(s => { const n = wn.nearestNode(s.pos, 1); return n && n.main; });
    C.map = game.world.mapId; C.snipe = spots.length; C.unreachable = bad.length; C.main = good.length;
    const nTr = Math.min(6, bad.length);
    let stuck = 0;
    const oRec = br.recoverStuck.bind(br);
    br.recoverStuck = (t) => { stuck++; return oRec(t); };
    for (let k = 0; k < nTr; k++) {
      const s = bad[Math.floor(k * bad.length / nTr)];
      const cands = wn._main.filter(n => n.position.y < 0.6 && n.position.y > -0.6 && Math.hypot(n.position.x - s.pos.x, n.position.z - s.pos.z) > 15 && Math.hypot(n.position.x - s.pos.x, n.position.z - s.pos.z) < 40);
      const a = cands[Math.floor(cands.length * (k + 0.5) / nTr)] || wn._main[0];
      bot.velocity.set(0, 0, 0);
      bot.teleportTo(a.position.clone().add({ x: 0, y: 0.02, z: 0 }), 0);
      br.enterState('roam', game.time);
      br.waitUntil = 0;
      bot.giveWeapon('sniper'); bot.weaponId = 'sniper';
      nav.clear(); nav.setGoal(s.pos.clone(), 1.4, 0.5);
      stuck = 0;
      let t = 0, repick = -1, minH = 1e9;
      const log = [];
      await step(game, 25, DT, (i, dt) => {
        t += dt;
        const h = Math.hypot(bot.position.x - s.pos.x, bot.position.z - s.pos.z);
        minH = Math.min(minH, h);
        if (Math.floor(t) !== Math.floor(t - dt) && t < 25) log.push([f(t), f(h), f(bot.position.y), nav.mode, nav.unreachable ? 'U' : '-', stuck].join('|'));
        if (repick < 0 && nav.hasGoal && nav.goal.distanceTo(s.pos) > 0.5) { repick = t; return false; }
        return true;
      });
      C.trials.push({ spot: s.pos.toArray().map(f), from: a.position.toArray().map(f), repickAfter: repick < 0 ? '>25' : f(repick), minHorizDist: f(minH), stuckEvents: stuck, mode: nav.mode, unreach: nav.unreachable, log: log.filter((_, i) => i % 2 === 0).slice(0, 12) });
    }
  } catch (err) { C.error = String(err && err.stack || err); console.error('[scen_snipe]', err); }
  game.autotest.duration = 0;
}
export function drive() {}
