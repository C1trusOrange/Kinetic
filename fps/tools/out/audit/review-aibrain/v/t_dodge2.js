// Grenade dodge in practice: positions where the code's one-sided search finds no escape direction but the mirrored side is open.
import * as THREE from 'three';
import { probeMove } from '/src/ai/BotNav.js';
import { BotBrain } from '/src/ai/BotBrain.js';
import { MOVE } from '/src/ai/BotConfig.js';
const f = v => +v.toFixed(2);
let DT = 1 / 60;
const nap = () => new Promise(r => setTimeout(r, 0));
async function step(game, seconds, dt, cb) {
  const n = Math.round(seconds / dt);
  for (let i = 0; i < n; i++) { game.update(dt); if (cb && cb(i, dt) === false) return; if (i % 240 === 239) await nap(); }
}
const ANG = [0, 0.7, -0.7, 1.4, -1.4];
function search(col, pos, ax, az, first, fixed) {
  const p = { wall: false, step: false, ledge: false, wallDist: 0, drop: 0 };
  for (let i = 0; i < ANG.length; i++) {
    const a = fixed ? ANG[i] * first : ANG[i] * (i % 2 === 1 ? first : -first);
    const c = Math.cos(a), s = Math.sin(a);
    probeMove(col, pos, ax * c - az * s, ax * s + az * c, 2.2, p);
    if (!p.wall && !p.ledge) return true;
  }
  return false;
}
export async function setup(game, report) {
  const C = report.custom = {};
  game.autotest.duration = 1e9;
  DT = 1 / parseFloat(game.params.get('fps') || '60');
  try {
    const bots = game.bots.list;
    for (let i = 1; i < bots.length; i++) { bots[i].alive = false; bots[i].model.setVisible(false); bots[i].respawnAt = -1; }
    game.player.alive = false; game.player.respawnAt = -1;
    const bot = bots[0]; bot.god = true;
    const br = bot.brain, nav = game.world.nav, col = game.world.collision;
    br.perceive = () => {}; br.think = () => {};
    let seed = 11; const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
    const main = nav._main;
    let tested = 0, codeFail = 0, fixedFail = 0, onlyFixedOk = [];
    for (let k = 0; k < 4000 && tested < 2500; k++) {
      const n = main[Math.floor(rnd() * main.length)];
      const ang = rnd() * Math.PI * 2, first = rnd() < 0.5 ? 1 : -1;
      // grenade 3 m away in direction ang; away direction = opposite
      const ax = -Math.cos(ang), az = -Math.sin(ang);
      tested++;
      const a = search(col, n.position, ax, az, first, false), b = search(col, n.position, ax, az, first, true);
      if (!a) codeFail++;
      if (!b) fixedFail++;
      if (!a && b && onlyFixedOk.length < 60) onlyFixedOk.push({ pos: n.position.clone(), ang, first, ax, az });
    }
    C.search = { tested, codeFail, fixedFail, onlyFixedOk: onlyFixedOk.length };
    // play a number of those positions with the real moveDodge, original vs mirrored-fixed
    const src = BotBrain.prototype.moveDodge.toString();
    const fixedSrc = src.replace('const a = angles[i] * (i % 2 === 1 ? first : -first);', 'const a = angles[i] * first;');
    if (fixedSrc === src) throw new Error('patch failed');
    const orig = BotBrain.prototype.moveDodge;
    const fixed = new Function('MOVE', 'return {' + fixedSrc + '}.moveDodge')(MOVE);
    const runCase = async (cs) => {
      bot.velocity.set(0, 0, 0);
      bot.teleportTo(cs.pos.clone().add(new THREE.Vector3(0, 0.02, 0)), 0);
      await step(game, 0.3, DT);
      const start = bot.position.clone();
      br.strafeDir = cs.first;
      br.dodgeFrom.set(start.x - cs.ax * 3, start.y, start.z - cs.az * 3);
      br.dodgeUntil = game.time + 1.5; br.unstickUntil = 0; br.stuckCheckAt = game.time + 99;
      // keep the dodge alive
      await step(game, 1.2, DT, () => { br.dodgeUntil = game.time + 0.5; return true; });
      return Math.hypot(bot.position.x - start.x, bot.position.z - start.z);
    };
    const rows = [];
    for (const cs of onlyFixedOk.slice(0, 12)) {
      BotBrain.prototype.moveDodge = orig; const d0 = await runCase(cs);
      BotBrain.prototype.moveDodge = fixed; const d1 = await runCase(cs);
      rows.push({ at: [f(cs.pos.x), f(cs.pos.y), f(cs.pos.z)], movedOriginal: f(d0), movedMirroredSearch: f(d1) });
    }
    BotBrain.prototype.moveDodge = orig;
    C.rows = rows;
    C.avgOriginal = f(rows.reduce((s, r) => s + r.movedOriginal, 0) / Math.max(1, rows.length));
    C.avgFixed = f(rows.reduce((s, r) => s + r.movedMirroredSearch, 0) / Math.max(1, rows.length));
  } catch (err) { C.error = String(err && err.stack || err); console.error('[dodge2]', err); }
  game.autotest.duration = 0;
}
export function drive() {}
