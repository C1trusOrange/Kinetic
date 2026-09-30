(window.__GAME__ && window.__GAME__.state === "menu" && !window.__started && (window.__started = true, (async () => {
  try {
    const g = window.__GAME__, w = g.world;
    const out = {};
    for (const id of ['foundry', 'ruins', 'skyline', 'sandbox']) {
      await w.load(g.maps.find(m => m.id === id));
      const f = n => n ? { main: !!n.main, fromMain: !!n.fromMain, toMain: !!n.toMain, y: +n.position.y.toFixed(2) } : null;
      const sp = [];
      w.spawnPoints.forEach((s, i) => { const n = w.nav.nearestNode(s.position, 2.5); if (!n || !n.main) sp.push({ i, pos: s.position.toArray().map(v => +v.toFixed(1)), ...(f(n) || { none: true }) }); });
      const pk = [];
      w.pickups.list.forEach(p => { const n = w.nav.nearestNode(p.position, 2.5); if (!n || !n.main) pk.push({ id: p.id, type: p.type, weapon: p.weapon, pos: p.position.toArray().map(v => +v.toFixed(1)), ...(f(n) || { none: true }) }); });
      out[id] = { sp, pk, warn: w.warnings.filter(m => /bots cannot/.test(m)) };
    }
    window.__JOB__ = out;
  } catch (e) { window.__JOB__ = { error: String(e && e.stack || e) }; }
  window.__jobdone = true;
})()), window.__jobdone === true)
