(window.__GAME__ && window.__GAME__.state === "menu" && !window.__started && (window.__started = true, (async () => {
  try {
    const g = window.__GAME__;
    const V = g.camera.position.constructor;
    const { MapBuilder } = await import('/src/world/MapBuilder.js');
    const { CollisionWorld } = await import('/src/world/Collision.js');
    const def = { id: 'slopetest', solids: [{ type: 'railing', from: [8, 0, -4], to: [8, 4, 4] }], bounds: { min: [-5, -2, -10], max: [20, 10, 10] } };
    const warns = [];
    const col = new CollisionWorld();
    const b = new MapBuilder(def, col, m => warns.push(m));
    b.buildGeometry();
    b.createMeshes();
    col.build();
    const rows = [];
    for (const z of [-3, -2, 0, 2, 3]) {
      const ySurf = (z + 4) / 8 * 4;
      const at = (dy) => { const h = col.raycast(new V(6, ySurf + dy, z), new V(1, 0, 0), 5); return h ? +h.point.y.toFixed(2) : null; };
      rows.push({ z, ySurf, midRail: at(0.5), topRail: at(1.0), below1m: at(-1.0) });
    }
    window.__JOB__ = { warns, rows };
  } catch (e) { window.__JOB__ = { error: String(e && e.stack || e) }; }
  window.__jobdone = true;
})()), window.__jobdone === true)
