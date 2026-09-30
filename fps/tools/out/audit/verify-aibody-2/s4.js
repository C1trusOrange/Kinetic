export function setup(game, report) {
  report.custom = report.custom || {};
  report.custom.cfg = { mode: game.match && game.match.mode, n: game.bots.list.length };
  report.custom.colors = game.bots.list.map(b => b.color.getHexString());
  report.custom.nums = game.bots.list.map(b => { const h = b.color.getHex(); return 1 + ((Math.imul(h, 2654435761) >>> 0) % 98); });
  const seen = new Map(); const dup = [];
  game.bots.list.forEach((b, i) => { const k = b.color.getHexString(); if (seen.has(k)) dup.push([seen.get(k), i]); else seen.set(k, i); });
  report.custom.dupPairs = dup;
}
export function drive() {}
