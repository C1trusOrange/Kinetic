import * as THREE from 'three';
const N = parseInt(new URLSearchParams(location.search).get('n') || '6', 10);
const st = { maxSmoke: 0, maxGlow: 0, maxDrop: 0, frames: 0 };
export function setup(game, report) { report.custom = { N }; game.player.god = true; }
export function drive(t, dt, game, report) {
  const c = report.custom, p = game.player, E = game.effects;
  if (t < 0.3) return;
  if (!st.fired) {
    st.fired = true;
    p.spawn(new THREE.Vector3(0, 0.05, 27), 0);
    for (let i = 0; i < N; i++) {
      const yaw = (i / Math.max(1, N - 1) - 0.5) * 1.6;
      const dir = new THREE.Vector3(-Math.sin(yaw), 0.04 + 0.05 * (i % 3), -Math.cos(yaw)).normalize();
      game.projectiles.spawnRocket({ owner: p, origin: new THREE.Vector3(0, 1.5, 26), direction: dir });
    }
    st.t0 = t;
  }
  st.frames++;
  const s = E.stats;
  st.maxSmoke = Math.max(st.maxSmoke, E.smoke.count);
  st.maxGlow = Math.max(st.maxGlow, E.glow.count);
  st.maxDrop = Math.max(st.maxDrop, E.smoke.dropped + E.glow.dropped);
  c.smokeDropped = E.smoke.dropped; c.glowDropped = E.glow.dropped;
  c.maxSmoke = st.maxSmoke; c.maxGlow = st.maxGlow; c.rocketsLeft = game.projectiles.rockets.length;
  // explicit stress: 3 explosions in a row when smoke is near capacity
  if (!st.stress && E.smoke.count > 1000) {
    st.stress = true;
    const before = { smoke: E.smoke.count, sd: E.smoke.dropped, gd: E.glow.dropped };
    E.explosion(new THREE.Vector3(5, 1, 0), { radius: 4.8, normal: new THREE.Vector3(0, 1, 0) });
    c.stress = { before, after: { smoke: E.smoke.count, sd: E.smoke.dropped, gd: E.glow.dropped } };
  }
}
export function finish(game, report) { report.custom.final = game.effects.stats; }
