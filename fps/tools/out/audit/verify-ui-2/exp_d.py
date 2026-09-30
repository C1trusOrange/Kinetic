import json, sys, time
from sess import Session
from common import start_match
from exp_b_helpers import new_match

s = Session(1280, 720)
try:
    st = start_match(s, map_id='sandbox', bots=15, mode='ffa', score=25, timelim=0)
    print('state', st)
    s.run("""
      const g = __GAME__;
      g.player.spawnProtectedUntil = g.time + 30;
      g.input.setVirtual('scoreboard', true);
      await new Promise(r => setTimeout(r, 1500));
    """)
    r = s.js("""(() => {
      const h = __GAME__.hud.e;
      const rc = e => { const b = e.getBoundingClientRect(); return [Math.round(b.left), Math.round(b.top), Math.round(b.right), Math.round(b.bottom)]; };
      const panel = h.boardwrap.querySelector('.board-panel');
      const hint = h.hint, shield = h.shield;
      const cx = e => { const b = e.getBoundingClientRect(); return [b.left + b.width/2, b.top + b.height/2]; };
      const top = pt => document.elementsFromPoint(pt[0], pt[1]).map(x => x.className || x.tagName).slice(0, 4);
      return {panel: rc(panel), hint: rc(hint), shield: rc(shield), hintOn: hint.className, shieldOn: shield.className, boardOn: h.boardwrap.className,
        atHint: top(cx(hint)), atShield: top(cx(shield)), order: ['boardwrap','hint','shield'].map(k => [...h.boardwrap.parentNode.children].indexOf(h[k])),
        zboard: getComputedStyle(h.boardwrap).zIndex, zhint: getComputedStyle(hint).zIndex, fs: getComputedStyle(__GAME__.hud.root).fontSize };
    })()""")
    print(json.dumps(r))
    s.shot('g_board_over.png')
finally:
    s.close()
