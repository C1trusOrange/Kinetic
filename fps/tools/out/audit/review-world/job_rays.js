(window.__GAME__ && window.__GAME__.state === "menu" && !window.__started && (window.__started = true, (async () => {
  try {
    const g = window.__GAME__, w = g.world, c = w.collision;
    const V3 = g.camera.position.constructor;
    const byId = id => g.maps.find(m => m.id === id);
    await w.load(byId('ruins'));
    const out = {};
    const row = [];
    for (let x = -3; x <= 3.01; x += 0.25) {
      const h = c.raycast(new V3(x, 8, -30), new V3(0, 0, -1), 30);
      row.push([+x.toFixed(2), h ? +h.point.z.toFixed(2) : null, h ? +h.normal.z.toFixed(2) : null]);
    }
    out.rowAtY8 = row;
    const col = [];
    for (let y = 1; y <= 16; y += 1) {
      const h = c.raycast(new V3(0, y, -30), new V3(0, 0, -1), 30);
      col.push([y, h ? +h.point.z.toFixed(2) : null]);
    }
    out.colAtX0 = col;
    window.__JOB__ = out;
  } catch (e) { window.__JOB__ = { error: String(e && e.stack || e) }; }
  window.__jobdone = true;
})()), window.__jobdone === true)
