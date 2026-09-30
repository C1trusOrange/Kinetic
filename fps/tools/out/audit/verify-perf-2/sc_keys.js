// F12: count getParameters/key evaluations per frame for materials shared between game.scene and game.viewScene
const G = window.__GAME__;
const counts = new Map();
let frames = 0;
let hooked = false;
function collect(scene) { const s = new Set(); scene.traverse(o => { if (o.material) for (const m of (Array.isArray(o.material) ? o.material : [o.material])) s.add(m); }); return s; }
function hook() {
  const a = collect(G.scene), b = collect(G.viewScene);
  const shared = [...a].filter(m => b.has(m));
  const all = new Set([...a, ...b]);
  for (const m of all) {
    if (m.__hooked) continue; m.__hooked = true;
    const orig = m.customProgramCacheKey ? m.customProgramCacheKey.bind(m) : () => '';
    m.customProgramCacheKey = function () { counts.set(m, (counts.get(m) || 0) + 1); return orig(); };
  }
  return { nA: a.size, nB: b.size, shared: shared.length, sharedSet: shared };
}
let info = null;
export function drive(t, dt, game, report) {
  game.autotest._drive(t, dt);
  game.player.god = true;
  if (t > 2 && !hooked) { hooked = true; info = hook(); counts.clear(); frames = 0; }
  if (hooked) frames++;
}
export function finish(game, report) {
  let total = 0, sharedCalls = 0;
  const shSet = new Set(info.sharedSet);
  for (const [m, c] of counts) { total += c; if (shSet.has(m)) sharedCalls += c; }
  const per = frames ? total / frames : 0;
  report.custom = { frames, materialsWorld: info.nA, materialsView: info.nB, shared: info.shared, totalCalls: total, perFrame: +per.toFixed(1), sharedCalls, nonShared: total - sharedCalls,
    sample: [...counts.entries()].slice(0, 6).map(([m, c]) => [m.type, m.name || '', c, +(c / frames).toFixed(2), shSet.has(m)]) };
}
