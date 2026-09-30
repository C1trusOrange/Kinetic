(window.__GAME__ && window.__GAME__.state === "menu" && !window.__started && (window.__started = true, (async () => {
  try {
    const { MapBuilder } = await import('/src/world/MapBuilder.js');
    const { CollisionWorld } = await import('/src/world/Collision.js');
    const def = { id: 'railtest', solids: [{ type: 'railing', from: [0, 0, 0], to: [4, 0, 0] }], bounds: { min: [-5, -2, -5], max: [10, 10, 5] } };
    const warns = [];
    const col = new CollisionWorld();
    const b = new MapBuilder(def, col, m => warns.push(m));
    b.buildGeometry();
    const grp = b.createMeshes();
    const counts = {};
    const posts = [0, 2, 4];
    const res = {};
    grp.traverse(o => {
      if (!o.geometry) return;
      const P = o.geometry.attributes.position, N = o.geometry.attributes.normal;
      for (const px of posts) {
        for (let i = 0; i < P.count; i++) {
          const x = P.getX(i), y = P.getY(i), z = P.getZ(i);
          if (Math.abs(x - px) <= 0.036 && Math.abs(z) <= 0.036 && y >= -0.001 && y <= 1.06) {
            const k = px + ':' + [N.getX(i), N.getY(i), N.getZ(i)].map(v => Math.round(v)).join(',');
            res[k] = (res[k] || 0) + 1;
          }
        }
      }
    });
    window.__JOB__ = { warns, res };
  } catch (e) { window.__JOB__ = { error: String(e && e.stack || e) }; }
  window.__jobdone = true;
})()), window.__jobdone === true)
