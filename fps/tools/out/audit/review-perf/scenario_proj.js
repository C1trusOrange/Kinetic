import * as THREE from 'three';
const S = { rec: [] };
export function setup(game, report) {
  report.custom = {};
  const orr = game.render.bind(game);
  game.render = function () { orr(); S.last = { calls: game.renderer.info.render.calls, tris: game.renderer.info.render.triangles }; };
}
let phase = 0, wait = 0;
const rd = (label, game) => { S.rec.push({ label, ...S.last }); };
export function drive(t, dt, game, report) {
  game.player.god = true;
  for (const b of game.bots.list) { b.god = true; if (b.model) b.model.root.visible = false; }
  const p = game.player;
  const eye = p.getEyePosition(new THREE.Vector3());
  const dir = p.getAimDirection(new THREE.Vector3());
  if (t < 3) return;
  wait++;
  if (phase === 0 && wait > 5) { rd('baseline', game); phase = 1; wait = 0; game.projectiles.spawnRocket({ owner: p, origin: eye.clone().addScaledVector(dir, 2), direction: dir }); }
  else if (phase === 1 && wait > 2) { rd('1 rocket', game); phase = 2; wait = 0; game.projectiles.spawnRocket({ owner: p, origin: eye.clone().addScaledVector(dir, 2.5).add(new THREE.Vector3(0, 0.3, 0)), direction: dir }); game.projectiles.spawnRocket({ owner: p, origin: eye.clone().addScaledVector(dir, 3).add(new THREE.Vector3(0, -0.3, 0)), direction: dir }); }
  else if (phase === 2 && wait > 2) { rd('3 rockets', game); phase = 3; wait = 0; }
  else if (phase === 3 && wait > 40) {
    // wait for explosions to clear
    rd('after', game); phase = 4; wait = 0;
    for (let i = 0; i < 4; i++) game.projectiles.spawnGrenade({ owner: p, origin: eye.clone().addScaledVector(dir, 2 + i * 0.2), velocity: dir.clone().multiplyScalar(0.5), fuse: 5 });
  } else if (phase === 4 && wait > 3) { rd('4 grenades', game); phase = 5; }
}
export function finish(game, report) { report.custom = { rec: S.rec, rocketMeshes: 0 }; }
