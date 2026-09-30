// Finding 4: bot walking under the floating ruin wall at z=22 (underside y=0, bath floor -1.6)
import * as THREE from 'three';
const f = v => +v.toFixed(2);
const nap = () => new Promise(r => setTimeout(r, 0));
async function step(game, seconds, dt, cb) {
  const n = Math.round(seconds / dt);
  for (let i = 0; i < n; i++) { game.update(dt); if (cb && cb(i, dt) === false) return; if (i % 240 === 239) await nap(); }
}
export async function setup(game, report) {
  const C = report.custom = { trials: [] };
  game.autotest.duration = 1e9;
  const bots = game.bots.list;
  for (let i = 1; i < bots.length; i++) { bots[i].alive = false; bots[i].model.setVisible(false); bots[i].respawnAt = -1; }
  const bot = bots[0], br = bot.brain, nav = br.nav;
  br.chooseState = function () {}; br.pickRoamGoal = function () {};
  const gnav = game.world.nav;
  const pairs = [
    [[-23.5, -1.6, 19.5], [-23.5, -1.6, 25.5]],
    [[-26.5, -1.6, 20.0], [-23.5, -1.6, 25.0]],
    [[-22.5, -1.6, 25.5], [-24.5, -1.6, 19.5]],
    [[-28.5, -1.6, 19.5], [-28.5, -1.6, 25.5]],
  ];
  for (const [a, g] of pairs) {
    const av = new THREE.Vector3(...a), gv = new THREE.Vector3(...g);
    const p = gnav.findPath(av, gv);
    const pathStr = p ? p.map(w => `${f(w.x)},${f(w.y)},${f(w.z)}:${w.type}`) : null;
    bot.velocity.set(0, 0, 0);
    bot.teleportTo(av, 0);
    await step(game, 0.3, 1 / 60);
    nav.clear(); nav.setGoal(gv, 1.2, 0.5);
    let ok = false, t = 0, minD = 1e9, stuck = 0, lastP = bot.position.clone(), lastT = 0, samples = [];
    await step(game, 15, 1 / 60, () => {
      t += 1 / 60;
      const d = Math.hypot(bot.position.x - gv.x, bot.position.z - gv.z);
      minD = Math.min(minD, d);
      if (Math.floor(t) !== Math.floor(t - 1 / 60)) samples.push([f(bot.position.x), f(bot.position.y), f(bot.position.z), nav.mode, nav.index]);
      if (nav.arrived) { ok = true; return false; }
      return true;
    });
    C.trials.push({ a, g, pathStr, ok, t: f(t), minD: f(minD), samples: samples.slice(0, 15), recoveries: br.stuckStage ?? null });
  }
  game.autotest.duration = game.autotest.t + 0.05;
}
export function drive() {}
