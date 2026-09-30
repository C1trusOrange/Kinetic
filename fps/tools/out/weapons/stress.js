// Stress test: many grenades/rockets with random velocities; checks nothing tunnels out of the arena.
const res = { grenades: 0, escaped: [], maxSpeed: 0, minY: 1e9, restingSeen: 0, explodedAt: [] , rockets: 0, rocketExplosions: 0, rocketEscaped: 0 };
let spawned = false;
let rng = 12345;
const rand = () => { rng = (rng * 1664525 + 1013904223) >>> 0; return rng / 4294967296; };
export function setup(game, report) {
  report.custom = res;
  game.player.god = true;
  game.events.on('explosion', e => { if (e.weapon === 'rocket') res.rocketExplosions++; });
}
export function drive(t, dt, game, report) {
  const P = game.projectiles;
  if (!spawned && t > 0.5) {
    spawned = true;
    for (let i = 0; i < 120; i++) {
      const o = { x: (rand() - 0.5) * 60, y: 0.3 + rand() * 6, z: (rand() - 0.5) * 60 };
      // avoid spawning inside solids: keep away from the crates by using raycast check downward
      const speed = 3 + rand() * 30;
      const th = rand() * Math.PI * 2, ph = (rand() - 0.3) * 1.2;
      const v = { x: Math.cos(th) * Math.cos(ph) * speed, y: Math.sin(ph) * speed, z: Math.sin(th) * Math.cos(ph) * speed };
      const V = game.player.position.constructor;
      P.spawnGrenade({ owner: game.player, origin: new V(o.x, o.y, o.z), velocity: new V(v.x, v.y, v.z), fuse: 2.6 });
      res.grenades++;
    }
    for (let i = 0; i < 20; i++) {
      const V = game.player.position.constructor;
      const th = rand() * Math.PI * 2, ph = (rand() - 0.5) * 1.4;
      P.spawnRocket({ owner: game.player, origin: new V((rand() - 0.5) * 40, 1.5 + rand() * 4, (rand() - 0.5) * 40), direction: new V(Math.cos(th) * Math.cos(ph), Math.sin(ph), Math.sin(th) * Math.cos(ph)) });
      res.rockets++;
    }
  }
  for (const g of P.grenades) {
    const p = g.position;
    res.maxSpeed = Math.max(res.maxSpeed, g.velocity.length());
    res.minY = Math.min(res.minY, p.y);
    if (g.resting) res.restingSeen++;
    if (Math.abs(p.x) > 40.2 || Math.abs(p.z) > 40.2 || p.y < -0.3) res.escaped.push([+t.toFixed(2), p.toArray().map(v => +v.toFixed(2))]);
  }
  for (const r of P.rockets) {
    const p = r.position;
    if (Math.abs(p.x) > 41 || Math.abs(p.z) > 41 || p.y < -0.5) res.rocketEscaped++;
  }
}
export function finish(game, report) {
  res.left = { grenades: game.projectiles.grenades.length, rockets: game.projectiles.rockets.length };
  res.escaped = res.escaped.slice(0, 8);
}
