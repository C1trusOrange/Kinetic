// rocket jump: explosion under the player's feet while grounded (Combat knockback -> Player.applyImpulse)
const pl = game.player;
pl.god = false;
await sleep(1500);
const out = { y0: +pl.position.y.toFixed(2), onGround0: pl.onGround };
const center = new THREE.Vector3(pl.position.x, pl.position.y - 0.05 + 0.15, pl.position.z + 0.3);  // rocket hits the floor just in front of the feet
const hp0 = pl.health;
pl.spawnProtectedUntil = 0;
game.combat.radialDamage(center, { radius: 4.8, damage: 95, attacker: pl, weapon: 'rocket', knockback: 15, selfScale: 0.35 });
out.velAfter = pl.velocity.toArray().map(v => +v.toFixed(2));
out.hpLost = +(hp0 - pl.health).toFixed(1);
let peak = pl.position.y, tPeak = 0, t0 = game.time;
for (let i = 0; i < 150; i++) { await sleep(20); if (pl.position.y > peak) { peak = pl.position.y; tPeak = game.time - t0; } }
out.peakHeight = +(peak - out.y0).toFixed(2);
out.tPeak = +tPeak.toFixed(2);
out.sameCenterUnderFeet = null;
return out;
