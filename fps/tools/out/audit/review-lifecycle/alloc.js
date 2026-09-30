// Rough allocation rate (bytes per simulated frame) during gameplay: sum of positive heap deltas between frames.
export function drive() {}
const frames = n => new Promise(res => { let c = 0; const f = () => (++c >= n ? res() : requestAnimationFrame(f)); requestAnimationFrame(f); });

async function measure(game, label, n) {
  try { window.gc(); window.gc(); } catch (e) { /* no gc */ }
  await frames(5);
  let last = performance.memory.usedJSHeapSize, grow = 0, drops = 0, total = 0, f = 0;
  await new Promise(res => {
    const step = () => {
      const cur = performance.memory.usedJSHeapSize;
      if (cur > last) grow += cur - last; else if (cur < last) drops++;
      last = cur; f++;
      if (f >= n) res(); else requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
  return { label, frames: n, kbPerFrame: +(grow / 1024 / n).toFixed(1), gcDrops: drops, entities: game.entities.length, gibs: game.effects.gibList.length };
}

export async function setup(game, report) {
  const out = (window.__LC__ = { done: false, rows: [], errors: [] });
  try {
    await frames(60);
    out.rows.push(await measure(game, 'match running (bots+player, scripted player)', 400));
    game.quitToMenu();
    await frames(30);
    out.rows.push(await measure(game, 'main menu backdrop', 300));
  } catch (e) { out.errors.push(String(e && e.stack || e)); }
  out.done = true;
}
