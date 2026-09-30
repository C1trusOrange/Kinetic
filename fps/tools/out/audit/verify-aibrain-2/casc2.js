// Finding 2 deterministic: low-health bot enters 'retreat' (health) while airborne in open space (no nav node within reach).
import * as THREE from 'three';
const f = v => +v.toFixed(2);
const nap = () => new Promise(r => setTimeout(r, 0));
export async function setup(game, report) {
  const C = report.custom = { trials: [], healthPacks: 0 };
  game.autotest.duration = 1e9;
  const bots = game.bots.list;
  for (let i = 1; i < bots.length; i++) { bots[i].alive = false; bots[i].model.setVisible(false); bots[i].respawnAt = -1; }
  const bot = bots[0], br = bot.brain, nav = br.nav;
  bot.god = true;
  br.perceive = function () {};
  br.chooseState = function () {};
  const gnav = game.world.nav;
  C.healthPacks = game.world.pickups.list.filter(p => p.type === 'health').length;
  const NT = parseInt(game.params.get('n') || '3');
  const cands = gnav._main.filter((n, i) => i % 7 === 0 && n.position.y < 1 && !gnav.nearestNode(n.position.clone().add(new THREE.Vector3(0, 9, 0)), 6) && !gnav.nearestNode(n.position.clone().add(new THREE.Vector3(0, 6, 0)), 6));
  C.cands = cands.length;
  for (let k = 0; k < NT && cands.length; k++) {
    const n = cands[(k * 37) % cands.length];
    br._ignored.clear();
    bot.health = 100; bot.velocity.set(0, 0, 0);
    bot.teleportTo(n.position.clone().add(new THREE.Vector3(0, 0.02, 0)), 0);
    br.state = 'roam'; nav.clear();
    let acc = 0; while (acc < 0.3) { game.update(1 / 60); acc += 1 / 60; }
    bot.applyImpulse(new THREE.Vector3(0, 22, 0));
    let t = 0, entered = false, log = [], maxIgn = 0, ignAt = null, healthIgn = 0;
    for (let i = 0; t < 3.5; i++) {
      game.update(1 / 60); t += 1 / 60;
      if (!entered && bot.position.y > 5.5 && !bot.onGround) {
        entered = true; bot.health = 12; br.enterState('retreat', game.time);
        log.push({ ev: 'enter', t: f(t), y: f(bot.position.y), unr: nav.unreachable, mode: nav.mode, kind: br.retreatKind });
      }
      if (entered && Math.floor(t * 10) !== Math.floor((t - 1 / 60) * 10)) {
        healthIgn = [...br._ignored.entries()].filter(([p, u]) => p.type === 'health' && u > game.time).length;
        maxIgn = Math.max(maxIgn, healthIgn);
        if (log.length < 24) log.push({ t: f(t), y: f(bot.position.y), g: bot.onGround, unr: nav.unreachable, mode: nav.mode, ign: healthIgn, st: br.state, kind: br.retreatKind });
      }
      if (i % 240 === 239) await nap();
    }
    C.trials.push({ node: [f(n.position.x), f(n.position.y), f(n.position.z)], maxIgnoredHealth: maxIgn, log });
  }
  game.autotest.duration = game.autotest.t + 0.05;
}
export function drive() {}
