// Finding 5 dynamic: bot placed where nearest node is across a wall. params: starts=json [[x,y,z,gx,gy,gz],...], n, lim
import * as THREE from 'three';
const f = v => +v.toFixed(2);
const nap = () => new Promise(r => setTimeout(r, 0));
export async function setup(game, report) {
  const C = report.custom = { trials: [] };
  game.autotest.duration = 1e9;
  const bots = game.bots.list;
  for (let i = 1; i < bots.length; i++) { bots[i].alive = false; bots[i].model.setVisible(false); bots[i].respawnAt = -1; }
  const bot = bots[0], br = bot.brain, nav = br.nav;
  br.chooseState = function () {}; br.pickRoamGoal = function () {};
  const gnav = game.world.nav, col = game.world.collision;
  const starts = JSON.parse(game.params.get('starts') || '[]');
  const NT = parseInt(game.params.get('n') || '3');
  const LIM = parseFloat(game.params.get('lim') || '25');
  const jit = game.params.get('jit') === '1';
  let tele = 0;
  const ot = bot.teleportTo.bind(bot);
  bot.teleportTo = (p, y) => { tele++; return ot(p, y); };
  for (const r of starts) {
    const a = new THREE.Vector3(r[0], r[1], r[2]), g = new THREE.Vector3(r[3], r[4], r[5]);
    const nn = gnav.nearestNode(a, 8);
    const p = gnav.findPath(a, g);
    const first = p && p[0];
    // LOS from start to the first waypoint
    let los = null;
    if (first) {
      const o = new THREE.Vector3(a.x, a.y + 0.5, a.z), d = new THREE.Vector3(first.x - a.x, first.y + 0.5 - (a.y + 0.5), first.z - a.z);
      const L = d.length(); d.multiplyScalar(1 / L);
      const h = col.raycast(o, d, L);
      los = h ? { hit: f(h.distance), of: f(L) } : 'clear';
    }
    for (let k = 0; k < NT; k++) {
      bot.velocity.set(0, 0, 0);
      bot.teleportTo(a.clone().add(new THREE.Vector3(0, 0.02, 0)), Math.random() * 6);
      tele = 0;
      let acc0 = 0; while (acc0 < 0.3) { game.update(1 / 60); acc0 += 1 / 60; }
      nav.clear(); nav.setGoal(g.clone(), 1.2, 0.5);
      br.stuckStage = 0; br.stuckCount = 0;
      let t = 0, maxStage = 0, leftAt = null, ok = false, teleAt = null;
      const sx = bot.position.x, sz = bot.position.z;
      for (let i = 0; t < LIM; i++) {
        const dt = jit ? (1 / 60) * (0.5 + Math.random() * 1.5) : 1 / 60;
        game.update(dt); t += dt;
        maxStage = Math.max(maxStage, br.stuckStage || 0);
        if (leftAt === null && Math.hypot(bot.position.x - sx, bot.position.z - sz) > 3) leftAt = f(t);
        if (tele && teleAt === null) teleAt = f(t);
        if (nav.arrived) { ok = true; break; }
        if (i % 240 === 239) await nap();
      }
      C.trials.push({ a: r.slice(0, 3), g: r.slice(3), nearest: nn ? [f(nn.position.x), f(nn.position.y), f(nn.position.z), f(nn.position.distanceTo(a))] : null, first: first ? [f(first.x), f(first.y), f(first.z), first.type] : null, los: k === 0 ? los : undefined, ok, t: f(t), leftAt, maxStage, teleAt, mode: nav.mode });
    }
  }
  C.summary = C.trials.map(r => `${r.a} ${r.ok ? 'ok' : 'FAIL'} t${r.t} left${r.leftAt} stage${r.maxStage} tele${r.teleAt}`);
  game.autotest.duration = game.autotest.t + 0.05;
}
export function drive() {}
