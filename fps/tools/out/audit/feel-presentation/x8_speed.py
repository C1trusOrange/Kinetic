import sys, json, time
from common import *
import pngtool
def mk_session(W, H):
    for a in range(6):
        try: return Session(W, H)
        except Exception as e: print('[retry session]', e); time.sleep(5)
    raise SystemExit('no chrome')
s = mk_session(1280, 720)
open_game(s, 'skyline', bots=0)
s.run("__GAME__.hud.show(true); __GAME__.player.god = true; __GAME__.bots.update = () => {};")
s.run("const g=__GAME__; g.state='paused'; g.hud.e.speedfx.style.opacity='0.6'; g.hud.e.speedfx.style.visibility='visible'; g.hud._c.sl = 1;")
s.wait(0.6); s.shot('x8_speedlines.png')
# crosshair + hitmarker + damage number close-up composition
s.close()
