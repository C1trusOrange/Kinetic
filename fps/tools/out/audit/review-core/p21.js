// differential test: octree.getCapsuleTriangles + triangleCapsuleIntersect vs brute force over all triangles
const col = game.world.collision;
const oct = col.octree;
const all = new Set();
const walk = n => { for (const t of n.triangles) all.add(t); for (const s of n.subTrees) walk(s); };
walk(oct);
const tris = [...all];
let seed = 555;
const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
const b = game.world.bounds;
const R = 0.4;
let tested = 0, withContact = 0, missed = 0, depthDiff = 0; const bad = [];
for (let i = 0; i < 5000; i++) {
  const o = new THREE.Vector3(b.min.x + rnd() * (b.max.x - b.min.x), b.min.y + rnd() * (b.max.y - b.min.y), b.min.z + rnd() * (b.max.z - b.min.z));
  const d = new THREE.Vector3(rnd() * 2 - 1, rnd() * 2 - 1, rnd() * 2 - 1).normalize();
  const h = col.raycast(o, d, 120);
  if (!h) continue;
  // place capsule (standing or crouched) close to the surface, sometimes slightly penetrating
  const off = 0.1 + rnd() * 0.5;
  const p = h.point.clone().addScaledVector(h.normal, off);
  const hgt = rnd() < 0.5 ? 1.8 : 1.15;
  const yoff = rnd() * 1.4 - 0.2;
  const cap = new Capsule(new THREE.Vector3(p.x, p.y + yoff, p.z), new THREE.Vector3(p.x, p.y + yoff + hgt - 2 * R, p.z), R);
  const cand = [];
  oct.getCapsuleTriangles(cap, cand);
  const candSet = new Set(cand);
  tested++;
  let any = false;
  for (const t of tris) {
    const r = oct.triangleCapsuleIntersect(cap, t);
    if (r && r.depth > 1e-7) {
      any = true;
      if (!candSet.has(t)) { missed++; if (bad.length < 4) bad.push({ cap: [cap.start.toArray(), cap.end.toArray()], tri: [t.a.toArray(), t.b.toArray(), t.c.toArray()], depth: r.depth }); }
    }
  }
  if (any) withContact++;
}
return { tested, withContact, missedTriangles: missed, bad };
