// Attributes collision.raycast calls to AI call sites (tag stack) in the real game.
const counts = {};
const stack = ['other'];
function tag(obj, name, label) {
  const orig = obj[name];
  if (typeof orig !== 'function') return;
  obj[name] = function (...a) {
    stack.push(label);
    try { return orig.apply(this, a); } finally { stack.pop(); }
  };
}
export async function setup(game, report) {
  report.custom = { counts };
  for (const b of game.bots.list) {
    tag(b.brain, 'perceive', 'perceive');
    tag(b.brain, 'evaluateLedgeGuard', 'ledgeGuard');
    tag(b.brain, 'probeDir', 'probeDir');
    tag(b.brain, 'fireLineClear', 'fireLine');
    tag(b.brain, 'throwGrenadeAt', 'grenadeArc');
    tag(b.brain, 'checkGrenades', 'checkGrenades');
    tag(b.brain, 'findCover', 'findCover');
    tag(b.brain.nav, '_requestPath', 'requestPath');
    tag(b.brain.nav, '_followPath', 'followPath');
    tag(b.brain.nav, '_direct', 'navDirect');
    tag(b, '_move', 'physics');
    tag(b, '_fire', 'shoot');
    tag(b, '_muzzlePosition', 'muzzle');
    tag(b, '_canStand', 'canStand');
  }
  const col = game.world.collision;
  const orig = col.raycast.bind(col);
  col.raycast = function (o, d, m) {
    const k = stack[stack.length - 1];
    counts[k] = (counts[k] || 0) + 1;
    return orig(o, d, m);
  };
  let frames = 0;
  const upd = game.bots.update.bind(game.bots);
  game.bots.update = dt => { frames++; report.custom.frames = frames; upd(dt); };
}
export function drive() {}
export function finish(game, report) {
  const f = Math.max(1, report.custom.frames);
  const out = {};
  for (const k of Object.keys(counts)) out[k] = +(counts[k] / f).toFixed(1);
  report.custom.perFrame = Object.entries(out).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}: ${v}`);
  delete report.custom.counts;
}
