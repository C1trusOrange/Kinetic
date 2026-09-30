import json, sys, time
from sess import Session
from common import start_match

s = Session(1280, 720)
try:
    st = start_match(s, map_id='sandbox', bots=3, mode='ffa', score=10, timelim=10)
    print('state', st)
    # --- A: announce transform ---
    r = s.run("""
      const h = __GAME__.hud;
      h.announce('DOUBLE KILL','HEADSHOT','kill');
      await new Promise(r => setTimeout(r, 350));
      const a = h.e.announce, t = h.e.atitle;
      const rr = t.getBoundingClientRect(), ar = a.getBoundingClientRect();
      const out = {vw: innerWidth, tf: getComputedStyle(a).transform, titleCenter: (rr.left+rr.right)/2, annLeft: ar.left, annRight: ar.right, opacity: getComputedStyle(a).opacity};
      const anims = a.getAnimations().map(x => x.playState);
      out.anims = anims;
      return out;
    """)
    print('A1', json.dumps(r))
    s.shot('a_announce.png')
    r = s.run("""
      const h = __GAME__.hud;
      h.announce('1 MINUTE REMAINING','','info',1700);
      await new Promise(r => setTimeout(r, 350));
      const a = h.e.announce;
      const ar = a.getBoundingClientRect();
      return {vw: innerWidth, tf: getComputedStyle(a).transform, annLeft: ar.left, annRight: ar.right, opacity: getComputedStyle(a).opacity};
    """)
    print('A2', json.dumps(r))
    s.shot('a_minute.png')
    r = s.run("""
      const h = __GAME__.hud;
      const bot = __GAME__.entities.find(e => e.isBot);
      h._showKillText(bot, false);
      await new Promise(r => setTimeout(r, 300));
      const k = h.e.killtext.getBoundingClientRect();
      return {vw: innerWidth, tf: getComputedStyle(h.e.killtext).transform, left: k.left, right: k.right, center: (k.left+k.right)/2, opacity: getComputedStyle(h.e.killtext).opacity};
    """)
    print('A3', json.dumps(r))
    s.wait(2.5)
    r = s.run("""
      const h = __GAME__.hud;
      const a = h.e.announce; const ar = a.getBoundingClientRect();
      return {idleTf: getComputedStyle(a).transform, idleOpacity: getComputedStyle(a).opacity, left: ar.left, right: ar.right};
    """)
    print('A4 idle', json.dumps(r))

    # --- B: grapple ring ---
    r = s.run("""
      const g = __GAME__;
      Object.defineProperty(g.player, 'grappleCharge', { get: () => 0.5, set: () => {}, configurable: true });
      await new Promise(r => setTimeout(r, 300));
      const arc = g.hud.e.grarc, trk = arc.parentNode.querySelector('.trk');
      const ca = getComputedStyle(arc), ct = getComputedStyle(trk);
      return {arc: {dash: ca.strokeDasharray, off: ca.strokeDashoffset, stroke: ca.stroke, fill: ca.fill, sw: ca.strokeWidth}, trk: {dash: ct.strokeDasharray, stroke: ct.stroke, fill: ct.fill}, attrOff: arc.style.strokeDashoffset, cls: g.hud.e.grap.className};
    """)
    print('B', json.dumps(r))
    b = s.js("(() => { const b = __GAME__.hud.e.grap.getBoundingClientRect(); return [b.x, b.y, b.width, b.height]; })()")
    print('grap rect', b)
    s.shot('b_grap_0.5.png')
finally:
    s.close()
