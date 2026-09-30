p = 'tools/out/world/harness.js'
s = open(p, encoding='utf-8').read()
marker = "  if (tests.includes('tris')) {"
add = """  if (tests.includes('navq')) {
    const nav = world.nav;
    let bad = 0, checked = 0, maxErr = 0;
    const b = world.bounds;
    for (let i = 0; i < 1500; i++) {
      const pos = new THREE.Vector3(b.min.x + Math.random() * (b.max.x - b.min.x), Math.random() * 8 - 1, b.min.z + Math.random() * (b.max.z - b.min.z));
      const md = [2, 6, 10][i % 3];
      const got = nav.nearestNode(pos, md);
      let best = null, bd = md * md;
      for (const n of nav.nodes) {
        const dx = n.position.x - pos.x, dz = n.position.z - pos.z, dy = (n.position.y - pos.y) * 2;
        const d = dx * dx + dz * dz + dy * dy;
        if (d < bd) { bd = d; best = n; }
      }
      checked++;
      if ((got === null) !== (best === null)) { bad++; continue; }
      if (got) {
        const dx = got.position.x - pos.x, dz = got.position.z - pos.z, dy = (got.position.y - pos.y) * 2;
        const gd = dx * dx + dz * dz + dy * dy;
        if (gd > bd + 1e-6) { bad++; maxErr = Math.max(maxErr, Math.sqrt(gd) - Math.sqrt(bd)); }
      }
    }
    R.navq = { checked, bad, maxErr };
  }

"""
s = s.replace(marker, add + marker, 1)
open(p, 'w', encoding='utf-8').write(s)
