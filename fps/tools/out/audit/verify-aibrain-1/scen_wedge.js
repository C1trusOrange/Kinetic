// Verifier: start-node-across-wall (foundry hall slot) and walk-link-under-low-overhang (ruins bath wall).
const f = v => +v.toFixed(2);
const nap = () => new Promise(r => setTimeout(r, 0));
async function step(game, seconds, dt, cb) {
  const n = Math.round(seconds / dt);
  for (let i = 0; i < n; i++) { game.update(dt); if (cb && cb(i, dt) === false) return; if (i % 240 === 239) await nap(); }
}
export async function setup(game, report) {
  const C = report.custom = { tests: [] };
  game.autotest.duration = 1e9;
  const DT = 1 / 60;
  try {
    const bots = game.bots.list;
    for (let i = 1; i < bots.length; i++) { bots[i].alive = false; bots[i].model.setVisible(false); bots[i].respawnAt = -1; }
    game.player.alive = false; game.player.respawnAt = -1;
    const bot = bots[0]; bot.god = true;
    const br = bot.brain, nav = br.nav;
    br.perceive = () => {}; br.think = () => {};
    br.computeMovement = function (dt, t) { const it = this.intent; it.moveX = 0; it.moveZ = 0; it.speed = 0; if (t < this.unstickUntil) { it.moveX = this.unstickDir.x; it.moveZ = this.unstickDir.y; const l = Math.hypot(it.moveX, it.moveZ) || 1; it.moveX /= l; it.moveZ /= l; it.speed = 7; return; } this.moveNav(dt, 7.2); if (t < this.forceJumpUntil && bot.onGround) it.jump = true; };
    const useRescue = game.params.get('rescue') === '1';
    let rescues = 0;
    br.rescue = () => { rescues++; return useRescue ? Object.getPrototypeOf(br).rescue.call(br) : false; };
    let stuck = [];
    const oRec = br.recoverStuck.bind(br);
    br.recoverStuck = (t) => { stuck.push({ t: f(t), stage: br.stuckStage + 1 }); return oRec(t); };
    const wn = game.world.nav, col = game.world.collision;
    const V = game.player.position.constructor;
    const map = game.world.mapId;
    const tests = map === 'foundry'
      ? [
        { name: 'E slot z-11.4', from: [16.6, 0, -11.4], goal: [10.5, 0, -11.5] },
        { name: 'E slot z-8.6', from: [16.9, 0, -8.6], goal: [10.5, 0, -8.5] },
        { name: 'W slot z-2.6', from: [-16.9, 0, -2.6], goal: [-10.5, 0, -2.5] },
        { name: 'E slot z-15', from: [16.7, 0, -15], goal: [10.5, 0, -15.5] },
      ]
      : [
        { name: 'bath wall S->N', from: [-23.5, -1.6, 20.3], goal: [-23.5, -1.6, 24.5] },
        { name: 'bath wall N->S', from: [-23.5, -1.6, 24.3], goal: [-23.5, -1.6, 19.5] },
        { name: 'bath wall x-26 S->N', from: [-26.5, -1.6, 20.3], goal: [-26.5, -1.6, 24.5] },
      ];
    // cross-section probe: hits along +x at several heights
    const hitsAlong = (ox, oy, oz, dx, dz, maxd) => {
      const o = new V(ox, oy, oz), d = new V(dx, 0, dz), out = []; let tot = 0;
      for (let k = 0; k < 8; k++) { const h = col.raycast(o, d, maxd - tot); if (!h) break; tot += h.distance; out.push({ at: f(tot), n: [f(h.normal.x), f(h.normal.y), f(h.normal.z)] }); o.addScaledVector(d, h.distance + 0.002); tot += 0.002; }
      return out;
    };
    if (map === 'foundry') {
      C.xsec = {};
      for (const z of [-11.4, -8.6, -2.6, -15]) { C.xsec['z' + z + ' y0.5 +x from 10'] = hitsAlong(10, 0.5, z, 1, 0, 12); C.xsec['z' + z + ' y1.5 +x from 10'] = hitsAlong(10, 1.5, z, 1, 0, 12); }
      C.xsec['z-2.6 y0.5 -x from -10'] = hitsAlong(-10, 0.5, -2.6, -1, 0, 12);
    } else {
      C.xsec = { 'x-23.5 y-1.0 +z from 19': hitsAlong(-23.5, -1.0, 19, 0, 1, 8), 'x-23.5 y-0.2 +z from 19': hitsAlong(-23.5, -0.2, 19, 0, 1, 8), 'x-23.5 y0.1 +z from 19': hitsAlong(-23.5, 0.1, 19, 0, 1, 8) };
    }
    for (const T of tests) {
      const a = new V(...T.from), g = new V(...T.goal);
      bot.velocity.set(0, 0, 0);
      bot.teleportTo(a.clone(), 0);
      await step(game, 0.4, DT);
      const p0 = bot.position.clone();
      const nn = wn.nearestNode(p0, 8);
      const res = { name: T.name, placed: p0.toArray().map(f), nearest: nn ? nn.position.toArray().map(f) : null, nearestDist: nn ? f(nn.position.distanceTo(p0)) : null };
      if (nn) {
        const o = new V(p0.x, p0.y + 0.5, p0.z), tp = new V(nn.position.x, nn.position.y + 0.5, nn.position.z), dir = tp.clone().sub(o); const L = dir.length(); dir.normalize();
        const h = col.raycast(o, dir, L);
        res.losBlockedAt = h ? f(h.distance) : null;
      }
      const path = wn.findPath(p0, g);
      res.path0 = path ? path.slice(0, 3).map(w => [f(w.x), f(w.y), f(w.z), w.type].join(' ')) : null;
      // was the goal reachable per isConnected?
      res.connected = wn.isConnected(p0, g);
      stuck = []; rescues = 0;
      nav.clear(); nav.setGoal(g, 1.4, 0.5);
      let t = 0, ok = false, minD = 1e9, lastP = p0.clone(), trace = [];
      await step(game, 20, DT, (i, dt) => {
        t += dt;
        const d = Math.hypot(bot.position.x - g.x, bot.position.z - g.z);
        minD = Math.min(minD, d);
        if (Math.floor(t * 2) !== Math.floor((t - dt) * 2) && t < 20) trace.push([f(t), bot.position.toArray().map(v => f(v)).join(','), nav.mode].join('|'));
        if (nav.arrived || (d < 1.6 && Math.abs(bot.position.y - g.y) < 1.5)) { ok = true; return false; }
        return true;
      });
      Object.assign(res, { ok, t: f(t), minD: f(minD), stuckEvents: stuck.length, stuckStages: stuck.map(s => s.stage + '@' + s.t).join(','), rescues, end: bot.position.toArray().map(f), trace: trace.filter((_, i) => i % 2 === 0).slice(0, 14) });
      C.tests.push(res);
    }
  } catch (err) { C.error = String(err && err.stack || err); console.error('[scen_wedge]', err); }
  game.autotest.duration = 0;
}
export function drive() {}
