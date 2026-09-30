import * as THREE from 'three';
import { CollisionWorld } from '/src/world/Collision.js';
const sleep = ms => new Promise(r => setTimeout(r, ms));
export function drive() {}

function inTree(world) {
  const set = new Set();
  const stack = [world.octree];
  while (stack.length) { const n = stack.pop(); for (const t of n.triangles) set.add(t); for (const s of n.subTrees) stack.push(s); }
  return set;
}
function boxGeo(min, max) {
  const g = new THREE.BoxGeometry(max[0] - min[0], max[1] - min[1], max[2] - min[2]);
  g.translate((min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2);
  return g;
}
export async function setup(game, report) {
  const c = report.custom = {};
  // record every triangle added via addTriangle so we can identify dropped ones
  const proto = CollisionWorld.prototype;
  const origAdd = proto.addTriangle;
  let recorded = [];
  proto.addTriangle = function (a, b, cc, s) { const before = this.triangleCount; origAdd.call(this, a, b, cc, s); if (this.triangleCount > before) recorded.push(this.octree.triangles[this.octree.triangles.length - 1]); };
  c.maps = {};
  for (const id of ['foundry', 'skyline', 'ruins', 'sandbox']) {
    recorded = [];
    await game.startMatch({ mapId: id, mode: 'ffa', botCount: 0, difficulty: 'normal', scoreLimit: 0, timeLimit: 0 });
    const w = game.world.collision;
    const inSet = inTree(w);
    const missing = recorded.filter(t => !inSet.has(t));
    const n = new THREE.Vector3();
    const info = missing.map(t => { t.getNormal(n); return { n: n.toArray().map(v => +v.toFixed(2)).join(','), x: +t.a.x.toFixed(2), y: +t.a.y.toFixed(2), z: +t.a.z.toFixed(2) }; });
    const norms = {}; for (const m of info) norms[m.n] = (norms[m.n] || 0) + 1;
    c.maps[id] = { triangleCount: w.triangleCount, recorded: recorded.length, inTree: inSet.size, missing: missing.length, missingNormals: norms, boxMin: w.octree.box.min.toArray(), boxMax: w.octree.box.max.toArray() };
  }
  proto.addTriangle = origAdd;

  // synthetic: ground slab + tall tower (top = global max Y) + inward-facing boundary quads on all 4 sides
  const rnd = (a, b) => a + Math.random() * (b - a);
  const round = (v, s) => Math.round(v / s) * s;
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  const fails = { towerTop: 0, wallMaxX: 0, wallMinX: 0, wallMaxZ: 0, wallMinZ: 0 };
  const N = 1500;
  for (let i = 0; i < N; i++) {
    const W = round(rnd(20, 120), 0.5), D = round(rnd(20, 120), 0.5);
    const H = round(rnd(6, 40), 0.5);
    const gy = -round(rnd(0.5, 8), 0.5);
    const w = new CollisionWorld();
    w.addGeometry(boxGeo([-W / 2, gy, -D / 2], [W / 2, 0, D / 2]), null, 'concrete');
    const tx = 0, tz = 0;
    w.addGeometry(boxGeo([tx - 2, 0, tz - 2], [tx + 2, H, tz + 2]), null, 'concrete');
    const q = (p0, p1, p2, p3) => { w.addTriangle(p0, p1, p2); w.addTriangle(p0, p2, p3); };
    const h = H - 1;
    q(V(W/2,0,-D/2), V(W/2,0,D/2), V(W/2,h,D/2), V(W/2,h,-D/2));       // x=+W/2, normal -x
    q(V(-W/2,0,D/2), V(-W/2,0,-D/2), V(-W/2,h,-D/2), V(-W/2,h,D/2));   // x=-W/2, normal +x
    q(V(W/2,0,D/2), V(-W/2,0,D/2), V(-W/2,h,D/2), V(W/2,h,D/2));       // z=+D/2, normal -z
    q(V(-W/2,0,-D/2), V(W/2,0,-D/2), V(W/2,h,-D/2), V(-W/2,h,-D/2));   // z=-D/2, normal +z
    w.build();
    const hit = w.raycast(V(tx, H + 5, tz), V(0, -1, 0), 20);
    if (!hit || Math.abs(hit.distance - 5) > 0.01) fails.towerTop++;
    const y0 = 3, off = 8;
    if (!w.raycast(V(W/2 - 5, y0, -D/2 + off), V(1, 0, 0), 20)) fails.wallMaxX++;
    if (!w.raycast(V(-W/2 + 5, y0, -D/2 + off), V(-1, 0, 0), 20)) fails.wallMinX++;
    if (!w.raycast(V(-W/2 + off, y0, D/2 - 5), V(0, 0, 1), 20)) fails.wallMaxZ++;
    if (!w.raycast(V(-W/2 + off, y0, -D/2 + 5), V(0, 0, -1), 20)) fails.wallMinZ++;
  }
  c.synthetic = { trials: N, fails };
}
