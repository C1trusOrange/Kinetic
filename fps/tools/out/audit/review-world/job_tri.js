(window.__GAME__ && window.__GAME__.state === "menu" && !window.__started && (window.__started = true, (async () => {
  try {
    const g = window.__GAME__, w = g.world;
    const V3 = g.camera.position.constructor;
    const byId = id => g.maps.find(m => m.id === id);
    await w.load(byId('ruins'));
    const c = w.collision;
    const Cap = (await import('three/addons/math/Capsule.js')).Capsule;
    const cap = new Cap(new V3(0, 10.4, -36.95), new V3(0, 11.4, -36.95), 0.4);
    const tris = [];
    c.octree.getCapsuleTriangles(cap, tris);
    const out = [];
    for (const t of tris) {
      const r = c.octree.triangleCapsuleIntersect(cap, t);
      if (r) { const n = new V3(); t.getNormal(n); out.push({ a: t.a.toArray().map(v => +v.toFixed(2)), b: t.b.toArray().map(v => +v.toFixed(2)), c: t.c.toArray().map(v => +v.toFixed(2)), n: n.toArray().map(v => +v.toFixed(2)), depth: +r.depth.toFixed(3), surface: t.surface }); }
    }
    window.__JOB__ = { n: tris.length, hit: out };
  } catch (e) { window.__JOB__ = { error: String(e && e.stack || e) }; }
  window.__jobdone = true;
})()), window.__jobdone === true)
