// pullFromEdges vs jump waypoints: how often does it move them, and what does the raw / pulled route look like.
import { pullFromEdges } from '/src/ai/BotNav.js';
const f = v => +v.toFixed(2);
export async function setup(game, report) {
  const nav = game.world.nav, col = game.world.collision;
  const C = report.custom = { };
  const V = nav.nodes[0].position.constructor;
  let seed = 99; const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const main = nav._main;
  let jumpWp = 0, moved = 0, movedFar = 0, dyChanged = 0, lowered = 0;
  const samples = [];
  for (let k = 0; k < 600; k++) {
    const a = main[Math.floor(rnd() * main.length)], b = main[Math.floor(rnd() * main.length)];
    const p = nav.findPath(a.position, b.position);
    if (!p) continue;
    const raw = p.map(w => ({ x: w.x, y: w.y, z: w.z, type: w.type, pad: !!w.pad }));
    pullFromEdges(col, p);
    for (let i = 0; i < p.length - 1; i++) {
      if (raw[i].type !== 'jump' || raw[i].pad) continue;
      jumpWp++;
      const dx = p[i].x - raw[i].x, dz = p[i].z - raw[i].z, dy = p[i].y - raw[i].y;
      const h = Math.hypot(dx, dz);
      if (h > 0.01 || Math.abs(dy) > 0.01) {
        moved++;
        if (h > 0.3) movedFar++;
        if (dy < -0.2) lowered++;
        if (samples.length < 12) samples.push({ raw: [f(raw[i].x), f(raw[i].y), f(raw[i].z)], pulled: [f(p[i].x), f(p[i].y), f(p[i].z)], moveH: f(h), dy: f(dy), prev: i ? [f(raw[i - 1].x), f(raw[i - 1].y), f(raw[i - 1].z), raw[i - 1].type].join(',') : 'start' });
      }
    }
  }
  C.jumpWp = jumpWp; C.moved = moved; C.movedFar = movedFar; C.lowered = lowered; C.samples = samples;
  // the failing foundry route
  if (game.world.mapId === 'foundry') {
    const from = new V(-12.5, 5, -4.4), to = new V(-3.5, 9.5, -20.5);
    const p = nav.findPath(from, to);
    const raw = p.map(w => [f(w.x), f(w.y), f(w.z), w.type + (w.pad ? '*' : '')].join(','));
    pullFromEdges(col, p);
    C.route = { raw, pulled: p.map(w => [f(w.x), f(w.y), f(w.z), w.type].join(',')) };
  }
}
export function drive() {}
