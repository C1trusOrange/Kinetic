(function(){
  const g = window.__GAME__, w = g.world, c = w.collision;
  const V3 = g.camera.position.constructor;
  const Cap = g.player.move.capsule.constructor;
  const ov = (p) => { const cap = new Cap(new V3(p.x, p.y + 0.4, p.z), new V3(p.x, p.y + 1.4, p.z), 0.4); const r = c.capsuleIntersect(cap); return r ? +r.depth.toFixed(2) : 0; };
  const p3 = w.pickups.list.find(p => p.weapon === 'shotgun');
  const o = new V3(p3.position.x, p3.position.y + 1.2, p3.position.z);
  const down = new V3(0, -1, 0), up = new V3(0, 1, 0);
  const out = { pos: p3.position.toArray(), depth: ov(p3.position), warnsPk: w.warnings.filter(s => /pickup/.test(s)) };
  const ray = (y0, d) => { const h = c.raycast(new V3(o.x, y0, o.z), d, 5); return h ? { y: +h.point.y.toFixed(2), n: h.normal.toArray().map(v => +v.toFixed(2)) } : null; };
  out.downFrom1_2 = ray(1.2, down);
  out.downFrom1_5 = ray(1.5, down);
  out.downFrom2 = ray(2.0, down);
  out.upFrom0_3 = ray(0.3, up);
  out.upFrom0_05 = ray(0.05, up);
  const dirs = [[1,0],[-1,0],[0,1],[0,-1]];
  out.horiz = dirs.map(([x,z]) => { const h = c.raycast(new V3(o.x, 0.5, o.z), new V3(x,0,z), 6); return h ? +h.distance.toFixed(2) : null; });
  out.pk = { radius: w.pickups.list[0].radius, keys: Object.keys(p3) };
  return JSON.stringify(out);
})()
