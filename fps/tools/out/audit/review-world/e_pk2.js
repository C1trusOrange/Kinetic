(function(){
  const g = window.__GAME__, w = g.world, c = w.collision;
  const V3 = g.camera.position.constructor;
  const Cap = g.player.move.capsule.constructor;
  const out = {};
  const cap = new Cap(new V3(18, 0.4, 30), new V3(18, 1.4, 30), 0.4);
  const tris = []; c.octree.getCapsuleTriangles(cap, tris);
  out.tris = tris.filter(t => !!c.octree.triangleCapsuleIntersect(cap, t)).map(t => { const n = new V3(); t.getNormal(n); return { a: t.a.toArray().map(v => +v.toFixed(2)), b: t.b.toArray().map(v => +v.toFixed(2)), c: t.c.toArray().map(v => +v.toFixed(2)), n: n.toArray().map(v => +v.toFixed(2)), s: t.surface }; }).slice(0, 10);
  const rows = [];
  for (const [dx, dz] of [[0,0],[1,0],[-1,0],[0,1],[0,-1],[1.3,0],[-1.3,0],[0,1.3],[0,-1.3]]) { const cp = new Cap(new V3(18+dx, 0.4, 30+dz), new V3(18+dx, 1.4, 30+dz), 0.4); const r = c.capsuleIntersect(cp); rows.push([dx, dz, r ? +r.depth.toFixed(2) : 0]); }
  out.rows = rows;
  const p = w.pickups.list[3]; out.pk = { pos: p.position.toArray(), type: p.type, weapon: p.weapon };
  return JSON.stringify(out);
})()
