const out = {};
let done = false;
export function setup(game, report) { report.custom = report.custom || {}; report.custom.out = out; }
export function drive(t, dt, game, report) {
  if (done || t < 3) return;
  done = true;
  const b = game.bots.list[0];
  const step = 1 / 60;
  const mgr = game.bots;
  const saveT = game.time;
  const pos = b.position.clone();
  // (a) stand still on floor and respawn in place
  b.brain.intent.moveX = 0;
  const run = (label, prep) => {
    const rows = [];
    prep();
    for (let i = 0; i < 30; i++) {
      game.time += step;
      mgr.camPos.copy(b.position); mgr.camFwd.set(0, 0, -1);
      b.update(step);
      const m = b.model;
      rows.push([i, +(game.time - saveT).toFixed(3), b.onGround ? 1 : 0, +m._k.air.toFixed(2), +m._airT.toFixed(3), +m._land.toFixed(3)].join(','));
    }
    out[label] = rows;
  };
  run('respawnStanding', () => { game.time = saveT; b.spawn(pos, b.yaw); });
  // (b) died mid air: fake stale model state, then respawn
  run('respawnStaleAirT', () => { game.time += 1; b.model._airT = 0.5; b.model._wasGround = false; b.spawn(pos, b.yaw); });
  // (c) control: bot already standing for a while, then re-run without spawn (no window)
  run('control_noSpawn', () => { });
  game.time = saveT;
}
export function finish() {}
