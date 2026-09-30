const frames = n => new Promise(res => { let c = 0; const f = () => (++c >= n ? res() : requestAnimationFrame(f)); requestAnimationFrame(f); });
async function until(cond, max = 400) { for (let i = 0; i < max; i++) { if (cond()) return true; await frames(1); } return false; }
export function drive() {}
export async function setup(game, report) {
  const out = (window.__V1__ = { done: false, rows: [], errors: [] });
  const a = game.audio, p = game.player;
  const R = label => out.rows.push({ label, state: game.state, ctx: a.ctx && a.ctx.state, loops: a.loops.size, loopBusGain: a.loopBus ? +a.loopBus.gain.value.toFixed(3) : null, muffleVar: +a._pauseMuffle.toFixed(3), grState: p.grapple.state, isGrappling: p.isGrappling });
  try {
    await frames(40);
    game.bots.update = () => {};
    R('start');
    // real grapple
    const eye = p.getEyePosition(p.position.clone());
    for (let k = 0; k < 40; k++) { p.yaw = k * 0.157; p.pitch = 0.25; if (game.world.raycast(eye, p.getAimDirection(p.position.clone()), 44)) break; }
    p.grapple.fire();
    const ok = await until(() => p.isGrappling, 200);
    await frames(10);
    R('grapple attached ok=' + ok);
    game.pause();
    await frames(120);
    R('paused mid-grapple');
    game.resume();
    await frames(5);
    R('resumed');
    game.endMatch('score');
    await frames(200);
    R('end screen');
    game.quitToMenu();
    await frames(120);
    R('menu after quit');
  } catch (e) { out.errors.push(String(e && e.stack || e)); }
  out.done = true;
}
