(window.__GAME__ && window.__GAME__.state === "menu" && !window.__started && (window.__started = true, (async () => {
  try {
    const g = window.__GAME__, w = g.world, r = g.renderer;
    const maps = g.maps;
    const snap = (tag) => {
      let lights = 0, meshes = 0, total = 0;
      g.scene.traverse(o => { total++; if (o.isLight) lights++; if (o.isMesh) meshes++; });
      return { tag, geoms: r.info.memory.geometries, tex: r.info.memory.textures, programs: r.info.programs ? r.info.programs.length : -1, sceneChildren: g.scene.children.length, total, lights, meshes };
    };
    const res = [];
    const byId = id => maps.find(m => m.id === id);
    g.state = 'menu';
    res.push(snap('start:' + w.mapId));
    const seq = ['sandbox', 'foundry', 'sandbox', 'foundry', 'sandbox', 'foundry'];
    for (const id of seq) {
      await w.load(byId(id));
      g.render();
      res.push(snap('after ' + id));
    }
    window.__JOB__ = res;
  } catch (e) { window.__JOB__ = { error: String(e && e.stack || e) }; }
  window.__jobdone = true;
})()), window.__jobdone === true)
