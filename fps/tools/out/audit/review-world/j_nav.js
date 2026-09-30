(window.__GAME__ && window.__GAME__.state === "menu" && !window.__started && (window.__started = true, (async () => {
  try {
    const g = window.__GAME__, w = g.world;
    const out = {};
    for (const id of ['ruins', 'skyline', 'foundry', 'sandbox']) {
      await w.load(g.maps.find(m => m.id === id));
      const nav = w.nav;
      const rows = [];
      const chk = (label, pos) => {
        const n = nav.nearestNode(pos, 2.5);
        if (!n) { rows.push({ label, node: null }); return; }
        if (n.main) return;
        rows.push({ label, main: n.main, fromMain: n.fromMain, toMain: n.toMain, comp: n.comp, scc: n.scc, pos: pos.toArray().map(v => +v.toFixed(1)) });
      };
      w.spawnPoints.forEach((sp, i) => chk('spawn#' + i, sp.position));
      w.pickups.list.forEach(p => chk('pickup#' + p.id + ':' + p.type + (p.weapon ? ':' + p.weapon : ''), p.position));
      out[id] = { rows, stats: nav.stats, warn: w.warnings.filter(m => /bots cannot|one-way|navigation/.test(m)) };
    }
    window.__JOB__ = out;
  } catch (e) { window.__JOB__ = { error: String(e && e.stack || e) }; }
  window.__jobdone = true;
})()), window.__jobdone === true)
