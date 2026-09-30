(window.__GAME__ && window.__GAME__.state === "menu" && !window.__started && (window.__started = true, (async () => {
  try {
    const g = window.__GAME__, w = g.world;
    const V3 = g.camera.position.constructor;
    const def = g.maps.find(m => m.id === 'skyline');
    await w.load(def);
    const c = w.collision;
    const out = { rails: [] };
    def.solids.forEach((s, i) => {
      if (s.type !== 'railing' || s.from[1] === s.to[1]) return;
      const a = new V3(...s.from), b = new V3(...s.to);
      const dx = b.x - a.x, dz = b.z - a.z, L = Math.hypot(dx, dz);
      const n = new V3(-dz / L, 0, dx / L);
      const rows = [];
      for (const t of [0.1, 0.3, 0.5, 0.7, 0.9]) {
        const P = a.clone().lerp(b, t);
        const hitAt = (dy) => { const o = P.clone().addScaledVector(n, 1.0); o.y += dy; const h = c.raycast(o, n.clone().negate(), 2.0); return h ? +h.distance.toFixed(2) : null; };
        rows.push({ t, surfaceY: +P.y.toFixed(2), railMid: hitAt(0.5), railTop: hitAt(0.95), belowDeck: hitAt(-0.6), under1m: hitAt(-1.0) });
      }
      out.rails.push({ i, from: s.from, to: s.to, rows });
    });
    window.__JOB__ = out;
  } catch (e) { window.__JOB__ = { error: String(e && e.stack || e) }; }
  window.__jobdone = true;
})()), window.__jobdone === true)
