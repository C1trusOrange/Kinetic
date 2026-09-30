const g = window.__GAME__;
g.state = 'paused';
const b = g.bots.list[0];
const V = b.position.constructor;
const it = b.brain.intent;
const heights = [1.3, 1.4, 1.5, 1.6, 1.7];
const res = {};
function trial(k, fps, d) {
  const dt = 1 / fps;
  const zc = -30 + k * 12;
  b.teleportTo(new V(0, 0, zc), -Math.PI / 2);
  g.time += 1; b._noSnapUntil = 0; b.velocity.set(0, 0, 0); b.crouch = 0; b.height = 1.8; b._syncCapsule();
  it.moveX = 0; it.moveZ = 0; it.speed = 0; it.jump = false; it.crouch = false;
  for (let i = 0; i < 20; i++) { g.time += 1 / 60; b._move(1 / 60); }
  it.moveX = 1; it.moveZ = 0; it.speed = 7.2;
  // accelerate until close to the step face (x=10 - capsule radius) minus d
  let jumped = false, n = 0;
  const faceX = 10;
  while (n++ < fps * 6) {
    const dist = faceX - (b.position.x + 0.4);
    it.jump = false;
    if (!jumped && dist <= d) { it.jump = true; jumped = true; }
    g.time += dt; b._move(dt);
    if (jumped && b.onGround && n > 5 && b._lastJump < g.time - 0.4) break;
    if (n > fps * 3 && !jumped) break;
  }
  // continue a bit more
  for (let i = 0; i < fps * 0.6; i++) { it.jump = false; g.time += dt; b._move(dt); }
  const h = heights[k];
  return b.onGround && b.position.y >= h - 0.05 && b.position.x > 10;
}
for (const fps of [144, 60, 30, 20]) {
  res[fps] = {};
  heights.forEach((h, k) => {
    const okAt = [];
    for (let d = 0.2; d <= 2.6; d += 0.2) if (trial(k, fps, d)) okAt.push(+d.toFixed(1));
    res[fps][h] = okAt.length ? { n: okAt.length, from: okAt[0], to: okAt[okAt.length - 1] } : 'never';
  });
}
g.state = 'playing';
return res;
