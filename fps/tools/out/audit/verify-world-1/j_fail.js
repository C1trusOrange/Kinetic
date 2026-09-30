(window.__GAME__ && window.__GAME__.state === "menu" && !window.__started && (window.__started = true, (async () => {
  try {
    const g = window.__GAME__, w = g.world;
    const base = g.maps.find(m => m.id === 'sandbox');
    const broken = { ...base, theme: { ...(base.theme || {}), sky: null } };
    let threw = null;
    try { await w.load(broken); } catch (e) { threw = String(e && e.message || e); }
    const snap = () => ({ mapId: w.mapId, hasGroup: !!w.group, groupParent: !!(w.group && w.group.parent), sun: !!w.sun, lighting: !!w.lighting, nav: w.nav.nodes.length, spawns: w.spawnPoints.length });
    const afterFail = snap();
    const origMaps = g.maps;
    await g.startMatch({ mapId: 'sandbox', botCount: 2, mode: 'ffa', difficulty: 'normal' });
    const afterStart = { state: g.state, ...snap(), botsAlive: g.entities.length, playerPos: g.player.position.toArray().map(v => +v.toFixed(2)) };
    window.__JOB__ = { threw, afterFail, afterStart };
  } catch (e) { window.__JOB__ = { error: String(e && e.stack || e) }; }
  window.__jobdone = true;
})()), window.__jobdone === true)
