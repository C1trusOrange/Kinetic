(window.__GAME__ && window.__GAME__.state === "menu" && !window.__started && (window.__started = true, (async () => {
  try {
    const g = window.__GAME__, w = g.world;
    const V3 = g.camera.position.constructor;
    const def = g.maps.find(m => m.id === 'ruins');
    await w.load(def);
    const c = w.collision;
    const Cap = (await import('three/addons/math/Capsule.js')).Capsule;
    const out = { col: [] };
    for (let y = 0.1; y <= 13; y += 0.5) {
      const cap = new Cap(new V3(0, y + 0.4, -37.0), new V3(0, y + 1.4, -37.0), 0.4);
      const r = c.capsuleIntersect(cap);
      out.col.push([+y.toFixed(1), r ? +r.depth.toFixed(3) : 0, r ? r.normal.toArray().map(v => +v.toFixed(2)) : null]);
    }
    const sol = def.solids.map((s, i) => ({ i, s })).filter(o => { const s = o.s; const p = s.pos || (s.from && s.to ? [(s.from[0] + s.to[0]) / 2, 0, (s.from[s.from.length - 1] + s.to[s.to.length - 1]) / 2] : (s.min ? [(s.min[0] + s.max[0]) / 2, 0, (s.min[2] + s.max[2]) / 2] : null)); return p && Math.abs(p[0]) < 6 && p[2] < -34 && p[2] > -42; }).map(o => o.i + ':' + JSON.stringify(o.s));
    out.solids = sol;
    window.__JOB__ = out;
  } catch (e) { window.__JOB__ = { error: String(e && e.stack || e) }; }
  window.__jobdone = true;
})()), window.__jobdone === true)
