// differential test: octree raycast vs brute force over all unique triangles
const col = game.world.collision;
const tris = new Set();
const walk = n => { for (const t of n.triangles) tris.add(t); for (const s of n.subTrees) walk(s); };
walk(col.octree);
const all = [...tris];
const out = { triangles: all.length, counted: col.triangleCount };
const ray = new THREE.Ray();
const hit = new THREE.Vector3();
function brute(o, d, maxD) {
  ray.set(o, d);
  let best = maxD;
  for (const t of all) {
    const p = ray.intersectTriangle(t.a, t.b, t.c, true, hit);
    if (p) { const dd = p.distanceTo(o); if (dd < best) best = dd; }
  }
  return best < maxD ? best : -1;
}
let seed = 987654321;
const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
const b = game.world.bounds;
let mismatches = 0, tested = 0, hits = 0; const bad = [];
const axisDirs = [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]];
for (let i = 0; i < 6000; i++) {
  const o = new THREE.Vector3(b.min.x + rnd() * (b.max.x - b.min.x), b.min.y + rnd() * (b.max.y - b.min.y), b.min.z + rnd() * (b.max.z - b.min.z));
  let d;
  if (i % 5 === 0) d = new THREE.Vector3(...axisDirs[i % 6]); else d = new THREE.Vector3(rnd() * 2 - 1, rnd() * 2 - 1, rnd() * 2 - 1).normalize();
  const maxD = 5 + rnd() * 150;
  const a = col.raycast(o, d, maxD);
  const bb = brute(o, d, maxD);
  tested++;
  if (a) hits++;
  const ad = a ? a.distance : -1;
  if (Math.abs(ad - bb) > 1e-4) { mismatches++; if (bad.length < 6) bad.push({ o: o.toArray(), d: d.toArray(), maxD, octree: ad, brute: bb }); }
}
out.tested = tested; out.hits = hits; out.mismatches = mismatches; out.bad = bad;
return out;
