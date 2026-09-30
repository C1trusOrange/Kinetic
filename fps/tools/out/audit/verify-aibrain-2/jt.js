// Finding 3 dynamic: jump-link routes with / without pullFromEdges nudging jump waypoints; fixed & jittered dt.
// Params: mode=list|fixed|jit ; patch=1 exempts jump waypoints from pullFromEdges ; n=trials per route ; routes=json array [[ax,ay,az,gx,gy,gz],...]
import * as THREE from 'three';
import { BotNav, pullFromEdges } from '/src/ai/BotNav.js';
const f = v => +v.toFixed(2);
const nap = () => new Promise(r => setTimeout(r, 0));

function patchedRequest() {
  const game = this.game; const t = game.time;
  if (!game.bots.consumePathBudget()) return;
  const nav = game.world.nav;
  const t0 = performance.now();
  let p = null; let connected = true;
  try { connected = nav.isConnected(this.bot.position, this.goal); } catch (e) { connected = true; }
  if (connected) { try { p = nav.findPath(this.bot.position, this.goal); } catch (e) { p = null; } }
  this.dirty = false; let ends = false;
  if (p && p.length > 0) { const last = p[p.length - 1]; const g = this.goal; ends = Math.hypot(last.x - g.x, last.z - g.z) < 3.5 && Math.abs(last.y - g.y) < 2.6; }
  this.unreachable = !ends;
  if (p && p.length > 0) {
    const orig = p.slice();
    pullFromEdges(game.world.collision, p);
    for (let i = 0; i < p.length; i++) if (orig[i].type === 'jump') p[i] = orig[i];
    this.path = p; this.index = 0; this.mode = 'path'; this.nextPathAt = t + 0.45;
  } else { this.path = null; this.mode = 'direct'; this.nextPathAt = t + (p ? 0.6 : 1.4); }
  game.bots.reportPathTime(performance.now() - t0);
}

export async function setup(game, report) {
  const C = report.custom = { trials: [] };
  game.autotest.duration = 1e9;
  const bots = game.bots.list;
  for (let i = 1; i < bots.length; i++) { bots[i].alive = false; bots[i].model.setVisible(false); bots[i].respawnAt = -1; }
  const bot = bots[0], br = bot.brain, nav = br.nav;
  br.chooseState = function () {}; br.pickRoamGoal = function () {};
  if (game.params.get('patch') === '1') BotNav.prototype._requestPath = patchedRequest;
  const gnav = game.world.nav;
  const jit = game.params.get('jit') === '1';
  const NT = parseInt(game.params.get('n') || '4');
  const LIM = parseFloat(game.params.get('lim') || '30');
  const routes = JSON.parse(game.params.get('routes') || '[]');
  let inv = 0; const invLog = [];
  const oInv = nav.invalidate.bind(nav);
  nav.invalidate = () => {
    inv++;
    const wp = nav.path && nav.path[nav.index];
    if (invLog.length < 4) invLog.push({ t: f(game.time), g: bot.onGround, pos: [f(bot.position.x), f(bot.position.y), f(bot.position.z)], idx: nav.index, wp: wp ? [f(wp.x), f(wp.y), f(wp.z), wp.type].join(' ') : null });
    return oInv();
  };
  for (const r of routes) {
    const a = new THREE.Vector3(r[0], r[1], r[2]), g = new THREE.Vector3(r[3], r[4], r[5]);
    const p = gnav.findPath(a, g);
    const raw = p ? p.map(w => `${f(w.x)},${f(w.y)},${f(w.z)}:${w.type}${w.pad ? '*' : ''}`) : null;
    const q = p ? p.map(w => { const c = w.clone(); c.type = w.type; return c; }) : null;
    if (q) pullFromEdges(game.world.collision, q);
    const pulled = q ? q.map(w => `${f(w.x)},${f(w.y)},${f(w.z)}:${w.type}`) : null;
    for (let k = 0; k < NT; k++) {
      bot.velocity.set(0, 0, 0);
      bot.teleportTo(a.clone().add(new THREE.Vector3(0, 0.02, 0)), 0);
      let acc0 = 0; while (acc0 < 0.3) { game.update(1 / 60); acc0 += 1 / 60; }
      nav.clear(); nav.setGoal(g.clone(), 1.2, 0.5);
      inv = 0; invLog.length = 0;
      let ok = false, t = 0, flips = 0, lastMode = nav.mode, minY = 99, maxStage = 0;
      for (let i = 0; t < LIM; i++) {
        const dt = jit ? (1 / 60) * (0.5 + Math.random() * 1.5) : 1 / 60;
        game.update(dt); t += dt;
        if (nav.mode !== lastMode) { flips++; lastMode = nav.mode; }
        maxStage = Math.max(maxStage, br.stuckStage || 0);
        if (nav.arrived) { ok = true; break; }
        if (i % 240 === 239) await nap();
      }
      C.trials.push({ a: [r[0], r[1], r[2]], g: [r[3], r[4], r[5]], raw: k === 0 ? raw : undefined, pulled: k === 0 ? pulled : undefined, ok, t: f(t), inv, flips, maxStage, inv0: invLog.slice(0, 2) });
    }
  }
  nav.invalidate = oInv;
  C.summary = C.trials.map(r => `${r.ok ? 'ok' : 'FAIL'}:${r.t}s inv${r.inv} flips${r.flips} stage${r.maxStage}`);
  game.autotest.duration = game.autotest.t + 0.05;
}
export function drive() {}
