// Are loops muted / mix muffled while paused / on the end screen? (Audio.update is only called from Game.update and _updateMenu)
const frames = n => new Promise(res => { let c = 0; const f = () => (++c >= n ? res() : requestAnimationFrame(f)); requestAnimationFrame(f); });
export function drive() {}
export async function setup(game, report) {
  const out = (window.__LC__ = { done: false, rows: [], errors: [] });
  const a = game.audio;
  const R = label => out.rows.push({ label, state: game.state, ctx: a.ctx && a.ctx.state, ready: a.ready, loops: a.loops.size, loopBusGain: a.loopBus ? +a.loopBus.gain.value.toFixed(3) : null, loopGainVar: +a._loopGain.toFixed(3), muffleVar: +a._pauseMuffle.toFixed(3), muffleHz: a.muffle ? Math.round(a.muffle.frequency.value) : null });
  try {
    await frames(40);
    R('playing');
    // start a slide loop like Player._onSlideStart does
    game.player._slideLoop = game.player._loop('slide', 0.6, 1);
    await frames(10);
    R('playing + slide loop');
    game.pause();
    await frames(120);
    R('paused after 120 frames');
    game.resume();
    await frames(30);
    R('resumed');
    // end screen: slow-mo then frozen
    game.endMatch('score');
    await frames(200);
    R('end screen (state ended, timer over)');
    game.quitToMenu();
    await frames(60);
    R('menu');
  } catch (e) { out.errors.push(String(e && e.stack || e)); }
  out.done = true;
}
