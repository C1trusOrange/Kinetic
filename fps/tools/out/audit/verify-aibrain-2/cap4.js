// Finding 4: walk links whose interpolated standing capsule intersects geometry.
import * as THREE from 'three';
const f = v => +v.toFixed(2);
export async function setup(game, report) {
  const C = report.custom = {};
  const nav = game.world.nav, col = game.world.collision;
  const c2 = new (game.bots.list[0].capsule.constructor)(new THREE.Vector3(), new THREE.Vector3(), 0.4);
  const bad = [];
  let total = 0;
  const seen = new Set();
  for (const n of nav.nodes) for (const l of n.links) {
    if (l.type !== 'walk' || l.pad) continue;
    const m = nav.nodes[l.to];
    const key = Math.min(n.id, m.id) + '_' + Math.max(n.id, m.id);
    if (seen.has(key)) continue; seen.add(key);
    total++;
    let worst = 0;
    for (const s of [0.25, 0.5, 0.75]) {
      const x = n.position.x + (m.position.x - n.position.x) * s, y = n.position.y + (m.position.y - n.position.y) * s, z = n.position.z + (m.position.z - n.position.z) * s;
      c2.start.set(x, y + 0.4, z); c2.end.set(x, y + 1.4, z);
      const h = col.capsuleIntersect(c2);
      if (h && h.depth > worst) worst = h.depth;
    }
    if (worst > 0.05) bad.push({ a: [f(n.position.x), f(n.position.y), f(n.position.z)], b: [f(m.position.x), f(m.position.y), f(m.position.z)], depth: f(worst) });
  }
  C.total = total; C.bad = bad.length;
  C.near_wall = bad.filter(b => b.a[0] > -26 && b.a[0] < -21 && b.a[2] > 20.5 && b.a[2] < 24);
  C.sample = bad.slice(0, 40);
  C.byRegion = {};
  for (const b of bad) { const k = `${Math.round(b.a[0] / 6) * 6},${Math.round(b.a[1])},${Math.round(b.a[2] / 6) * 6}`; C.byRegion[k] = (C.byRegion[k] || 0) + 1; }
  // wall geometry probe
  C.probe = [];
  for (const z of [21.0, 21.5, 22.0, 22.5, 23.0]) {
    const o = new THREE.Vector3(-23.5, -1.6 + 0.02, z);
    // upward ray from floor
    const up = col.raycast(o, new THREE.Vector3(0, 1, 0), 4);
    C.probe.push({ z, upHit: up ? f(up.point.y) : null });
  }
  game.autotest.duration = game.autotest.t + 0.05;
}
export function drive() {}
