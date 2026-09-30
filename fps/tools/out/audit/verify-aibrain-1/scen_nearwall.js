// Verifier: how often does a bot standing at a valid (capsule-free) floor position get a nearest nav node behind a wall?
const f = v => +v.toFixed(2);
export async function setup(game, report) {
  const C = report.custom = {};
  game.autotest.duration = 1e9;
  const nav = game.world.nav, col = game.world.collision;
  const V = game.player.position.constructor;
  const Cap = col.capsuleIntersect ? null : null;
  // capsule object: use bot capsule class
  const capCtor = game.bots.list[0].capsule.constructor;
  const cap = new capCtor(new V(), new V(), 0.4);
  let seed = 4242; const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const nodes = nav.nodes;
  const N = 6000;
  let valid = 0, blocked = 0, blockedFar = 0, noNode = 0;
  const ex = [], byCell = new Map();
  const o = new V(), d = new V();
  for (let i = 0; i < N; i++) {
    const n = nodes[Math.floor(rnd() * nodes.length)];
    const x = n.position.x + (rnd() * 2 - 1) * 1.2, z = n.position.z + (rnd() * 2 - 1) * 1.2;
    const y = nav.grid.floorNear(x, z, n.position.y, 0.5);
    if (Number.isNaN(y)) continue;
    cap.start.set(x, y + 0.4 + 0.02, z); cap.end.set(x, y + 1.4, z);
    if (col.capsuleIntersect(cap)) continue;        // capsule does not fit here
    valid++;
    const p = new V(x, y, z);
    const nn = nav.nearestNode(p, 8);
    if (!nn) { noNode++; continue; }
    o.set(x, y + 0.5, z); d.set(nn.position.x - x, nn.position.y + 0.5 - (y + 0.5), nn.position.z - z);
    const L = d.length(); d.normalize();
    const h = col.raycast(o, d, L - 0.05);
    if (h) {
      blocked++;
      if (nn.position.distanceTo(p) > 1.2) blockedFar++;
      const key = Math.round(x / 2) * 2 + ',' + Math.round(y) + ',' + Math.round(z / 2) * 2;
      byCell.set(key, (byCell.get(key) || 0) + 1);
      if (ex.length < 8) ex.push({ p: [f(x), f(y), f(z)], node: nn.position.toArray().map(f), blockedAt: f(h.distance), dist: f(L) });
    }
  }
  C.map = game.world.mapId; C.sampled = N; C.valid = valid; C.nearestBlocked = blocked; C.blockedFarther1_2 = blockedFar; C.noNode = noNode;
  C.pctBlocked = f(100 * blocked / Math.max(1, valid));
  C.topCells = [...byCell.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
  C.examples = ex;
  game.autotest.duration = 0;
}
export function drive() {}
