// Verifier 2: setQuality leak of bloom render targets + does a full-dispose variant fix it?
const frames = n => new Promise(res => { let c = 0; const f = () => (++c >= n ? res() : requestAnimationFrame(f)); requestAnimationFrame(f); });
export function drive() {}
export async function setup(game, report) {
  const out = (window.__V2__ = { done: false, rows: [], errors: [] });
  const info = game.renderer.info.memory;
  const R = label => out.rows.push({ label, textures: info.textures, geometries: info.geometries, hasBloom: !!game.bloomPass, preset: game.settings.get('quality') });
  try {
    await frames(30);
    game.bots.update = () => {};
    R('start');
    for (const q of ['medium', 'high', 'medium', 'high', 'medium', 'high']) {
      game.settings.set('quality', q);
      await frames(4);
      R('after -> ' + q);
    }
    // Now monkeypatch a fixed _setupComposer (dispose everything) and toggle again
    const orig = game._setupComposer.bind(game);
    game._setupComposer = function () {
      if (this.composer) {
        if (this.bloomPass) this.bloomPass.dispose();
        this.composer.passes.forEach(p => p.dispose && p.dispose());
        this.composer.dispose();
      }
      // orig disposes renderTarget1/2 again on null... guard: mimic by nulling
      const c = this.composer; this.composer = null;
      orig();
    };
    R('--- patched: dispose all passes + composer ---');
    for (const q of ['medium', 'high', 'medium', 'high', 'medium', 'high']) {
      game.settings.set('quality', q);
      await frames(4);
      R('patched after -> ' + q);
    }
    game.settings.set('quality', 'low');
    await frames(4);
    R('patched after -> low');
  } catch (e) { out.errors.push(String(e && e.stack || e)); }
  out.done = true;
}
