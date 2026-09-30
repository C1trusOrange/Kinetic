(() => {
  const g = window.__GAME__, w = g.world, col = w.collision, nav = w.nav;
  const V = nav.nodes[0].position.constructor;
  const f = v => +v.toFixed(2);
  const out = { rays: [] };
  for (const [x, z] of [[-23.4, 21.2], [-23.49, 21.5], [-22.5, 21.2]]) {
    for (const h of [0.1, 0.32, 0.6, 1.0, 1.25, 1.7]) {
      for (const dir of [[0, 0, 1], [0, 0, -1], [1, 0, 0], [-1, 0, 0]]) {
        const hit = col.raycast(new V(x, -1.6 + h, z), new V(...dir), 2.0);
        if (hit) out.rays.push([x, z, h, dir.join(','), f(hit.distance), [f(hit.normal.x), f(hit.normal.y), f(hit.normal.z)].join(','), hit.surface, [f(hit.point.x), f(hit.point.y), f(hit.point.z)].join(',')]);
      }
    }
  }
  // nodes near
  out.nodes = nav.nodes.filter(n => Math.abs(n.position.x + 23.5) < 2.6 && Math.abs(n.position.z - 21.5) < 2.6 && Math.abs(n.position.y + 1.6) < 3).map(n => [f(n.position.x), f(n.position.y), f(n.position.z), n.links.length].join(','));
  // sample solids near (in def) 
  out.solids = (w.def.solids || []).filter(s => {
    const p = s.pos || s.from || s.min; if (!p) return false;
    const x = p[0], z = p[2] !== undefined && s.pos ? p[2] : (s.from ? s.from[1] : p[2]);
    return Math.abs(x + 23.5) < 6 && Math.abs(z - 21.5) < 6;
  }).slice(0, 12);
  return out;
})()
