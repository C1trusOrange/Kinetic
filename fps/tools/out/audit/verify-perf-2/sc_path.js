// Record in-game findPath arguments + timing, then re-time each with min-of-5 offline (removes CPU contention noise).
const recs = [];
export function setup(game, report) {
  const nav = game.world.nav;
  const GP = Object.getPrototypeOf(nav);
  const of = GP.findPath;
  GP.findPath = function (from, to) {
    const t = performance.now();
    const r = of.call(this, from, to);
    recs.push({ from: from.clone(), to: to.clone(), ms: performance.now() - t, wp: r ? r.length : -1 });
    return r;
  };
  report.custom = {};
}
export function drive(t, dt, game) {
  game.player.god = true;
  const inp = game.input;
  inp.setVirtual('forward', (t % 8) < 6);
  inp.addLook(((t % 5) < 2 ? 200 : -150) * dt, 0);
}
const pct = (arr, q) => { const s = arr.slice().sort((a, b) => a - b); return s.length ? +s[Math.min(s.length - 1, Math.floor(s.length * q))].toFixed(2) : 0; };
export function finish(game, report) {
  const nav = game.world.nav;
  // restore original
  const GP = Object.getPrototypeOf(nav);
  // re-time using the wrapped fn is ok (adds tiny overhead but pushes recs) -> take a snapshot first
  const snap = recs.slice();
  const timed = [];
  const conn = [];
  for (const r of snap) {
    let best = 1e9, bestc = 1e9;
    for (let k = 0; k < 5; k++) {
      const t0 = performance.now();
      nav.isConnected(r.from, r.to);
      const c = performance.now() - t0;
      bestc = Math.min(bestc, c);
    }
    for (let k = 0; k < 5; k++) {
      const t0 = performance.now();
      nav.findPath(r.from, r.to);
      const d = performance.now() - t0;
      best = Math.min(best, d);
    }
    timed.push(best); conn.push(bestc);
  }
  const ing = snap.map(r => r.ms);
  report.custom = {
    map: game.world.mapId, n: snap.length,
    inGame: { p50: pct(ing, .5), p90: pct(ing, .9), p99: pct(ing, .99), max: pct(ing, 1), over8: ing.filter(x => x > 8).length, over16: ing.filter(x => x > 16).length },
    minOf5: { p50: pct(timed, .5), p90: pct(timed, .9), p99: pct(timed, .99), max: pct(timed, 1), over8: timed.filter(x => x > 8).length, over16: timed.filter(x => x > 16).length },
    connMinOf5: { p50: pct(conn, .5), max: pct(conn, 1) },
    worst: snap.map((r, i) => [i, +timed[i].toFixed(2), +r.ms.toFixed(2), r.wp, +r.from.distanceTo(r.to).toFixed(1)]).sort((a, b) => b[1] - a[1]).slice(0, 6),
    pathStats: game.bots.pathStats,
  };
}
