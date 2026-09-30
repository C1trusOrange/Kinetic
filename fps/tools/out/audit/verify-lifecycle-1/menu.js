const frames = n => new Promise(res => { let c = 0; const f = () => (++c >= n ? res() : requestAnimationFrame(f)); requestAnimationFrame(f); });
async function until(cond, max = 400) { for (let i = 0; i < max; i++) { if (cond()) return true; await frames(1); } return false; }
export function drive() {}
export async function setup(game, report) {
  const out = (window.__V1__ = { done: false, rows: [], errors: [] });
  const a = game.audio, p = game.player, w = game.weapons;
  const R = label => out.rows.push({ label, state: game.state, alive: p.alive, grState: p.grapple.state, grVisible: p.grapple.group && p.grapple.group.visible, isGrappling: p.isGrappling, loops: a.loops.size, cooking: w.cooking, dots: w.previewDots && w.previewDots.visible, ring: w.previewRing && w.previewRing.visible, grenadesLive: game.projectiles.grenades.length });
  try {
    await frames(40);
    game.bots.update = () => {};
    const eye = p.getEyePosition(p.position.clone());
    for (let k = 0; k < 40; k++) { p.yaw = k * 0.157; p.pitch = 0.25; if (game.world.raycast(eye, p.getAimDirection(p.position.clone()), 44)) break; }
    p.grapple.fire();
    const ok = await until(() => p.isGrappling, 200); out.ok = ok;
    await frames(20);
    R('playing grappling+cooking');
    game.quitToMenu();
    game.input.setVirtual('grenade', false);
    await frames(90);
    R('menu after quit');
    document.querySelectorAll('#ui, .ui, #uiRoot').forEach(e => e.style.display = 'none');
    if (game.uiRoot) game.uiRoot.style.display = 'none';
  } catch (e) { out.errors.push(String(e && e.stack || e)); }
  out.done = true;
}
