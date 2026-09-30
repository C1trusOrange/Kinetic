(window.__GAME__ && window.__GAME__.state === "menu" && !window.__started && (window.__started = true, (async () => {
  try {
    const g = window.__GAME__, w = g.world;
    const V = g.camera.position.constructor;
    await w.load(g.maps.find(m => m.id === 'ruins'));
    const c = w.collision;
    const pk = w.pickups.list.find(p => p.weapon === 'shotgun');
    const ray = (x, y, z) => { const h = c.raycast(new V(x, y, z), new V(0, -1, 0), 5); return h ? { y: +h.point.y.toFixed(3), n: h.normal.toArray().map(v => +v.toFixed(2)) } : null; };
    const { Capsule } = await import('three/addons/math/Capsule.js');
    const cap = (p, y0, y1) => { const h = c.capsuleIntersect(new Capsule(new V(p.x, p.y + y0, p.z), new V(p.x, p.y + y1, p.z), 0.4)); return h ? +h.depth.toFixed(2) : null; };
    const pos = pk.position;
    window.__JOB__ = {
      pk: { id: pk.id, weapon: pk.weapon, pos: pos.toArray() },
      r12: ray(pos.x, 1.2, pos.z), r15: ray(pos.x, 1.5, pos.z), r30: ray(pos.x, 3, pos.z),
      capDepth: cap(pos, 0.45, 1.4),
      floatY: pk.floatY,
      warnings: w.warnings.filter(m => /pickup|jumpPad/.test(m)),
      allWarn: w.warnings,
    };
  } catch (e) { window.__JOB__ = { error: String(e && e.stack || e) }; }
  window.__jobdone = true;
})()), window.__jobdone === true)
