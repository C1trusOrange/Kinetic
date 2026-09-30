import * as THREE from 'three';
const rec = { calls: 0, hits: 0, frames: 0, resting: null, speedAtEnd: null };
let phase = 0, t0 = 0, orig = null;
export function setup(game, report) { report.custom = rec; game.player.god = true; }
export function drive(t, dt, game, report) {
  const p = game.player;
  if (phase === 0 && t > 1) {
    const o = p.position.clone(); o.y += 1.2; o.z -= 3;
    game.projectiles.spawnGrenade({ owner: p, origin: o, velocity: new THREE.Vector3(0, 0, 0), fuse: 6 });
    phase = 1; t0 = t;
  } else if (phase === 1 && t - t0 > 2.0) {
    const g = game.projectiles.grenades[0];
    rec.resting = g ? g.resting : null;
    orig = game.combat.raycast.bind(game.combat);
    game.combat.raycast = (...a) => { const h = orig(...a); rec.calls++; if (h) rec.hits++; return h; };
    phase = 2; t0 = t;
  } else if (phase === 2) {
    rec.frames++;
    if (t - t0 > 1.0) { game.combat.raycast = orig; const g = game.projectiles.grenades[0]; rec.speedAtEnd = g ? g.velocity.length() : null; rec.resting2 = g ? g.resting : null; phase = 3; }
  }
}
