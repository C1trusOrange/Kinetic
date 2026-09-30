import * as THREE from 'three';
const st = { acc: {}, n: {} };
const E0 = { orig: null };
export function setup(game, report) {
  report.custom = { phases: {} };
  game.player.god = true;
  const E = game.effects;
  E0.orig = E.update.bind(E);
  E.update = function (dt) { const t0 = performance.now(); E0.orig(dt); const ms = performance.now() - t0; const ph = st.phase || 'idle'; st.acc[ph] = (st.acc[ph] || 0) + ms; st.n[ph] = (st.n[ph] || 0) + 1; st.max = st.max || {}; st.max[ph] = Math.max(st.max[ph] || 0, ms); };
}
const kill = (game) => {
  for (const b of game.bots.list) {
    if (!b.alive) continue;
    b.spawnProtectedUntil = 0;
    game.combat.kill(b, { attacker: game.player, weapon: 'rifle', point: b.getChestPosition(new THREE.Vector3()), direction: new THREE.Vector3(0.3, 0.2, 1).normalize() });
  }
};
export function drive(t, dt, game, report) {
  const p = game.player;
  if (t > 1 && !st.k) { st.k = true; st.phase = 'gibs'; kill(game); }
  if (t > 1.8 && st.phase === 'gibs') st.phase = 'gibs-late';
  if (t > 4.5 && !st.r) {
    st.r = true; st.phase = 'rockets';
    p.spawn(new THREE.Vector3(0, 0.05, 27), 0);
    for (let i = 0; i < 6; i++) {
      const yaw = (i / 5 - 0.5) * 1.6;
      game.projectiles.spawnRocket({ owner: p, origin: new THREE.Vector3(0, 1.5, 26), direction: new THREE.Vector3(-Math.sin(yaw), 0.05, -Math.cos(yaw)).normalize() });
    }
  }
  if (t > 8) st.phase = 'idle2';
}
export function finish(game, report) {
  const out = {};
  for (const k of Object.keys(st.acc)) out[k] = { avgMs: +(st.acc[k] / st.n[k]).toFixed(3), maxMs: +st.max[k].toFixed(2), frames: st.n[k] };
  report.custom.phases = out;
  report.custom.stats = game.effects.stats;
}
