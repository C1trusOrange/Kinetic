// find collision triangles that are added but missing from the octree after build()
const { CollisionWorld } = await import('/src/world/Collision.js');
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
await game.world.load(game.world.def);
CollisionWorld.prototype.addTriangle = origAdd;
const col = game.world.collision;
const inTree = new Set();
const walk = n => { for (const t of n.triangles) inTree.add(t); for (const s of n.subTrees) walk(s); };
walk(col.octree);
const missing = rec.filter(t => !inTree.has(t));
const out = { recorded: rec.length, inTree: inTree.size, count: col.triangleCount, missing: missing.length };
out.rootBox = col.octree.box.min.toArray().concat(col.octree.box.max.toArray());
out.list = missing.slice(0, 14).map(t => ({ a: t.a.toArray().map(v => +v.toFixed(3)), b: t.b.toArray().map(v => +v.toFixed(3)), c: t.c.toArray().map(v => +v.toFixed(3)), area: +t.getArea().toFixed(5), surface: t.surface }));
return out;
