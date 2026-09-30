import * as THREE from 'three';
import { Capsule } from 'three/addons/math/Capsule.js';
export async function setup(game, report) {
  const out = report.custom = { map: game.world.mapId, spawns: [], warnings: game.world.warnings };
  const col = game.world.collision;
  for (const sp of game.world.spawnPoints) {
    const p = sp.position;
    const cap = new Capsule(new THREE.Vector3(p.x, p.y + 0.4, p.z), new THREE.Vector3(p.x, p.y + 1.4, p.z), 0.4);
    const r = col.capsuleIntersect(cap);
    // resolve and see where we end
    const cap2 = new Capsule(new THREE.Vector3(p.x, p.y + 0.4, p.z), new THREE.Vector3(p.x, p.y + 1.4, p.z), 0.4);
    const c = col.resolveCapsule(cap2);
    out.spawns.push({ p: p.toArray().map(v => +v.toFixed(2)), depth: r ? +r.depth.toFixed(3) : 0, n: r ? r.normal.toArray().map(v => +v.toFixed(2)) : null, resolvedDy: +(cap2.start.y - (p.y + 0.4)).toFixed(3), contacts: c.count });
  }
  out.embeddedSpawns = out.spawns.filter(s => s.depth > 0.05);
}
export function drive() {}
