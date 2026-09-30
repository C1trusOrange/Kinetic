const g = window.__GAME__;
g.state = 'paused';
const b = g.bots.list[0];
const V = b.position.constructor;
const it = b.brain.intent;
const info = { map: g.world.mapId, solids: g.world.def.solids.length };
const k = 4, fps = 20, dt = 1 / fps, d = 1.0; // 1.2 m
const zc = -30 + k * 12;
b.teleportTo(new V(0, 0, zc), -Math.PI / 2);
g.time += 1; b._noSnapUntil = 0; b.velocity.set(0, 0, 0); b.crouch = 0; b.height = 1.8; b._syncCapsule();
for (let i = 0; i < 20; i++) { g.time += 1 / 60; b._move(1 / 60); }
info.start = b.position.toArray();
it.moveX = 1; it.moveZ = 0; it.speed = 7.2;
const tr = [];
let jumped = false;
for (let n = 0; n < 60; n++) {
  const dist = 10 - (b.position.x + 0.4);
  it.jump = false;
  if (!jumped && dist <= d) { it.jump = true; jumped = true; }
  g.time += dt; b._move(dt);
  tr.push([+b.position.x.toFixed(2), +b.position.y.toFixed(2), +b.velocity.y.toFixed(1), b.onGround ? 1 : 0, it.jump ? 'J' : '']);
}
g.state = 'playing';
return { info, tr };
