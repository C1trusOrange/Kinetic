(() => {
  const g = window.__GAME__, w = g.world, nav = w.nav;
  const V = nav.nodes[0].position.constructor;
  let seed = 777; const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const main = nav._main;
  const pads = w.jumpPads;
  let paths = 0, usesPad = 0, crossesPad = 0, nullPaths = 0;
  const perPad = pads.map(() => 0);
  const t0 = performance.now(); let maxMs = 0, totMs = 0;
  for (let k = 0; k < 400; k++) {
    const a = main[Math.floor(rnd() * main.length)], b = main[Math.floor(rnd() * main.length)];
    const ta = performance.now();
    const p = nav.findPath(a.position, b.position);
    const ms = performance.now() - ta; totMs += ms; if (ms > maxMs) maxMs = ms;
    if (!p) { nullPaths++; continue; }
    paths++;
    if (p.some(x => x.pad)) { usesPad++; continue; }
    // walk each segment (start -> wp0 -> wp1...) and test pad trigger cylinders
    let hit = -1;
    const pts = [a.position].concat(p);
    for (let i = 0; i < pts.length - 1 && hit < 0; i++) {
      const u = pts[i], v = pts[i + 1];
      const len = Math.hypot(v.x - u.x, v.z - u.z);
      const steps = Math.max(1, Math.ceil(len / 0.25));
      for (let s = 0; s <= steps && hit < 0; s++) {
        const f = s / steps, x = u.x + (v.x - u.x) * f, z = u.z + (v.z - u.z) * f, y = u.y + (v.y - u.y) * f;
        for (let pi = 0; pi < pads.length; pi++) {
          const pd = pads[pi];
          if (Math.hypot(x - pd.position.x, z - pd.position.z) < 1.1 && Math.abs(y - pd.position.y) < 0.7) { hit = pi; break; }
        }
      }
    }
    if (hit >= 0) { crossesPad++; perPad[hit]++; }
  }
  return { pads: pads.length, paths, nullPaths, usesPad, crossesPad, perPad, maxMs: +maxMs.toFixed(1), avgMs: +(totMs / 400).toFixed(2), padPos: pads.map(p => p.position.toArray().map(v => +v.toFixed(1))) };
})()
