(() => { const g = window.__GAME__; const w = g.weapons; const map = new Map(); let n = 0;
  w.viewRoot.traverse(o => { if (o.isMesh) { let m = map.get(o.material); if (!m) { m = o.material.clone(); map.set(o.material, m); } o.material = m; n++; } });
  return { meshes: n, distinctMats: map.size }; })()
