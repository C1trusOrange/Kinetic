import sys, json, time
from sess import Session

DRIVER = r"""
(() => {
  if (window.__drv) clearInterval(window.__drv);
  window.__drvCfg = Object.assign({fire: true, move: true, ads: false, look: true}, window.__drvCfg || {});
  let t0 = performance.now();
  window.__drv = setInterval(() => {
    const g = window.__GAME__; if (!g || g.state !== 'playing') return;
    const cfg = window.__drvCfg; const p = g.player; const inp = g.input;
    if (!p.alive) { inp.setVirtual('fire', false); inp.setVirtual('forward', false); return; }
    const eye = p.getEyePosition(p.position.clone());
    let best = null, bd = 1e9, vis = false;
    for (const b of g.bots.list) {
      if (!b.alive) continue;
      const c = b.getChestPosition(b.position.clone());
      const d = c.distanceTo(eye);
      const v = g.combat.canSee(eye, c);
      if ((v && !vis) || (v === vis && d < bd)) { best = b; bd = d; vis = v; }
    }
    if (best && cfg.look) {
      const c = best.getChestPosition(best.position.clone());
      const dx = c.x - eye.x, dy = c.y - eye.y, dz = c.z - eye.z;
      const ty = Math.atan2(-dx, -dz), tp = Math.atan2(dy, Math.hypot(dx, dz));
      let dyaw = ty - p.yaw; while (dyaw > Math.PI) dyaw -= 2*Math.PI; while (dyaw < -Math.PI) dyaw += 2*Math.PI;
      p.yaw += dyaw * 0.35; p.pitch += (tp - p.pitch) * 0.35;
    }
    inp.setVirtual('fire', !!(cfg.fire && vis && bd < 60));
    inp.setVirtual('ads', !!cfg.ads);
    inp.setVirtual('forward', !!(cfg.move && (!vis || bd > 14)));
    inp.setVirtual('sprint', false);
  }, 30);
})();
"""

def open_game(s, map_id='foundry', bots=6, mode='ffa', extra='', diff='normal'):
    url = f'index.html?autotest=1&script=idle&map={map_id}&bots={bots}&mode={mode}&diff={diff}&duration=900&god=1{extra}'
    ok = False
    for attempt in range(3):
        ok = s.goto(url, "window.__TEST__ && window.__TEST__.started", timeout=150)
        if ok: break
        print('[open_game] retry', attempt)
    s.wait(1.0)
    return ok

def drive(s, **cfg):
    s.run(f"window.__drvCfg = {json.dumps(cfg)};" + DRIVER)

def stop_drive(s):
    s.run("clearInterval(window.__drv); const i=__GAME__.input; ['fire','forward','ads','sprint'].forEach(a=>i.setVirtual(a,false));")
