// Reports nav connectivity for spawns / pickups / zones of whatever map is loaded (custom or stock), plus floor probes.
import * as THREE from 'three';
export function setup(game, report) {
  const w = game.world, nav = w.nav, col = w.collision;
  const V = a => new THREE.Vector3(a[0], a[1], a[2]);
  const def = w.def;
  const spawns = w.spawnPoints.map(s => s.position);
  const ref = spawns[0];
  const out = { map: def.id, nodes: nav.stats && nav.stats.nodes, spawns: [], pickups: [], zones: [], probes: [] };
  spawns.forEach((p, i) => out.spawns.push({ i, pos: p.toArray().map(v => +v.toFixed(1)), conn: nav.isConnected(ref, p), node: !!nav.nearestNode(p, 3) }));
  (w.pickups.list || []).forEach((p, i) => out.pickups.push({ i, type: p.type, weapon: p.weapon, pos: p.position.toArray().map(v => +v.toFixed(1)), conn: nav.isConnected(ref, p.position) }));
  for (const z of (def.zones || [])) {
    const c = V(z.pos);
    const near = nav.nearestNode(c, 6);
    // floor probe straight down from 1.5 m above the zone centre
    const o = c.clone(); o.y += 1.5;
    const hit = col.raycast(o, new THREE.Vector3(0, -1, 0), 8);
    // count reachable nav nodes within the zone radius (horizontal) and |dy| <= 3
    let inZone = 0, reach = 0;
    for (const n of nav.nodes) {
      const dx = n.position.x - c.x, dz = n.position.z - c.z;
      if (dx * dx + dz * dz <= z.radius * z.radius && Math.abs(n.position.y - c.y) <= 3) {
        inZone++;
        if (nav.isConnected(ref, n.position)) reach++;
      }
    }
    out.zones.push({ id: z.id, node: !!near, floorY: hit ? +hit.point.y.toFixed(2) : null, conn: near ? nav.isConnected(ref, near.position) : false, navNodesInZone: inZone, reachable: reach });
  }
  report.custom = out;
}
export function drive() {}
