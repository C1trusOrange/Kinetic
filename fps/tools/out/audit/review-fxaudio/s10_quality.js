import * as THREE from 'three';
export function setup(game, report) { report.custom = {}; }
let done = false;
export function drive(t, dt, game, report) {
  if (done || t < 0.5) return; done = true;
  const E = game.effects, n = new THREE.Vector3(0, 1, 0), c = report.custom;
  for (let i = 0; i < 120; i++) E._decal(1, i * 0.3 - 18, 0.01, 5, n, 0.25, [1, 1, 1], 0.9, 40, false);
  c.highLive = E.decals.liveCount;
  game.setQuality('low');
  for (let i = 0; i < 60; i++) E._decal(1, i * 0.3 - 18, 0.01, 8, n, 0.25, [1, 1, 1], 0.9, 40, false);
  c.lowLive = E.decals.liveCount;
  c.lowMax = game.quality.maxDecals;
}
export function finish() {}
