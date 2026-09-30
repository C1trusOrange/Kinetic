import sys, json
from common import *
import pngtool
W, H = 1280, 720
cam = [28, 1.7, 7, 1.1361261116456518, -0.03]
s = Session(W, H)
open_game(s, 'foundry', bots=0, extra='&quality=medium')
s.run("__GAME__.hud.show(false);")
s.run(f"__GAME__.fixedCam = {json.dumps(cam)};")
s.wait(2.5)
print(s.js("({q: __GAME__.quality.name, msaa: __GAME__.quality.msaa, w: __GAME__.renderer.domElement.width})"))
s.shot('q_medium.png')
s.run("__GAME__.setQuality('high'); __GAME__.fixedCam = %s;" % json.dumps(cam))
s.wait(3.0)
print(s.js("({q: __GAME__.quality.name, msaa: __GAME__.quality.msaa, w: __GAME__.renderer.domElement.width})"))
s.shot('q_high.png')
s.run("__GAME__.setQuality('low'); __GAME__.fixedCam = %s;" % json.dumps(cam))
s.wait(3.0)
print(s.js("({q: __GAME__.quality.name, msaa: __GAME__.quality.msaa, w: __GAME__.renderer.domElement.width})"))
s.shot('q_low.png')
s.close()
for n in ['medium','high','low']:
    pngtool.crop_scale(f'q_{n}.png', f'q_{n}_crop.png', 700, 60, 200, 130, 4)
