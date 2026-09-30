(window.__GAME__ && window.__GAME__.state === "menu" && !window.__started && (window.__started = true, (async () => {
  try {
    const g = window.__GAME__, w = g.world;
    const sb = g.maps.find(m => m.id === 'sandbox');
    const bad = { ...sb, id: 'sandbox-broken', theme: { ...sb.theme, sky: null } };
    let err = null;
    try { await w.load(bad); } catch (e) { err = String(e && e.message); }
    const res = { err, mapId: w.mapId, hasDef: !!w.def, hasSun: !!w.sun, hasLighting: !!w.lighting, groupInScene: !!(w.group && w.group.parent), navNodes: w.nav.nodes.length, spawns: w.spawnPoints.length, sceneEnv: !!g.scene.environment, pickups: w.pickups.list.length };
    window.__JOB__ = res;
  } catch (e) { window.__JOB__ = { error: String(e && e.stack || e) }; }
  window.__jobdone = true;
})()), window.__jobdone === true)
