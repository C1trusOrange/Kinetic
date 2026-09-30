(window.__GAME__ && window.__GAME__.state === "menu" && !window.__started && (window.__started = true, (async () => {
  try {
    const g = window.__GAME__, w = g.world;
    const V3 = g.camera.position.constructor;
    const def = g.maps.find(m => m.id === 'ruins');
    await w.load(def);
    const c = w.collision;
    const Cap = (await import('three/addons/math/Capsule.js')).Capsule;
    const out = {};
    const fmt = t => ({ a: t.a.toArray().map(v => +v.toFixed(2)), b: t.b.toArray().map(v => +v.toFixed(2)), c: t.c.toArray().map(v => +v.toFixed(2)), n: (() => { const n = new V3(); t.getNormal(n); return n.toArray().map(v => +v.toFixed(2)); })(), s: t.surface });
    const cap = new Cap(new V3(0, 10.3, -37.02), new V3(0, 11.3, -37.02), 0.4);
    const tris = [];
    c.octree.getCapsuleTriangles(cap, tris);
    out.near = tris.map(t => ({ ...fmt(t), hit: !!c.octree.triangleCapsuleIntersect(cap, t) })).filter(o => o.hit);
    out.fwd = (() => { const h = c.raycast(new V3(0, 10.5, -30), new V3(0, 0, -1), 30); return h ? { d: h.distance, p: h.point.toArray(), n: h.normal.toArray() } : null; })();
    out.back = (() => { const h = c.raycast(new V3(0, 10.5, -45), new V3(0, 0, 1), 30); return h ? { d: h.distance, p: h.point.toArray(), n: h.normal.toArray() } : null; })();
    const pad = w.jumpPads[3];
    out.pad = { pos: pad.position.toArray(), target: pad.target.toArray(), vel: pad.velocity.toArray() };
    out.warnings = w.warnings.filter(m => /jumpPad/.test(m));
    window.__JOB__ = out;
  } catch (e) { window.__JOB__ = { error: String(e && e.stack || e) }; }
  window.__jobdone = true;
})()), window.__jobdone === true)
