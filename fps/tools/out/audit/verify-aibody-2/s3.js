export function setup(game, report) {
  report.custom = report.custom || {};
  const b = game.bots.list[0];
  const saveTime = game.time;
  const origUpdate = b.brain.update;
  const out = {};
  for (const fps of [240, 120, 60, 30, 20]) {
    const dt = 1 / fps;
    // settle
    b.brain.update = () => {};
    b.brain.intent.moveX = 0; b.brain.intent.moveZ = 0; b.brain.intent.speed = 0; b.brain.intent.jump = false; b.brain.intent.crouch = false;
    b.velocity.set(0, 0, 0);
    game.time = 1000 + fps * 10;
    b._noSnapUntil = 0; b._lastJump = -10;
    for (let i = 0; i < 40; i++) { game.time += dt; b._move(dt); }
    const y0 = b.position.y;
    const ok0 = b.onGround;
    let apex = 0, t = 0, jumped = false, airborne = 0;
    b.brain.intent.jump = true;
    for (let i = 0; i < 600; i++) {
      game.time += dt;
      b._move(dt);
      if (i === 0) b.brain.intent.jump = false;
      apex = Math.max(apex, b.position.y - y0);
      if (i > 3 && b.onGround) break;
      airborne += dt;
    }
    out[fps] = { apex: +apex.toFixed(3), air: +airborne.toFixed(3), y0: +y0.toFixed(3), ground0: ok0 };
  }
  b.brain.update = origUpdate;
  game.time = saveTime;
  report.custom.jump = out;
}
export function drive() {}
