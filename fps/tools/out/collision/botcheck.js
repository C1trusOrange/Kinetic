// Do bots ever end up inside solids? Samples every bot capsule with the independent brute-force detector while
// they fight (rockets, grenades and knockback included). The player is left idle (god mode).
//   python tools/run.py "index.html?autotest=1&map=foundry&bots=8&god=1&duration=60&scenario=tools/out/collision/botcheck.js" --report --timeout 300
import { Detector } from './lib.js';

let det = null, next = 0;
const hits = [];
let samples = 0, insideCount = 0;

export async function setup(game, report) {
  det = new Detector(game);
  report.custom = { detector: { tris: det.count } };
}

export function drive(t, dt, game, report) {
  if (t < next) return;
  next = t + 0.5;
  for (const b of game.bots.list) {
    if (!b.alive) continue;
    samples++;
    if (det.insideCapsule(b.capsule)) {
      insideCount++;
      if (hits.length < 20) hits.push({ t: +t.toFixed(1), bot: b.name, pos: b.position.toArray().map(v => +v.toFixed(2)), state: b.brain && b.brain.state, weapon: b.weaponId });
    }
  }
  report.custom.samples = samples;
  report.custom.botsInside = insideCount;
  report.custom.hits = hits;
  const m = game.player.move;
  report.custom.playerRescues = m.rescueCount;
}

export function finish(game, report) {
  report.custom.weapons = game.bots.list.map(b => b.weaponId);
}
