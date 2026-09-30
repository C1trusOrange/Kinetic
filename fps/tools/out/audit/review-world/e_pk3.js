(function(){
  const g = window.__GAME__, w = g.world, c = w.collision;
  const V3 = g.camera.position.constructor;
  const Cap = g.player.move.capsule.constructor;
  const ov = (p) => { const cap = new Cap(new V3(p.x, p.y + 0.4, p.z), new V3(p.x, p.y + 1.4, p.z), 0.4); const r = c.capsuleIntersect(cap); return r ? +r.depth.toFixed(2) : 0; };
  const out = { map: w.mapId, pickups: [], pads: [], spawns: [] };
  w.pickups.list.forEach(p => { const d = ov(p.position); if (d > 0.05) out.pickups.push([p.id, p.type + (p.weapon ? ':' + p.weapon : ''), p.position.toArray().map(v => +v.toFixed(1)), d]); });
  w.jumpPads.forEach((p, i) => { const d = ov(p.position); if (d > 0.05) out.pads.push([i, p.position.toArray().map(v => +v.toFixed(1)), d]); });
  w.spawnPoints.forEach((p, i) => { const d = ov(p.position); if (d > 0.05) out.spawns.push([i, p.position.toArray().map(v => +v.toFixed(1)), d]); });
  return JSON.stringify(out);
})()
