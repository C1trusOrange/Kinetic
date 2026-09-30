// Measures bots.update() cost per frame and the path-finding stats in the real game.
export function setup(game, report) {
  const bots = game.bots;
  const orig = bots.update.bind(bots);
  const s = { frames: 0, total: 0, max: 0, over2ms: 0, over4ms: 0 };
  bots.update = dt => {
    const t0 = performance.now();
    orig(dt);
    const ms = performance.now() - t0;
    s.frames++;
    s.total += ms;
    if (ms > s.max) s.max = ms;
    if (ms > 2) s.over2ms++;
    if (ms > 4) s.over4ms++;
  };
  report.custom = { botUpdate: s };
  const t0 = performance.now();
  bots.prepare(game.world).then(() => { report.custom.prepareMs = +(performance.now() - t0).toFixed(0); report.custom.spots = { cover: bots.spots.cover.length, snipe: bots.spots.snipe.length }; });
}
export function drive() {}
export function finish(game, report) {
  const s = report.custom.botUpdate;
  s.avgMs = +(s.total / Math.max(1, s.frames)).toFixed(3);
  s.max = +s.max.toFixed(2);
  delete s.total;
  report.custom.pathStats = game.bots.pathStats;
  report.custom.nav = game.world.nav.stats;
}
