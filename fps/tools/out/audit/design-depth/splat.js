// Wall-splat feasibility: shove a bot and the player toward the Spire lobby's east wall and log per-frame horizontal speed.
import * as THREE from 'three';
let stage = 0, t0 = 0, rec = null;
const out = { bot: [], player: [], botSummary: null, playerSummary: null };
export function setup(game, report) { game.player.god = true; report.custom = out; }
function summarize(arr) {
  let peak = 0, minAfter = 1e9, dropFrame = -1, maxDrop = 0;
  for (let i = 0; i < arr.length; i++) peak = Math.max(peak, arr[i].sp);
  for (let i = 1; i < arr.length; i++) { const d = arr[i - 1].sp - arr[i].sp; if (d > maxDrop) { maxDrop = d; dropFrame = i; } }
  return { peak: +peak.toFixed(1), maxOneFrameDrop: +maxDrop.toFixed(1), at: dropFrame, tAt: dropFrame >= 0 ? arr[dropFrame].t : null, xAt: dropFrame >= 0 ? arr[dropFrame].x : null, n: arr.length };
}
export function drive(t, dt, game, report) {
  const bot = game.bots.list[0], p = game.player;
  if (stage === 0 && t > 0.8) {
    stage = 1; t0 = game.time;
    bot.teleportTo(new THREE.Vector3(4, 0, -2), 0);
    bot.brain.intent.speed = 0;
    bot.applyImpulse(new THREE.Vector3(20, 4.5, 0));
    rec = out.bot;
  }
  if (stage === 1) {
    rec.push({ t: +(game.time - t0).toFixed(3), sp: Math.hypot(bot.velocity.x, bot.velocity.z), x: +bot.position.x.toFixed(2), y: +bot.position.y.toFixed(2), g: bot.onGround });
    if (game.time - t0 > 1.6) {
      out.botSummary = summarize(rec);
      stage = 2; t0 = game.time;
      p.spawn(new THREE.Vector3(4, 0, 3), 0);
      p.god = true;
    }
  }
  if (stage === 2 && game.time - t0 > 0.3) {
    stage = 3; t0 = game.time;
    p.applyImpulse(new THREE.Vector3(20, 4.5, 0));
    rec = out.player;
  }
  if (stage === 3) {
    rec.push({ t: +(game.time - t0).toFixed(3), sp: Math.hypot(p.velocity.x, p.velocity.z), x: +p.position.x.toFixed(2), y: +p.position.y.toFixed(2), g: p.onGround });
    if (game.time - t0 > 1.6) { out.playerSummary = summarize(rec); stage = 4; }
  }
}
export function finish(game, report) {
  out.bot = out.bot.filter((_, i) => i % 3 === 0);      // thin the logs
  out.player = out.player.filter((_, i) => i % 3 === 0);
}
