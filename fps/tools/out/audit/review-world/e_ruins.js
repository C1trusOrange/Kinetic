(function(){
  const g = window.__GAME__, w = g.world, c = w.collision;
  const V3 = g.camera.position.constructor;
  const Cap = g.player.move.capsule.constructor;
  const out = { mapId: w.mapId, tri: c.triangleCount, col: [] };
  for (let y = 0.1; y <= 13; y += 0.5) {
    const cap = new Cap(new V3(0, y + 0.4, -37.0), new V3(0, y + 1.4, -37.0), 0.4);
    const r = c.capsuleIntersect(cap);
    out.col.push([+y.toFixed(1), r ? +r.depth.toFixed(3) : 0]);
  }
  return JSON.stringify(out);
})()
