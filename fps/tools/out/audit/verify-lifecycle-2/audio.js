// Verifier 2: audio loops / muffle while paused & on end screen, with a REAL slide (virtual input) and a REAL grapple attach.
const frames = n => new Promise(res => { let c = 0; const f = () => (++c >= n ? res() : requestAnimationFrame(f)); requestAnimationFrame(f); });
let phase = 'idle';
export function drive(t, dt, game) {
  const inp = game.input;
  if (phase === 'run' || phase === 'slide') {
    inp.setVirtual('forward', true);
    inp.setVirtual('sprint', true);
    inp.setVirtual('crouch', phase === 'slide');
  } else {
    inp.setVirtual('forward', false);
    inp.setVirtual('sprint', false);
    inp.setVirtual('crouch', false);
  }
}
export async function setup(game, report) {
  const out = (window.__V2__ = { done: false, rows: [], errors: [] });
  const a = game.audio, p = game.player;
  const R = label => out.rows.push({ label, state: game.state, ctxState: a.ctx && a.ctx.state, ready: a.ready, loops: a.loops.size, loopBusGain: a.loopBus ? +a.loopBus.gain.value.toFixed(3) : null, muffleVar: +a._pauseMuffle.toFixed(3), muffleHz: a.muffle ? Math.round(a.muffle.frequency.value) : null, isSliding: p.isSliding, isGrappling: p.isGrappling });
  try {
    game.bots.update = () => {};
    await frames(40);
    R('playing, idle');
    // real slide
    phase = 'run';
    await frames(50);
    phase = 'slide';
    for (let i = 0; i < 30 && !p.isSliding; i++) await frames(1);
    await frames(3);
    R('playing, real slide active');
    game.pause();
    await frames(120);
    R('paused after 120 frames (slide)');
    game.resume();
    phase = 'idle';
    await frames(60);
    R('resumed + idle 60 frames');
    // real grapple: aim at a wall and fire
    const g = p.grapple;
    const eye = p.getEyePosition(p.position.clone());
    let aimed = false;
    for (let k = 0; k < 40 && !aimed; k++) {
      p.yaw = k * 0.157; p.pitch = 0.25;
      if (game.world.raycast(eye, p.getAimDirection(p.position.clone()), 44)) aimed = true;
    }
    g.fire();
    for (let i = 0; i < 200 && !p.isGrappling; i++) await frames(1);
    await frames(3);
    R('grapple attached, aimed=' + aimed + ' state=' + g.state);
    game.pause();
    await frames(120);
    R('PAUSED while grappling');
    game.resume();
    await frames(10);
    R('resumed (grapple)');
    game.endMatch('score');
    await frames(200);
    R('end screen (after outro)');
    out.grapple = { state: g.state, visible: g.group && g.group.visible, isGrappling: p.isGrappling };
    game.quitToMenu();
    await frames(60);
    R('menu');
  } catch (e) { out.errors.push(String(e && e.stack || e)); }
  out.done = true;
}
