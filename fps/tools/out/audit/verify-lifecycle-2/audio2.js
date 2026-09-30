// Verifier 2: match ends while attached to a LONG grapple -> is the reel loop still audible on the end screen?
const frames = n => new Promise(res => { let c = 0; const f = () => (++c >= n ? res() : requestAnimationFrame(f)); requestAnimationFrame(f); });
export function drive() {}
export async function setup(game, report) {
  const out = (window.__V2__ = { done: false, rows: [], errors: [] });
  const a = game.audio, p = game.player, g = p.grapple;
  const R = label => out.rows.push({ label, state: game.state, loops: a.loops.size, loopBusGain: a.loopBus ? +a.loopBus.gain.value.toFixed(3) : null, grState: g.state, isGrappling: p.isGrappling, endTimer: +game._endTimer.toFixed(2), dist: g.anchor ? +p.position.distanceTo(g.anchor).toFixed(1) : null });
  try {
    game.bots.update = () => {};
    await frames(30);
    // find the farthest wall hit
    const eye = p.getEyePosition(p.position.clone());
    let best = { d: 0, yaw: 0, pitch: 0 };
    for (let k = 0; k < 72; k++) for (const pitch of [0.05, 0.3]) {
      p.yaw = k * (Math.PI * 2 / 72); p.pitch = pitch;
      const h = game.world.raycast(eye, p.getAimDirection(p.position.clone()), 44);
      if (h && h.distance > best.d) best = { d: h.distance, yaw: p.yaw, pitch };
    }
    p.yaw = best.yaw; p.pitch = best.pitch;
    out.best = best;
    g.fire();
    for (let i = 0; i < 300 && !p.isGrappling; i++) await frames(1);
    R('attached');
    game.endMatch('time');
    R('endMatch called');
    for (let i = 0; i < 60; i++) await frames(1);
    R('60 frames after');
    await frames(200);
    R('end screen 260 frames after');
    game.quitToMenu();
    await frames(30);
    R('menu');
  } catch (e) { out.errors.push(String(e && e.stack || e)); }
  out.done = true;
}
