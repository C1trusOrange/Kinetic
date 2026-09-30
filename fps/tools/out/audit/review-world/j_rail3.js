(window.__GAME__ && window.__GAME__.state === "menu" && !window.__started && (window.__started = true, (async () => {
  try {
    const g = window.__GAME__, w = g.world;
    const V3 = g.camera.position.constructor;
    const def = (await import('/tools/out/audit/review-world/testmap.js')).default;
    await w.load(def);
    const c = w.collision;
    const out = { warnings: w.warnings.slice() };
    const shoot = (o, d, max) => { const h = c.raycast(new V3(...o), new V3(...d), max); return h ? { dist: +h.distance.toFixed(2), pt: h.point.toArray().map(v => +v.toFixed(2)) } : null; };
    const rows = [];
    for (const z of [-3.5, -2, 0, 2, 3.5]) {
      const surf = (z + 4) / 8 * 4;
      rows.push({ z, railSurfaceY: +surf.toFixed(2), visualRailRange: [+surf.toFixed(2), +(surf + 1.05).toFixed(2)],
        hitAtMidRail: shoot([9, surf + 0.5, z], [-1, 0, 0], 3),
        hitJustAboveSurface: shoot([9, surf + 0.1, z], [-1, 0, 0], 3),
        hitAtTopOfRail: shoot([9, surf + 1.0, z], [-1, 0, 0], 3),
        hitBelowRail1m: shoot([9, surf - 1.0, z], [-1, 0, 0], 3) });
    }
    out.slopedRailing = rows;
    const rows2 = [];
    for (const z of [-5, -3, 0, 3, 5]) {
      const surf = (z + 6) / 12 * 4;
      rows2.push({ z, deckY: +surf.toFixed(2),
        railMid: shoot([18.5, surf + 0.5, z], [-1, 0, 0], 3),
        railTop: shoot([18.5, surf + 1.0, z], [-1, 0, 0], 3),
        below1m: shoot([18.5, surf - 1.0, z], [-1, 0, 0], 3) });
    }
    out.slopedCatwalk = rows2;
    window.__JOB__ = out;
  } catch (e) { window.__JOB__ = { error: String(e && e.stack || e) }; }
  window.__jobdone = true;
})()), window.__jobdone === true)
