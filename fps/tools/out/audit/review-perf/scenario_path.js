// Per-request path cost breakdown + spawn selection cost. 8 bots roam/fight for the duration.
const rec = { req: [], spawn: [] };
let inFind = null;
export function setup(game, report) {
  const nav = game.world.nav;
  const GP = Object.getPrototypeOf(nav);
  const wrap = (proto, name, cb) => {
    const o = proto[name];
    proto[name] = function (...a) {
      const t = performance.now();
      const r = o.apply(this, a);
      cb(performance.now() - t, r, a, this);
      return r;
    };
  };
  wrap(GP, '_clearLine', (ms) => { if (inFind) { inFind.clear++; inFind.clearMs += ms; } });
  const of = GP.findPath;
  GP.findPath = function (...a) {
    const st = { clear: 0, clearMs: 0, astarMs: 0 };
    const prev = inFind; inFind = st;
    const t = performance.now();
    const r = of.apply(this, a);
    st.findMs = performance.now() - t;
    st.wp = r ? r.length : -1;
    inFind = prev;
    if (prev === null) rec.lastFind = st;
    return r;
  };
  const bot0 = game.bots.list[0];
  const NP = Object.getPrototypeOf(bot0.brain.nav);
  const or = NP._requestPath;
  NP._requestPath = function (...a) {
    rec.lastFind = null;
    const t = performance.now();
    or.apply(this, a);
    const total = performance.now() - t;
    const f = rec.lastFind;
    if (f) rec.req.push({ total: +total.toFixed(2), find: +f.findMs.toFixed(2), clearLines: f.clear, clearMs: +f.clearMs.toFixed(2), wp: f.wp });
    else rec.req.push({ total: +total.toFixed(2), find: 0, clearLines: 0, clearMs: 0, wp: -2 });
  };
  const GameP = Object.getPrototypeOf(game);
  const ops = GameP.pickSpawnPoint;
  GameP.pickSpawnPoint = function (...a) {
    const t = performance.now();
    const r = ops.apply(this, a);
    rec.spawn.push(+(performance.now() - t).toFixed(2));
    return r;
  };
  report.custom = {};
}
export function drive(t, dt, game) {
  game.player.god = true;
  const inp = game.input;
  inp.setVirtual('forward', (t % 8) < 6);
  inp.addLook(((t % 5) < 2 ? 200 : -150) * dt, 0);
  // explicit spawn-selection timing sample (8 bots alive)
  if (!game.__ps && t > 6) {
    game.__ps = true;
    const times = [];
    for (let i = 0; i < 20; i++) { const t0 = performance.now(); game.pickSpawnPoint(game.bots.list[i % game.bots.list.length]); times.push(performance.now() - t0); }
    times.sort((a, b) => a - b);
    game.__psTimes = { min: +times[0].toFixed(2), med: +times[10].toFixed(2), max: +times[19].toFixed(2), alive: game.entities.filter(e => e.alive).length, spawns: game.world.spawnPoints.length };
  }
}
const pct = (arr, q) => { const s = arr.slice().sort((a, b) => a - b); return s.length ? +s[Math.min(s.length - 1, Math.floor(s.length * q))].toFixed(2) : 0; };
export function finish(game, report) {
  const req = rec.req;
  const tot = req.map(r => r.total);
  report.custom = {
    map: game.world.mapId,
    requests: req.length,
    total: { p50: pct(tot, 0.5), p90: pct(tot, 0.9), p99: pct(tot, 0.99), max: pct(tot, 1), sum: +tot.reduce((a, b) => a + b, 0).toFixed(0) },
    over8: req.filter(r => r.total > 8).length,
    over16: req.filter(r => r.total > 16).length,
    worst: req.slice().sort((a, b) => b.total - a.total).slice(0, 8),
    smoothShare: (() => { const f = req.filter(r => r.find > 0); const s = f.reduce((a, r) => a + r.find, 0), c = f.reduce((a, r) => a + r.clearMs, 0); return { findSum: +s.toFixed(0), clearLineSum: +c.toFixed(0), clearLineCalls: f.reduce((a, r) => a + r.clearLines, 0) }; })(),
    spawnPickSample: game.__psTimes,
    spawnPicksInGame: { n: rec.spawn.length, max: Math.max(0, ...rec.spawn) },
    pathStats: game.bots.pathStats,
    navStats: game.world.nav.stats,
  };
}
