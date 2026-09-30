// Verifier: scan every 'walk' link with a standing capsule and count ceiling-blocked links (headroom under a low overhang).
import * as THREE from 'three';
import { Capsule } from 'three/addons/math/Capsule.js';
const f = v => +v.toFixed(2);
export async function setup(game, report) {
  const C = report.custom = {};
  game.autotest.duration = 1e9;
  const nav = game.world.nav, col = game.world.collision;
  const R = parseFloat(game.params.get('r') || '0.3');
  const cap = new Capsule(new THREE.Vector3(), new THREE.Vector3(), R);
  let n = 0, ceil = 0, wall = 0;
  const ex = [];
  const nodes = nav.nodes;
  const seen = new Set();
  for (const a of nodes) {
    for (const l of a.links) {
      if (l.type !== 'walk') continue;
      const b = nodes[l.to];
      const key = a.id < b.id ? a.id + '_' + b.id : b.id + '_' + a.id;
      if (seen.has(key)) continue; seen.add(key);
      n++;
      let blockedCeil = false, blockedWall = false;
      for (const s of [0.25, 0.5, 0.75]) {
        const x = a.position.x + (b.position.x - a.position.x) * s, z = a.position.z + (b.position.z - a.position.z) * s;
        const y = Math.max(a.position.y, b.position.y) + 0.05 + (Math.abs(a.position.y - b.position.y) > 0.3 ? 0 : 0);
        cap.start.set(x, y + R, z); cap.end.set(x, y + 1.8 - R, z);
        const h = col.capsuleIntersect(cap);
        if (h && h.depth > 0.03) { if (h.normal.y < -0.3) blockedCeil = true; else if (Math.abs(h.normal.y) < 0.5) blockedWall = true; }
      }
      if (blockedCeil) { ceil++; if (ex.length < 40) ex.push([f(a.position.x), f(a.position.y), f(a.position.z), '->', f(b.position.x), f(b.position.y), f(b.position.z)].join(' ')); }
      if (blockedWall) wall++;
    }
  }
  C.map = game.world.mapId; C.walkLinks = n; C.ceilBlocked = ceil; C.wallBlocked = wall; C.examples = ex;
  game.autotest.duration = 0;
}
export function drive() {}
