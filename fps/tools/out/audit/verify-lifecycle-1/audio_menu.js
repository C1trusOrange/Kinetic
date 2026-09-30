const frames = n => new Promise(res => { let c = 0; const f = () => (++c >= n ? res() : requestAnimationFrame(f)); requestAnimationFrame(f); });
async function until(cond, max = 400) { for (let i = 0; i < max; i++) { if (cond()) return true; await frames(1); } return false; }
export function drive() {}
export async function setup(game, report) {
  report.custom = report.custom || {};
  const out = (report.custom.am = { done: false, rows: [], errors: [] });
  const p = game.player, a = game.audio;
  const V3 = p.position.constructor;
  const S = label => out.rows.push({ label, state: game.state, ctx: a.ctx && a.ctx.state, ready: a.ready, loops: a.loops.size,
    loopBusGain: a.loopBus ? +a.loopBus.gain.value.toFixed(3) : null, muffleVar: +a._pauseMuffle.toFixed(3), muffleHz: a.muffle ? Math.round(a.muffle.frequency.value) : null,
    grState: p.grapple.state, grVisible: p.grapple.group.visible, isGrappling: p.isGrappling, alive: p.alive });
  const attach = async () => {
    const eye = p.getEyePosition(new V3());
    for (let k = 0; k < 40; k++) { p.yaw = k * 0.157; p.pitch = 0.25; if (game.world.raycast(eye, p.getAimDirection(new V3()), 44)) break; }
    p.spawnProtectedUntil = 0;
    p.grapple.fire();
    return until(() => p.isGrappling, 200);
  };
  try {
    await frames(60);
    game.bots.update = () => {};
    S('playing baseline');
    let ok = await attach(); S('grapple attached ok=' + ok);
    game.pause(); S('paused immediately'); await frames(120); S('paused +120 frames');
    game.resume(); await frames(3); S('resumed');
    ok = await attach(); S('re-attached ok=' + ok);
    game.endMatch('score'); await frames(30); S('outro (30 frames)');
    await frames(300); S('end screen (state ended, after outro)');
    game.quitToMenu(); await frames(60); S('menu after quit-from-end-screen');
    // second: start match, attach, pause, quit
    await game.startMatch({ mapId: 'sandbox', mode: 'ffa', botCount: 1, scoreLimit: 0, timeLimit: 0 });
    game.bots.update = () => {};
    await frames(30);
    ok = await attach(); await frames(10); S('2nd match: attached ok=' + ok);
    game.pause(); game.quitToMenu(); await frames(60); S('menu after pause+quit');
  } catch (e) { out.errors.push(String(e && e.stack || e)); }
  out.done = true;
}
