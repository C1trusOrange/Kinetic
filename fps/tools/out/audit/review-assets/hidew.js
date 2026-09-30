(() => { const g = window.__GAME__; let meshes = 0, casters = 0, bots = 0;
  for (const b of g.bots.list) { const w = b.model && b.model.weapon; if (!w) continue; bots++; w.root.traverse(o => { if (o.isMesh) { meshes++; if (o.castShadow) casters++; } }); w.root.visible = false; }
  return { bots, meshes, casters, calls: g.renderer.info.render.calls }; })()
