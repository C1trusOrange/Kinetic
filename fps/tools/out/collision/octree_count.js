// Is the octree dropping triangles? Counts triangles reachable through the tree vs the number added, and classifies
// any missing ones. Works on the pristine base (no pad) and on the fixed code (max bound padded).
//   python tools/run.py "index.html?autotest=1&map=foundry&bots=0&god=1&duration=99999&scenario=tools/out/collision/octree_count.js" --report
let done = false;

export async function setup(game, report) {
  const coll = game.world.collision;
  const seen = new Set();
  const stack = [coll.octree];
  while (stack.length) {
    const n = stack.pop();
    for (const t of n.triangles) seen.add(t);
    for (const s of n.subTrees) stack.push(s);
  }
  // all triangles that were added: octree.triangles is emptied by split(), so re-derive them from the geometry the
  // world built. MapBuilder adds through coll.addTriangle -> octree.addTriangle, which also grows octree.bounds.
  const b = coll.octree.bounds;
  report.custom = {
    map: game.world.mapId,
    added: coll.triangleCount,
    inTree: seen.size,
    dropped: coll.triangleCount - seen.size,
    bounds: { min: b.min.toArray().map(v => +v.toFixed(3)), max: b.max.toArray().map(v => +v.toFixed(3)) },
    treeBoxMax: coll.octree.box ? coll.octree.box.max.toArray().map(v => +v.toFixed(3)) : null,
  };
  done = true;
}

export function drive(t, dt, game, report) {
  if (done && !report.done) game.autotest.finish();
}
