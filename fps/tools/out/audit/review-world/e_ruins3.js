(function(){
  const g = window.__GAME__, w = g.world, c = w.collision;
  const V3 = g.camera.position.constructor;
  const Cap = g.player.move.capsule.constructor;
  const out = {};
  const cap = new Cap(new V3(0, 8.0, -37.4), new V3(0, 9.0, -37.4), 0.8);
  const tris = []; c.octree.getCapsuleTriangles(cap, tris);
  out.ntris = tris.length;
  out.tris = tris.map(t => { const n = new V3(); t.getNormal(n); return { a: t.a.toArray().map(v => +v.toFixed(3)), b: t.b.toArray().map(v => +v.toFixed(3)), c: t.c.toArray().map(v => +v.toFixed(3)), n: n.toArray().map(v => +v.toFixed(2)), s: t.surface }; }).slice(0, 20);
  out.rayDown = (() => { const h = c.raycast(new V3(0, 12, -37.36), new V3(0, -1, 0), 12); return h ? { d: h.distance, p: h.point.toArray(), n: h.normal.toArray() } : null; })();
  out.rayFrontFacing = (() => { const h = c.raycast(new V3(0, 8.45, -30), new V3(0, 0, -1), 20); return h ? { d: h.distance, p: h.point.toArray(), n: h.normal.toArray() } : null; })();
  out.rayBackFacing = (() => { const h = c.raycast(new V3(0, 8.45, -45), new V3(0, 0, 1), 20); return h ? { d: h.distance, p: h.point.toArray(), n: h.normal.toArray() } : null; })();
  return JSON.stringify(out);
})()
