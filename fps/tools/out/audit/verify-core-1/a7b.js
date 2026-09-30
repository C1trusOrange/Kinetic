const { Octree } = await import('three/addons/math/Octree.js');
const orig = Octree.prototype.addTriangle;
const all = [];
Octree.prototype.addTriangle = function (t) { all.push(t); return orig.call(this, t); };
const def = game.maps.find(m => m.id === 'sandbox');
await game.world.load(def, {});
Octree.prototype.addTriangle = orig;
const col = game.world.collision;
const inTree = new Set();
const walk = n => { for (const t of n.triangles) inTree.add(t); for (const s of n.subTrees) walk(s); };
walk(col.octree);
const missing = all.filter(t => !inTree.has(t));
const n = new THREE.Vector3();
const res = { total: all.length, inTree: inTree.size, missing: missing.length, box: [col.octree.box.min.toArray(), col.octree.box.max.toArray()], list: [] };
for (const t of missing) { t.getNormal(n); res.list.push({ n: n.toArray().map(v => +v.toFixed(2)), a: t.a.toArray(), b: t.b.toArray(), c: t.c.toArray() }); }
// how many triangles lie on max planes (touch)
const mx = col.octree.box.max;
let onMaxX = 0, onMaxY = 0, onMaxZ = 0;
for (const t of all) {
  const vs = [t.a, t.b, t.c];
  if (vs.every(v => v.x === mx.x)) onMaxX++;
  if (vs.every(v => v.y === mx.y)) onMaxY++;
  if (vs.every(v => v.z === mx.z)) onMaxZ++;
}
res.onMax = { x: onMaxX, y: onMaxY, z: onMaxZ };
return res;
