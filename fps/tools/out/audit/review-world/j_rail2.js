(window.__GAME__ && window.__GAME__.state === "menu" && !window.__started && (window.__started = true, (async () => {
  try {
    const g = window.__GAME__, w = g.world;
    const V3 = g.camera.position.constructor;
    const def = g.maps.find(m => m.id === 'skyline');
    await w.load(def);
    const c = w.collision;
    const out = {};
    const fmt = t => t ? { a: t.a.toArray().map(v => +v.toFixed(2)), b: t.b.toArray().map(v => +v.toFixed(2)), c: t.c.toArray().map(v => +v.toFixed(2)) } : null;
    const shoot = (o, d, max) => { const h = c.raycast(new V3(...o), new V3(...d), max); return h ? { dist: +h.distance.toFixed(2), pt: h.point.toArray().map(v => +v.toFixed(2)), n: h.normal.toArray().map(v => +v.toFixed(2)), tri: fmt(h.triangle), surf: h.surface } : null; };
    out.x_rail1126_t05_mid = shoot([14, 8.5, -25.55], [0, 0, -1], 3);
    out.x_rail1126_t05_low = shoot([14, 7.0, -25.55], [0, 0, -1], 3);
    out.x_rail1126_t01_mid = shoot([11, 7.22, -25.55], [0, 0, -1], 3);
    out.z_rail1095_t05_top = shoot([-11.65, 2.6, -17.7], [-1, 0, 0], 3);
    out.z_rail1095_t05_low = shoot([-11.65, 1.7, -17.7], [-1, 0, 0], 3);
    out.z_rail1095_t07_mid = shoot([-11.65, 2.74, -19.0], [-1, 0, 0], 3);
    out.z_rail1095_t07_belowdeck = shoot([-11.65, 2.0, -19.0], [-1, 0, 0], 3);
    out.z_rail1095_t09 = shoot([-11.65, 3.4, -20.2], [-1, 0, 0], 3);
    window.__JOB__ = out;
  } catch (e) { window.__JOB__ = { error: String(e && e.stack || e) }; }
  window.__jobdone = true;
})()), window.__jobdone === true)
