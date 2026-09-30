(() => { const g = window.__GAME__; let n = 0;
  for (const b of g.bots.list) { const w = b.model && b.model.weapon; if (!w) continue; w.root.traverse(o => { if (o.isMesh) { o.castShadow = false; n++; } }); }
  return { n }; })()
