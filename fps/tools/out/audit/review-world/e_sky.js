(function(){
  const g = window.__GAME__, w = g.world, c = w.collision;
  const V3 = g.camera.position.constructor;
  const Cap = g.player.move.capsule.constructor;
  const out = {};
  const cap = new Cap(new V3(17.7, 10.0, 4), new V3(17.7, 11.0, 4), 0.5);
  const tris = []; c.octree.getCapsuleTriangles(cap, tris);
  out.ntris = tris.length;
  out.tris = tris.map(t => { const n = new V3(); t.getNormal(n); return { a: t.a.toArray().map(v => +v.toFixed(2)), b: t.b.toArray().map(v => +v.toFixed(2)), c: t.c.toArray().map(v => +v.toFixed(2)), n: n.toArray().map(v => +v.toFixed(2)), s: t.surface }; }).slice(0, 14);
  const rays = [];
  for (const y of [9.7, 10.0, 10.3, 10.6, 10.9, 11.2]) { const h = c.raycast(new V3(15, y, 4), new V3(1, 0, 0), 6); rays.push([y, h ? +h.point.x.toFixed(2) : null]); }
  out.rays = rays;
  return JSON.stringify(out);
})()
