import * as THREE from 'three';
const st = { geoDispose: 0, matDispose: 0, log: [] };
const origG = THREE.BufferGeometry.prototype.dispose, origM = THREE.Material.prototype.dispose;
THREE.BufferGeometry.prototype.dispose = function () { st.geoDispose++; return origG.call(this); };
THREE.Material.prototype.dispose = function () { st.matDispose++; return origM.call(this); };
export function setup(game, report) { report.custom = { log: st.log }; game.player.god = true; st.base = game.scene.children.length; }
const kill = (game) => {
  const p = game.player;
  for (const b of game.bots.list) {
    if (!b.alive) continue;
    b.spawnProtectedUntil = 0;
    const chest = b.getChestPosition(new THREE.Vector3());
    game.combat.kill(b, { attacker: p, weapon: 'rifle', point: chest, direction: new THREE.Vector3(0.3, 0.2, 1).normalize() });
  }
};
const snap = (game, tag) => st.log.push({ tag, gibs: game.effects.gibList.length, children: game.scene.children.length, base: st.base, geoDispose: st.geoDispose, matDispose: st.matDispose, gibMeshesInScene: game.scene.children.filter(o => o.name && o.name.startsWith('gib_')).length, t: +game.time.toFixed(2) });
export function drive(t, dt, game, report) {
  if (t > 1 && !st.w1) { st.w1 = true; snap(game, 'before-kill'); kill(game); snap(game, 'after-kill'); }
  if (t > 1.6 && !st.s1) { st.s1 = true; snap(game, '0.6s'); }
  if (t > 2.2 && !st.clr) { st.clr = true; snap(game, 'pre-clear'); game.effects.clear(); snap(game, 'post-clear'); }
  if (t > 3 && !st.s2) { st.s2 = true; snap(game, '3s'); }
  if (t > 6 && !st.w2) { st.w2 = true; kill(game); snap(game, 'wave2'); }
  if (t > 8 && !st.s3) { st.s3 = true; snap(game, 'wave2+2s'); }
  if (t > 11 && !st.s4) { st.s4 = true; snap(game, 'wave2+5s'); }
}
export function finish(game, report) { report.custom.stats = game.effects.stats; }
