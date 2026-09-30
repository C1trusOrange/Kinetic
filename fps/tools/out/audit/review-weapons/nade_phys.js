import * as THREE from 'three';
function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const R = rng(77);
const list = [];
const rec = { n: 0, fell: 0, inside: [], nan: 0, resting: 0, moving: [], bounds: null, ySamples: [] };
export function setup(game, report) {
  report.custom = rec;
  game.player.god = true;
  const b = game.world.bounds;
  rec.bounds = [b.min.toArray(), b.max.toArray()].map(a => a.map(v => +v.toFixed(1)));
  for (let i = 0; i < 80; i++) {
    const o = new THREE.Vector3(b.min.x + 8 + R() * (b.max.x - b.min.x - 16), 1 + R() * 6, b.min.z + 8 + R() * (b.max.z - b.min.z - 16));
    const sp = 4 + R() * 26;
    const d = new THREE.Vector3(R() - 0.5, R() * 0.8 - 0.3, R() - 0.5).normalize();
    // skip origins inside geometry: require a clear ray upward 0.3
    const g = game.projectiles.spawnGrenade({ owner: null, origin: o, velocity: d.multiplyScalar(sp), fuse: 40 });
    list.push({ g, o: o.clone(), sp });
  }
  rec.n = list.length;
}
let t9 = false;
export function drive(t, dt, game, report) {
  for (const it of list) {
    const g = it.g;
    if (!g.active) continue;
    if (!Number.isFinite(g.position.x + g.position.y + g.position.z + g.velocity.x + g.velocity.y + g.velocity.z)) { rec.nan++; g.active = false; }
  }
  if (t > 9 && !t9) {
    t9 = true;
    const down = new THREE.Vector3(0, -1, 0);
    for (const it of list) {
      const g = it.g;
      if (!g.active) { rec.fell++; continue; }
      const sp = g.velocity.length();
      if (g.resting) rec.resting++;
      if (sp > 0.5) rec.moving.push({ pos: g.position.toArray().map(v => +v.toFixed(2)), sp: +sp.toFixed(2), resting: g.resting });
      // is it inside/under geometry? cast a ray from far above downward
      const up = new THREE.Vector3(g.position.x, g.position.y + 0.5, g.position.z);
      const h = game.world.raycast(up, down, 60);
      if (h && h.point.y > g.position.y + 0.02) rec.inside.push({ pos: g.position.toArray().map(v => +v.toFixed(2)), floor: +h.point.y.toFixed(2), start: it.o.toArray().map(v => +v.toFixed(1)), sp: +it.sp.toFixed(1) });
      if (g.position.y < game.world.bounds.min.y - 1) rec.ySamples.push(+g.position.y.toFixed(1));
    }
  }
}
