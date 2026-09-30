(window.__GAME__ && window.__GAME__.state === "menu" && !window.__started && (window.__started = true, (async () => {
  try {
    const g = window.__GAME__, w = g.world;
    const res = [];
    const nf = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    for (const q of ['low', 'medium', 'high', 'medium', 'low', 'high']) {
      g.setQuality(q);
      await nf(); await nf();
      res.push({ q, cast: w.sun.castShadow, size: w.sun.shadow.mapSize.x, hasMap: !!w.sun.shadow.map, mapW: w.sun.shadow.map ? w.sun.shadow.map.width : null, nb: +w.sun.shadow.normalBias.toFixed(3), bias: w.sun.shadow.bias, shadowEnabled: g.renderer.shadowMap.enabled, progs: g.renderer.info.programs.length, geoms: g.renderer.info.memory.geometries, tex: g.renderer.info.memory.textures });
    }
    window.__JOB__ = res;
  } catch (e) { window.__JOB__ = { error: String(e && e.stack || e) }; }
  window.__jobdone = true;
})()), window.__jobdone === true)
