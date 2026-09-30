// Synthetic fire-rate test: drive weapons.update directly with fixed dts, count shots over 10 s.
export function setup(game, report) {
  const w = game.weapons, inp = game.input;
  game.player.god = true;
  const out = {};
  let shots = 0;
  const off = game.events.on('weapon:fire', () => shots++);
  const savedTime = game.time;
  const run = (id, dt, semi) => {
    // reset weapon state
    w.onPlayerSpawn();
    w.giveWeapon(id);
    // let switch finish
    for (let i = 0; i < 300; i++) { game.time += 1/60; w.update(1/60); }
    // now ensure current weapon is id
    if (w.currentId !== id) { w._requestSwitch(id); for (let i = 0; i < 300; i++) { game.time += 1/60; w.update(1/60); } }
    shots = 0;
    const T = 10;
    const n = Math.round(T / dt);
    const t0 = game.time;
    for (let i = 0; i < n; i++) {
      game.time += dt;
      w.inv[id].ammo = w.current.magSize; w.ammo = w.inv[id].ammo;
      if (semi) {
        inp.setVirtual('fire', i % 2 === 0);      // press every other frame
      } else inp.setVirtual('fire', true);
      inp.update();
      w.update(dt);
      inp.endFrame();
    }
    inp.setVirtual('fire', false); inp.update(); inp.endFrame();
    return { shots, perSec: +(shots / (game.time - t0)).toFixed(3), expected: w.current.fireRate };
  };
  for (const id of ['rifle', 'pistol', 'shotgun', 'sniper', 'rocket']) {
    out[id] = {};
    for (const hz of [20, 30, 60, 75, 90, 120, 144, 165, 240]) {
      const dt = 1 / hz;
      const semi = !w.current || !WEAPONS_AUTO(id);
      out[id][hz] = run(id, dt, semi);
    }
  }
  off();
  game.time = savedTime;
  report.custom = out;
}
function WEAPONS_AUTO(id) { return id === 'rifle'; }
export function drive() {}
