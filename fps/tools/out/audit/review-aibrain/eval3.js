(() => {
  const g = window.__GAME__, w = g.world, col = w.collision, nav = w.nav;
  const V = nav.nodes[0].position.constructor;
  const Cap = g.bots.list[0].capsule.constructor; const cap = new Cap(new V(), new V(), 0.35);
  const f = v => +v.toFixed(1);
  const res = { nodes: nav.nodes.length, walkLinks: 0, ceil: 0, wall: 0, floor: 0, nodeIntersect: 0, samples: [] };
  const H = 1.8;
  const test = (x, y, z, r) => {
    cap.radius = r;
    cap.start.set(x, y + 0.08 + r, z);
    cap.end.set(x, y + H - r, z);
    const hit = col.capsuleIntersect(cap);
    return hit && hit.depth > 0.04 ? hit : null;
  };
  const cl = { ceil: new Map(), wall: new Map() };
  for (const n of nav.nodes) {
    const nh = test(n.position.x, n.position.y, n.position.z, 0.3);
    if (nh) res.nodeIntersect++;
    for (const l of n.links) {
      if (l.type !== 'walk' || l.pad) continue;
      const m = nav.nodes[l.to];
      if (m.id < n.id) continue; // each pair once
      res.walkLinks++;
      let kind = null;
      for (const t of [0.25, 0.5, 0.75]) {
        const x = n.position.x + (m.position.x - n.position.x) * t, y = n.position.y + (m.position.y - n.position.y) * t, z = n.position.z + (m.position.z - n.position.z) * t;
        const hit = test(x, y, z, 0.3);
        if (hit) { kind = hit.normal.y < -0.3 ? 'ceil' : hit.normal.y > 0.7 ? 'floor' : 'wall'; break; }
      }
      if (kind) {
        res[kind]++;
        if (res.samples.length < 400 && kind === 'ceil') res.samples.push([f(n.position.x), f(n.position.y), f(n.position.z), f(m.position.x), f(m.position.y), f(m.position.z)]);
      }
    }
  }
  res.samples = res.samples.slice(0, 15);
  return res;
})()
