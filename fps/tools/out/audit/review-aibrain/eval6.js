(() => {
  const g = window.__GAME__, w = g.world, col = w.collision, nav = w.nav;
  const V = nav.nodes[0].position.constructor;
  const Cap = g.bots.list[0].capsule.constructor;
  const cap = new Cap(new V(), new V(), 0.4);
  let seed = 4242; const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const main = nav._main;
  let tested = 0, blocked = 0, noNodeNear = 0, worse = 0;
  const samples = [];
  const o = new V(), d = new V();
  for (let k = 0; k < 6000 && tested < 2500; k++) {
    const n = main[Math.floor(rnd() * main.length)];
    const x = n.position.x + (rnd() - 0.5) * 1.2, z = n.position.z + (rnd() - 0.5) * 1.2;
    // ground under the point
    o.set(x, n.position.y + 0.6, z);
    const gh = col.raycast(o, new V(0, -1, 0), 1.2);
    if (!gh || gh.normal.y < 0.7) continue;
    const y = gh.point.y;
    cap.start.set(x, y + 0.06 + 0.4, z); cap.end.set(x, y + 1.8 - 0.4, z);
    const hit = col.capsuleIntersect(cap);
    if (hit && hit.depth > 0.02) continue;          // capsule does not fit here: a bot cannot stand here
    tested++;
    const pos = new V(x, y, z);
    const nn = nav.nearestNode(pos, 8);
    if (!nn) { noNodeNear++; continue; }
    // can the bot walk straight to that node? knee-height and chest-height rays
    let blk = false;
    for (const h of [0.35, 1.0]) {
      o.set(x, y + h, z); d.set(nn.position.x - x, nn.position.y + h - (y + h), nn.position.z - z);
      const len = d.length(); d.multiplyScalar(1 / len);
      if (col.raycast(o, d, len)) { blk = true; break; }
    }
    if (blk) { blocked++; if (samples.length < 8) samples.push([+x.toFixed(2), +y.toFixed(2), +z.toFixed(2), +nn.position.x.toFixed(2), +nn.position.y.toFixed(2), +nn.position.z.toFixed(2)]); }
  }
  return { tested, blocked, noNodeNear, pct: +(100 * blocked / tested).toFixed(2), samples };
})()
