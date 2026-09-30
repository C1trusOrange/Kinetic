// quitToMenu while grappling / cooking: are world-space visuals (rope, claw, grenade arc preview) left in the menu backdrop?
const frames = n => new Promise(res => { let c = 0; const f = () => (++c >= n ? res() : requestAnimationFrame(f)); requestAnimationFrame(f); });
async function until(cond, max = 400) { for (let i = 0; i < max; i++) { if (cond()) return true; await frames(1); } return false; }
export function drive() {}

export async function setup(game, report) {
  const out = (window.__LC__ = { done: false, rows: [], errors: [] });
  const p = game.player, inp = game.input, w = game.weapons;
  const V3 = p.position.constructor;
  const proj = v => { const q = new V3(v.x, v.y, v.z).project(game.camera); return { x: +q.x.toFixed(2), y: +q.y.toFixed(2), z: +q.z.toFixed(2), onScreen: q.z > -1 && q.z < 1 && Math.abs(q.x) < 1 && Math.abs(q.y) < 1 }; };
  const S = label => out.rows.push({
    label, state: game.state,
    grState: p.grapple.state, grVisible: p.grapple.group.visible, ropeVisible: p.grapple.rope.visible, clawPos: proj(p.grapple.claw.position),
    anchor: p.grappleAnchor ? proj(p.grappleAnchor) : null,
    previewDots: w.previewDots.visible, previewRing: w.previewRing.visible, previewCount: w.previewDots.count,
    ringPos: proj(w.previewRing.position),
    camPos: [game.camera.position.x, game.camera.position.y, game.camera.position.z].map(v => +v.toFixed(1)),
  });
  try {
    await frames(60);
    game.bots.update = () => {};
    p.spawnProtectedUntil = 0;
    // aim at a wall for the grapple
    const eye = p.getEyePosition(new V3());
    for (let k = 0; k < 40; k++) {
      p.yaw = k * 0.157; p.pitch = 0.25;
      if (game.world.raycast(eye, p.getAimDirection(new V3()), 44)) break;
    }
    p.grapple.fire();
    await until(() => p.isGrappling, 200);
    inp.setVirtual('grenade', true);
    await until(() => w.cooking && w.gState === 2, 200);
    await frames(10);
    S('playing: grapple + cook');
    game.pause();
    game.quitToMenu();
    await frames(60);
    S('menu after quit');
  } catch (e) { out.errors.push(String(e && e.stack || e)); }
  out.done = true;
}
