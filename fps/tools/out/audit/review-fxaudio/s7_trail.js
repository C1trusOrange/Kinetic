import * as THREE from 'three';
const mode = new URLSearchParams(location.search).get('mode') || 'two';
const st = { frames: 0 };
export function setup(game, report) { report.custom = { mode, samples: [] }; game.player.god = true; }
export function drive(t, dt, game, report) {
  const c = report.custom, p = game.player, E = game.effects;
  if (t < 0.3) return;
  if (!st.fired) {
    st.fired = true;
    p.spawn(new THREE.Vector3(0, 0.05, 27), 0);
    const dir = new THREE.Vector3(0, 0.02, -1).normalize();
    const sep = mode === 'two' ? 3 : 0;
    game.projectiles.spawnRocket({ owner: p, origin: new THREE.Vector3(-sep / 2, 1.5, 26), direction: dir });
    if (mode === 'two') game.projectiles.spawnRocket({ owner: p, origin: new THREE.Vector3(sep / 2, 1.5, 26), direction: dir });
    if (mode === 'far') game.projectiles.spawnRocket({ owner: p, origin: new THREE.Vector3(12, 1.5, 26), direction: dir });
  }
  st.frames++;
  if (st.frames <= 40) c.samples.push(E.smoke.count);
  c.rockets = game.projectiles.rockets.length;
}
export function finish() {}
