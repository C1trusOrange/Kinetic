// Does toggling the quality preset leak the old composer's bloom render targets / passes?
const frames = n => new Promise(res => { let c = 0; const f = () => (++c >= n ? res() : requestAnimationFrame(f)); requestAnimationFrame(f); });
export function drive() {}

export async function setup(game, report) {
  const out = (window.__LC__ = { done: false, rows: [], errors: [] });
  const R = label => { const m = game.renderer.info.memory; out.rows.push({ label, quality: game.settings.get('quality'), textures: m.textures, geometries: m.geometries, programs: game.renderer.info.programs.length, composer: !!game.composer }); };
  try {
    await frames(60);
    R('start');
    for (let i = 0; i < 6; i++) {
      game.settings.set('quality', i % 2 === 0 ? 'medium' : 'high');
      await frames(15);
      R('set ' + game.settings.get('quality') + ' #' + (i + 1));
    }
    game.settings.set('quality', 'low'); await frames(15); R('low');
    game.settings.set('quality', 'high'); await frames(15); R('high again');
  } catch (e) { out.errors.push(String(e && e.stack || e)); }
  out.done = true;
}
