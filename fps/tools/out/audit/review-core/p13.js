const { CollisionWorld } = await import('/src/world/Collision.js');
const out = {};
for (const def of game.maps) {
  const rec = [];
  const origAdd = CollisionWorld.prototype.addTriangle;
  CollisionWorld.prototype.addTriangle = function (a, b, c, surface = 'concrete') {
    const t = new THREE.Triangle(a.clone(), b.clone(), c.clone());
    if (t.getArea() < 1e-7) return;
    t.surface = surface;
    this.octree.addTriangle(t);
    this.triangleCount++;
    rec.push(t);
  };
  try { await game.world.load(def); } finally { CollisionWorld.prototype.addTriangle = origAdd; }
  const col = game.world.collision;
  const inTree = new Set();
  const walk = n => { for (const t of n.triangles) inTree.add(t); for (const s of n.subTrees) walk(s); };
  walk(col.octree);
  const missing = rec.filter(t => !inTree.has(t));
  const n = new THREE.Vector3();
  out[def.id] = {
    recorded: rec.length, missing: missing.length,
    box: col.octree.box.min.toArray().concat(col.octree.box.max.toArray()).map(v => +v.toFixed(2)),
    list: missing.map(t => { t.getNormal(n); return { n: n.toArray().map(v => +v.toFixed(2)), a: t.a.toArray().map(v => +v.toFixed(2)), b: t.b.toArray().map(v => +v.toFixed(2)), c: t.c.toArray().map(v => +v.toFixed(2)), area: +t.getArea().toFixed(2) }; }),
  };
}
return out;
