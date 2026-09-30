(function(){
  const g = window.__GAME__, w = g.world, c = w.collision;
  const V3 = g.camera.position.constructor;
  const Cap = g.player.move.capsule.constructor;
  const out = [];
  w.pickups.list.forEach(p => {
    const cap = new Cap(new V3(p.position.x, p.position.y + 0.4, p.position.z), new V3(p.position.x, p.position.y + 1.4, p.position.z), 0.4);
    const r = c.capsuleIntersect(cap);
    const n = w.nav.nearestNode(p.position, 2.5), n6 = w.nav.nearestNode(p.position, 8);
    out.push({ id: p.id, type: p.type + (p.weapon ? ':' + p.weapon : ''), pos: p.position.toArray().map(v => +v.toFixed(2)), overlap: r ? +r.depth.toFixed(2) : 0, node25: n ? [n.main, +n.position.distanceTo(p.position).toFixed(2)] : null, node8: n6 ? [n6.main, n6.position.toArray().map(v => +v.toFixed(1))] : null });
  });
  return JSON.stringify(out.filter(o => o.overlap > 0.05 || !o.node25 || !o.node25[0]));
})()
