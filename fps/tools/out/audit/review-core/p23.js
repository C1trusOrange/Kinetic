// spawn quality: distance to nearest enemy and enemy line-of-sight at the moment of each respawn
const stats = [];
game.events.on('spawn', ({ entity }) => {
  if (game.time < 1) return; // skip match-start batch
  let minD = 999, sees = 0, seesClose = 0;
  const eye = entity.getEyePosition(new THREE.Vector3());
  for (const o of game.entities) {
    if (o === entity || !o.alive || o.team === entity.team) continue;
    const d = o.position.distanceTo(entity.position);
    if (d < minD) minD = d;
    if (d < 60 && game.combat.canSee(o.getEyePosition(new THREE.Vector3()), eye)) { sees++; if (d < 25) seesClose++; }
  }
  stats.push({ minD, sees, seesClose, who: entity.isPlayer ? 'player' : 'bot' });
});
const tEnd = game.time + 90;
while (game.time < tEnd) await sleep(500);
const n = stats.length;
const q = (arr, p) => { const s = [...arr].sort((a, b) => a - b); return +s[Math.min(s.length - 1, Math.floor(p * s.length))].toFixed(1); };
return { respawns: n, minDist: { p10: q(stats.map(s => s.minD), 0.1), p50: q(stats.map(s => s.minD), 0.5) },
  within10m: stats.filter(s => s.minD < 10).length, within6m: stats.filter(s => s.minD < 6).length,
  visibleToEnemy: stats.filter(s => s.sees > 0).length, visibleWithin25m: stats.filter(s => s.seesClose > 0).length };
