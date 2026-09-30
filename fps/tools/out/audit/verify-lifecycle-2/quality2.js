// Verifier 2: are the un-disposed bloom render targets even reachable after setQuality? (WeakRef + forced GC)
const frames = n => new Promise(res => { let c = 0; const f = () => (++c >= n ? res() : requestAnimationFrame(f)); requestAnimationFrame(f); });
const sleep = ms => new Promise(r => setTimeout(r, ms));
export function drive() {}
export async function setup(game, report) {
  const out = (window.__V2__ = { done: false, rows: [], errors: [] });
  const info = game.renderer.info.memory;
  try {
    await frames(30);
    game.bots.update = () => {};
    const refs = [];
    for (const q of ['medium', 'high', 'medium', 'high']) {
      if (game.bloomPass) {
        const bp = game.bloomPass;
        refs.push({ what: 'bright', q, ref: new WeakRef(bp.renderTargetBright.texture) });
        refs.push({ what: 'h0', q, ref: new WeakRef(bp.renderTargetsHorizontal[0].texture) });
      }
      game.settings.set('quality', q);
      await frames(4);
    }
    out.rows.push({ label: 'before gc', textures: info.textures, alive: refs.map(r => !!r.ref.deref()) });
    await sleep(500);
    for (let i = 0; i < 5; i++) { try { window.gc(); } catch (e) { out.errors.push('no gc'); break; } await sleep(200); }
    out.rows.push({ label: 'after gc', textures: info.textures, alive: refs.map(r => !!r.ref.deref()), hasGc: typeof window.gc });
  } catch (e) { out.errors.push(String(e && e.stack || e)); }
  out.done = true;
}
