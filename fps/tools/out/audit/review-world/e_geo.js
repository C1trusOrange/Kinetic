(function(){
  const g = window.__GAME__, w = g.world;
  const V3 = g.camera.position.constructor;
  const a = new V3(), b = new V3(), c = new V3(), e1 = new V3(), e2 = new V3(), n = new V3(), vn = new V3();
  let tris = 0, bad = 0, nan = 0, degen = 0, uvBad = 0, maxUV = 0;
  const badBy = {};
  w._solidsGroup.traverse(o => {
    if (!o.isMesh) return;
    const g0 = o.geometry, pos = g0.attributes.position, nor = g0.attributes.normal, uv = g0.attributes.uv, idx = g0.index;
    for (let i = 0; i < idx.count; i += 3) {
      const ia = idx.getX(i), ib = idx.getX(i + 1), ic = idx.getX(i + 2);
      a.fromBufferAttribute(pos, ia); b.fromBufferAttribute(pos, ib); c.fromBufferAttribute(pos, ic);
      e1.subVectors(b, a); e2.subVectors(c, a); n.crossVectors(e1, e2);
      const l = n.length();
      tris++;
      if (!(l === l) || !isFinite(l)) { nan++; continue; }
      if (l < 1e-9) { degen++; continue; }
      vn.fromBufferAttribute(nor, ia);
      if (n.dot(vn) < 0) { bad++; badBy[o.name] = (badBy[o.name] || 0) + 1; }
      for (const k of [ia, ib, ic]) { const u = uv.getX(k), v = uv.getY(k); if (!isFinite(u) || !isFinite(v)) uvBad++; maxUV = Math.max(maxUV, Math.abs(u), Math.abs(v)); }
    }
  });
  return JSON.stringify({ map: w.mapId, tris, bad, nan, degen, uvBad, maxUV: +maxUV.toFixed(1), badBy, draw: w.stats.drawCalls, ctris: w.stats.collisionTriangles });
})()
