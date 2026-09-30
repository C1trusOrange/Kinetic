(function(){
  const g = window.__GAME__, w = g.world, c = w.collision;
  const V3 = g.camera.position.constructor;
  const Cap = g.player.move.capsule.constructor;
  const out = { z: [] };
  for (const y of [3, 10]) {
    const row = [];
    for (let z = -36.8; z >= -40.0; z -= 0.2) {
      const cap = new Cap(new V3(0, y + 0.4, z), new V3(0, y + 1.4, z), 0.4);
      const r = c.capsuleIntersect(cap);
      row.push([+z.toFixed(1), r ? +r.depth.toFixed(3) : 0, r ? r.normal.toArray().map(v => +v.toFixed(2)) : null]);
    }
    out.z.push({ y, row });
  }
  const cap = new Cap(new V3(0, 10.4, -37.3), new V3(0, 11.4, -37.3), 0.4);
  const tris = []; c.octree.getCapsuleTriangles(cap, tris);
  out.tris = tris.map(t => ({ a: t.a.toArray().map(v => +v.toFixed(2)), b: t.b.toArray().map(v => +v.toFixed(2)), c: t.c.toArray().map(v => +v.toFixed(2)), s: t.surface })).slice(0, 12);
  out.ntris = tris.length;
  return JSON.stringify(out);
})()
