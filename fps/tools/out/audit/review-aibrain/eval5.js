(() => {
  const g = window.__GAME__, w = g.world, nav = w.nav;
  const NG = nav.constructor;
  const out = [];
  for (let i = 0; i < 3; i++) {
    const t0 = performance.now();
    const ng = NG.build(nav.grid.tris, w.bounds, { mapId: 'bench' + i, def: {}, jumpPads: w.jumpPads, flags: nav.grid.flags });
    out.push({ ms: Math.round(performance.now() - t0), nodes: ng.stats.nodes, links: ng.stats.links, internal: ng.stats.buildMs });
  }
  return out;
})()
