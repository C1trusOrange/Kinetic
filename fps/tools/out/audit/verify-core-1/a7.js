const out = {};
for (const map of ['foundry','ruins','skyline','sandbox']) {
  const def = game.maps.find(m => m.id === map);
  await game.world.load(def, {});
  const col = game.world.collision;
  // collect triangles in tree
  const inTree = new Set();
  const walk = n => { for (const t of n.triangles) inTree.add(t); for (const s of n.subTrees) walk(s); };
  walk(col.octree);
  // original triangles: not stored (octree.triangles popped). Rebuild by rebuilding geometry? use count instead
  out[map] = { triangleCount: col.triangleCount, inTree: inTree.size, box: [col.octree.box.min.toArray(), col.octree.box.max.toArray()], bounds: [col.octree.bounds.min.toArray(), col.octree.bounds.max.toArray()] };
}
return out;
