// Grapple attached at the moment of quitToMenu: rope + claw stay in the menu backdrop. UI hidden for the screenshot.
const frames = n => new Promise(res => { let c = 0; const f = () => (++c >= n ? res() : requestAnimationFrame(f)); requestAnimationFrame(f); });
async function until(cond, max = 400) { for (let i = 0; i < max; i++) { if (cond()) return true; await frames(1); } return false; }
export function drive() {}

export async function setup(game, report) {
  const out = (window.__LC__ = { done: false, rows: [], errors: [] });
  const p = game.player, w = game.weapons, inp = game.input;
  const V3 = p.position.constructor;
  const proj = v => { const q = new V3(v.x, v.y, v.z).project(game.camera); return { x: +q.x.toFixed(2), y: +q.y.toFixed(2), onScreen: q.z > -1 && q.z < 1 && Math.abs(q.x) < 1 && Math.abs(q.y) < 1 }; };
  const S = label => out.rows.push({
    label, state: game.state, grState: p.grapple.state, grVisible: p.grapple.group.visible, isGrappling: p.isGrappling,
    claw: proj(p.grapple.claw.position), hand: proj(p.grapple._handWorld(new V3())),
    previewDots: w.previewDots.visible, previewCount: w.previewDots.count, previewRing: w.previewRing.visible,
    cam: [game.camera.position.x, game.camera.position.y, game.camera.position.z].map(v => +v.toFixed(1)),
  });
  try {
    await frames(60);
    game.bots.update = () => {};
    p.spawnProtectedUntil = 0;
    const eye = p.getEyePosition(new V3());
    for (let k = 0; k < 40; k++) {
      p.yaw = k * 0.157; p.pitch = 0.25;
      if (game.world.raycast(eye, p.getAimDirection(new V3()), 44)) break;
    }
    p.grapple.fire();
    await until(() => p.isGrappling, 200);
    S('attached');
    // also start a grenade cook so the arc preview is on
    inp.setVirtual('grenade', true);
    await until(() => w.cooking && w.gState === 2 && w.previewDots.visible, 200);
    S('attached + cooking');
    if (!p.isGrappling) { out.errors.push('grapple not attached at quit time'); }
    game.pause();
    game.quitToMenu();
    await frames(40);
    S('menu after quit');
    game.uiRoot.style.display = 'none';   // hide DOM so the 3D backdrop is visible in the screenshot
    await frames(10);
  } catch (e) { out.errors.push(String(e && e.stack || e)); }
  out.done = true;
}
