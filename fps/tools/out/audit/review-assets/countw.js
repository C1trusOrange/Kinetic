(() => { const g = window.__GAME__; let meshes = 0, casters = 0, bots = 0, tris = 0;
  for (const b of g.bots.list) { const w = b.model && b.model.weapon; if (!w) continue; bots++; w.root.traverse(o => { if (o.isMesh) { meshes++; if (o.castShadow) casters++; tris += o.geometry.attributes.position.count / 3; } }); }
  return { bots, meshes, casters, tris: Math.round(tris), sceneCallsLast: g.renderer.info.render.calls }; })()
