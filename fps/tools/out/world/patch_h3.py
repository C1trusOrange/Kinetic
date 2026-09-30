p = 'tools/out/world/harness.js'
s = open(p, encoding='utf-8').read()
marker = "  if (tests.includes('tris')) {"
add = """  if (tests.includes('wp')) {
    R.wp = world.pickups.list.filter(p => p.type === 'weapon').map(p => {
      const box = new THREE.Box3().setFromObject(p.holder);
      return { id: p.weapon, scale: p.holder.scale.toArray(), pos: p.holder.position.toArray(), kids: p.holder.children.length, size: box.getSize(new THREE.Vector3()).toArray().map(v => +v.toFixed(2)),
        geo: p.holder.children.map(c => { c.geometry.computeBoundingBox(); return c.geometry.boundingBox.getSize(new THREE.Vector3()).toArray().map(v => +v.toFixed(2)); }) };
    });
  }

"""
s = s.replace(marker, add + marker, 1)
open(p, 'w', encoding='utf-8').write(s)
