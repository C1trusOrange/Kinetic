await sleep(1500);
const out = {};
const e = game.bots.list[0];
const N = 30;
const t0 = performance.now();
for (let i = 0; i < N; i++) game.pickSpawnPoint(e);
out.pickSpawnMs = +((performance.now() - t0) / N).toFixed(2);
out.alive = game.entities.filter(x => x.alive).length;
out.spawns = game.world.spawnPoints.length;
// radialDamage cost
const c = new THREE.Vector3(0, 1, 0);
const t1 = performance.now();
for (let i = 0; i < 50; i++) game.combat.radialDamage(c, { radius: 0.001, damage: 0, attacker: null });
out.radialMs = +((performance.now() - t1) / 50).toFixed(3);
return out;
