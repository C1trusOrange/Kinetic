const g = window.__GAME__;
g.state = 'paused';
const bots = g.bots.list.slice(0, 4);
const V = bots[0].position.constructor;
for (const b of g.bots.list) { b.brain.update = () => { const it = b.brain.intent; it.moveX = it.moveZ = it.speed = 0; it.jump = it.crouch = it.fire = it.reload = false; }; }
const out = {};
function run(label, positions, secs, dt) {
  bots.forEach((b, i) => { b.teleportTo(new V(...positions[i]), 0); b.velocity.set(0, 0, 0); });
  g.time += 1;
  for (const b of bots) b._noSnapUntil = 0;
  const log = [];
  for (let s = 0; s < secs / dt; s++) {
    g.time += dt; g.bots.update(dt);
    if (s % Math.round(0.25 / dt) === 0) {
      let minD = 99; for (let i = 0; i < bots.length; i++) for (let j = i + 1; j < bots.length; j++) minD = Math.min(minD, Math.hypot(bots[i].position.x - bots[j].position.x, bots[i].position.z - bots[j].position.z));
      log.push(+minD.toFixed(2));
    }
  }
  const fin = bots.map(b => b.position.toArray().map(v => +v.toFixed(2)));
  out[label] = { minDistOverTime: log, final: fin, speeds: bots.map(b => +b.speed.toFixed(2)) };
}
run('same spot (open floor)', [[0, 0, 24], [0, 0, 24], [0, 0, 24], [0, 0, 24]], 4, 1 / 60);
run('0.3m apart', [[0, 0, 24], [0.3, 0, 24], [0, 0, 24.3], [0.3, 0, 24.3]], 4, 1 / 60);
run('same spot 20fps', [[0, 0, 24], [0, 0, 24], [0, 0, 24], [0, 0, 24]], 4, 1 / 20);
g.state = 'playing';
return out;
