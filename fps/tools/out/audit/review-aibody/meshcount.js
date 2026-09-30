const g = window.__GAME__;
const out = [];
for (const b of g.bots.list) {
  let meshes = 0, tris = 0, weaponMeshes = 0;
  b.model.root.traverse(o => { if (o.isMesh) { meshes++; const geo = o.geometry; tris += (geo.index ? geo.index.count : geo.attributes.position.count) / 3; } });
  if (b.model.weapon) b.model.weapon.root.traverse(o => { if (o.isMesh) weaponMeshes++; });
  out.push({ n: b.name, w: b.weaponId, meshes, weaponMeshes, tris: Math.round(tris) });
}
// render stats
const info = g.renderer.info;
return { out, calls: info.render.calls, tris: info.render.triangles, geometries: info.memory.geometries };
