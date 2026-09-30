const g = window.__GAME__;
g.state = 'paused';
const b = g.bots.list[0];
const V = b.position.constructor;
const it = b.brain.intent;
const res = [];
function place(x, y, z, yaw) {
  b.teleportTo(new V(x, y, z), yaw);
  g.time += 1; b._noSnapUntil = 0; b.velocity.set(0, 0, 0);
  b.crouch = 0; b.height = 1.8; b._syncCapsule();
  it.moveX = 0; it.moveZ = 0; it.speed = 0; it.jump = false; it.crouch = false;
  for (let i = 0; i < 30; i++) { g.time += 1 / 60; b._move(1 / 60); }
}
for (const fps of [240, 144, 60, 30, 20]) {
  const dt = 1 / fps;
  place(0, 0, 24, 0);
  const y0 = b.position.y;
  const start = { y0, og: b.onGround };
  let apex = 0, air = 0, n = 0;
  it.jump = true;
  for (let i = 0; i < fps * 2; i++) {
    g.time += dt; b._move(dt); it.jump = false; n++;
    apex = Math.max(apex, b.position.y - y0);
    if (!b.onGround) air += dt;
    if (i > 3 && b.onGround) break;
  }
  res.push({ fps, start, apex: +apex.toFixed(3), air: +air.toFixed(3), endY: b.position.y });
}
g.state = 'playing';
return res;
