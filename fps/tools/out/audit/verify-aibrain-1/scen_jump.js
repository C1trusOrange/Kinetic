// Verifier: how often does pullFromEdges move a 'jump' waypoint so that its height above the source node exceeds 1.3 (the steepness-guard limit)?
import { pullFromEdges } from '/src/ai/BotNav.js';
const f = v => +v.toFixed(2);
export async function setup(game, report) {
  const C = report.custom = {};
  game.autotest.duration = 1e9;
  const nav = game.world.nav, col = game.world.collision;
  const THREE_V = game.player.position.constructor;
  let n = 0, moved = 0, over = 0, overRaw = 0, movedUp = 0;
  const ex = [];
  const nodes = nav.nodes;
  for (const a of nodes) {
    for (const l of a.links) {
      if (l.type !== 'jump' || l.pad) continue;
      const b = nodes[l.to];
      n++;
      const wp = b.position.clone(); wp.type = 'jump';
      const last = b.position.clone(); last.type = 'walk';
      const path = [wp, last];
      pullFromEdges(col, path);
      const w = path[0];
      const d = Math.hypot(w.x - b.position.x, w.z - b.position.z);
      const dyRaw = b.position.y - a.position.y, dyNew = w.y - a.position.y;
      if (dyRaw > 1.3) overRaw++;
      if (d > 0.05) moved++;
      if (w.y > b.position.y + 0.05) movedUp++;
      if (dyNew > 1.3) { over++; if (ex.length < 12) ex.push({ a: a.position.toArray().map(f), b: b.position.toArray().map(f), w: [f(w.x), f(w.y), f(w.z)], dyRaw: f(dyRaw), dyNew: f(dyNew), moved: f(d) }); }
    }
  }
  C.map = game.world.mapId;
  C.jumpLinks = n; C.movedByPull = moved; C.movedUp = movedUp; C.dyOver1_3_raw = overRaw; C.dyOver1_3_after = over; C.examples = ex;
  game.autotest.duration = 0;
}
export function drive() {}
