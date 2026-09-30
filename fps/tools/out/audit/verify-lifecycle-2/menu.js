// Verifier 2: real pause -> quit flow while grappling and cooking a grenade. What remains in the menu backdrop?
const frames = n => new Promise(res => { let c = 0; const f = () => (++c >= n ? res() : requestAnimationFrame(f)); requestAnimationFrame(f); });
export function drive(t, dt, game) {
  if (window.__V2__ && window.__V2__.hold) game.input.setVirtual('grenade', true);
}
export async function setup(game, report) {
  const out = (window.__V2__ = { done: false, rows: [], errors: [], hold: false });
  const p = game.player, w = game.weapons;
  const S = label => out.rows.push({
    label, state: game.state, grState: p.grapple.state, grVisible: p.grapple.group && p.grapple.group.visible, isGrappling: p.isGrappling, alive: p.alive,
    cooking: w.cooking, previewDots: w.previewDots && w.previewDots.visible, previewRing: w.previewRing && w.previewRing.visible,
    loops: game.audio.loops.size,
    playerInScene: game.scene.children.length,
  });
  try {
    await frames(40);
    game.bots.update = () => {};
    S('start');
    const eye = p.getEyePosition(p.position.clone());
    for (let k = 0; k < 40; k++) {
      p.yaw = k * 0.157; p.pitch = 0.25;
      if (game.world.raycast(eye, p.getAimDirection(p.position.clone()), 44)) break;
    }
    p.grapple.fire();
    for (let i = 0; i < 200 && !p.isGrappling; i++) await frames(1);
    if (!location.search.includes('nocook')) { out.hold = true;   // hold G -> cook
    for (let i = 0; i < 60 && !(w.cooking && w.previewDots.visible); i++) await frames(1); }
    await frames(5);
    S('in-match: grappling + cooking');
    game.pause();
    await frames(10);
    S('paused');
    out.hold = false;
    game.quitToMenu();
    game.uiRoot.style.display = 'none';
    await frames(60);
    S('menu after quitToMenu');
    if (location.search.includes('stay')) { out.done = true; return; }
    // How does startMatch clean up?  (for comparison)
    await game.startMatch({ mapId: 'sandbox', mode: 'ffa', botCount: 2, difficulty: 'easy' });
    await frames(5);
    S('after next startMatch');
  } catch (e) { out.errors.push(String(e && e.stack || e)); }
  out.done = true;
}
