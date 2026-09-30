// Probe candidate hill-zone centres and weapon-pad spots on the loaded stock map: floor height, headroom, nav reachability.
import * as THREE from 'three';
const Z = {
  foundry: {
    zones: [['hall', 0, 0, 2.2, 7.5], ['plazaE', 34, 0, 0, 8], ['trench', 0, -4, 26, 7], ['yardN', 0, 0, -32, 8], ['gantry', 0, 5, 16, 7], ['tanks', 38.5, 10, -37, 6]],
    pads: [[14, 0, 6], [-24, 0, 4], [-5, -4, 26], [5, -4, 26], [10, 0, 36], [-8, 0, 40]],
  },
  ruins: {
    zones: [['ziggurat', 0, 9, 0, 6], ['hall', 0, 0, -40, 8], ['courtyard', -27, -0.75, 20, 7], ['bazaar', 22, 0, 30, 8], ['shelfE', 40, 4.5, 0, 7], ['plazaS', 0, 0, 40, 8]],
    pads: [[-24, 0, -20], [24, 0, -20], [4, 4.5, 8], [-8, 0, 20], [8, 0, 20], [40, 4.5, -8]],
  },
  skyline: {
    zones: [['plazaS', 0, 0, 9, 8], ['plazaE', 9, 0, 0, 8], ['plazaW', -9, 0, 0, 8], ['roofN', 0, 6.4, -28, 8], ['bridgeNE', 28, 9.6, -14, 6], ['roofE', 28, 9.6, 0, 7], ['roofSE', 26, 12.8, 28, 7], ['roofW', -28, 12.8, -4, 7]],
    pads: [[14, 0, 0], [-14, 0, 0], [22, 9.6, -20], [4, 6.4, -24], [0, 0, 14], [0, 0, -14]],
  },
};

export function setup(game, report) {
  const w = game.world, nav = w.nav, col = w.collision;
  const spawns = w.spawnPoints.map(s => s.position);
  const ref = spawns[0];
  const down = new THREE.Vector3(0, -1, 0), up = new THREE.Vector3(0, 1, 0);
  const probe = (name, x, y, z, r) => {
    const c = new THREE.Vector3(x, y, z);
    const o = c.clone(); o.y += 1.2;
    const hit = col.raycast(o, down, 4);
    const fy = hit ? hit.point.y : null;
    let head = null;
    if (hit) { const o2 = hit.point.clone(); o2.y += 0.1; const u = col.raycast(o2, up, 4); head = u ? +u.distance.toFixed(2) : 4; }
    const nn = nav.nearestNode(c, 2.5);
    let inZone = 0, reach = 0;
    if (r) for (const n of nav.nodes) {
      const dx = n.position.x - x, dz = n.position.z - z;
      if (dx * dx + dz * dz <= r * r && Math.abs(n.position.y - y) <= 3) { inZone++; if (nav.isConnected(ref, n.position)) reach++; }
    }
    return { name, at: [x, y, z], r, floorY: fy == null ? null : +fy.toFixed(2), head, conn: nn ? nav.isConnected(ref, nn.position) : false, navIn: inZone, reachIn: reach };
  };
  const t = Z[game.world.mapId] || { zones: [], pads: [] };
  report.custom = {
    map: game.world.mapId,
    zones: t.zones.map(([n, x, y, z, r]) => probe(n, x, y, z, r)),
    pads: t.pads.map(([x, y, z], i) => probe('pad' + i, x, y, z, 0)),
  };
}
export function drive() {}
