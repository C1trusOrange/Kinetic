(window.__GAME__ && window.__GAME__.state === "menu" && !window.__started && (window.__started = true, (async () => {
  try {
    const g = window.__GAME__, w = g.world;
    const byId = id => g.maps.find(m => m.id === id);
    const res = [];
    for (const id of ['foundry', 'foundry', 'skyline', 'skyline']) {
      const t0 = performance.now();
      await w.load(byId(id));
      res.push({ id, wall: Math.round(performance.now() - t0), stats: w.stats });
    }
    const defs = byId('foundry').pickups;
    const t1 = performance.now();
    await w.pickups.build(defs.map(p => ({ ...p })), () => {});
    res.push({ pickupsBuildMs: Math.round(performance.now() - t1) });
    const t2 = performance.now();
    for (let i = 0; i < 5; i++) w._buildJumpPads({ jumpPads: byId('foundry').jumpPads }, () => {});
    res.push({ padsBuild5Ms: Math.round(performance.now() - t2) });
    window.__JOB__ = res;
  } catch (e) { window.__JOB__ = { error: String(e && e.stack || e) }; }
  window.__jobdone = true;
})()), window.__jobdone === true)
