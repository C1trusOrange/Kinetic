const g = window.__GAME__;
g.state = 'paused';
const b = g.bots.list[0];
const V = b.position.constructor;
const it = b.brain.intent;
const res = [];
function place(x, y, z, yaw) {
  b.teleportTo(new V(x, y, z), yaw);
  g.time += 1;           // let the noSnap timer expire
  b._noSnapUntil = 0;
  b.velocity.set(0, 0, 0);
  b.crouch = 0; b.height = 1.8; b._syncCapsule();
  it.moveX = 0; it.moveZ = 0; it.speed = 0; it.jump = false; it.crouch = false;
  // settle onto the floor
  for (let i = 0; i < 30; i++) { g.time += 1 / 60; b._move(1 / 60); }
}
function stepFor(dt, seconds, fn) {
  const n = Math.round(seconds / dt);
  for (let i = 0; i < n; i++) { g.time += dt; b._move(dt); if (fn && fn(i, dt) === false) break; }
}
for (const fps of [240, 144, 60, 30, 20]) {
  const dt = 1 / fps;
  const r = { fps };
  // 1. jump apex / airtime on flat ground
  place(-20, 0, 25, 0);
  const y0 = b.position.y;
  let apex = 0, air = 0, airStart = -1, steps = 0;
  it.jump = true;
  stepFor(dt, 2, (i) => { if (i === 0) it.jump = true; else it.jump = false; steps++; apex = Math.max(apex, b.position.y - y0); if (!b.onGround) air += dt; if (i > 5 && b.onGround) return false; });
  r.jumpApex = +apex.toFixed(3); r.jumpAir = +air.toFixed(3);
  // 2. stairs up (x 0, z 20 -> 6), 29 deg
  place(0, 0, 20, 0);
  it.moveX = 0; it.moveZ = -1; it.speed = 7.2;
  let flick = 0, minSp = 99, t = 0, reached = -1, wall = 0;
  stepFor(dt, 6, (i) => { t += dt; if (!b.onGround) flick++; if (b.position.z < 15 && b.position.z > 9) minSp = Math.min(minSp, b.speed); if (b.position.y > 4.3 && reached < 0) reached = t; if (b.position.z < 6) return false; });
  r.stairsUp = { airFrames: flick, minSpeedOnSlope: +minSp.toFixed(2), reachedTopAt: +reached.toFixed(2), endY: +b.position.y.toFixed(2), endZ: +b.position.z.toFixed(2) };
  // 3. back down the stairs
  it.moveZ = 1; flick = 0; let maxVy = 0, downAir = 0;
  stepFor(dt, 6, (i) => { if (!b.onGround) { flick++; } maxVy = Math.min(maxVy, b.velocity.y); if (b.position.z > 19) return false; });
  r.stairsDown = { airFrames: flick, airTime: +(flick * dt).toFixed(3), minVy: +maxVy.toFixed(2), endY: +b.position.y.toFixed(2), endZ: +b.position.z.toFixed(2) };
  // 4. ramp (x 16 -> 8, z 0) walking up
  place(20, 0, 0, Math.PI / 2);  // facing -x
  it.moveX = -1; it.moveZ = 0; it.speed = 7.2; flick = 0; minSp = 99; t = 0;
  stepFor(dt, 6, (i) => { t += dt; if (!b.onGround) flick++; if (b.position.x < 15 && b.position.x > 9) minSp = Math.min(minSp, b.speed); if (b.position.x < 6) return false; });
  r.rampUp = { airFrames: flick, minSpeedOnSlope: +minSp.toFixed(2), endY: +b.position.y.toFixed(2), endX: +b.position.x.toFixed(2) };
  it.moveX = 1; flick = 0;
  stepFor(dt, 6, (i) => { if (!b.onGround) flick++; if (b.position.x > 19) return false; });
  r.rampDown = { airFrames: flick, airTime: +(flick * dt).toFixed(3), endY: +b.position.y.toFixed(2) };
  res.push(r);
}
it.moveX = it.moveZ = it.speed = 0;
g.state = 'playing';
return res;
