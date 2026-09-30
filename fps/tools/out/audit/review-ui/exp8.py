import sys, json, base64, os
from common import *
s = Session(1280, 720)
print('state', start_match(s, bots=1, score=25))
s.run("__GAME__.bots.update = () => {}; __GAME__.player.god = true;")
s.wait(1.0)
def clip_shot(name, x, y, w, h, scale=4):
    data = s.cdp.call('Page.captureScreenshot', {'format': 'png', 'clip': {'x': x, 'y': y, 'width': w, 'height': h, 'scale': scale}}, timeout=60)['data']
    open(os.path.join(os.path.dirname(os.path.abspath(__file__)), name), 'wb').write(base64.b64decode(data))
box = s.js("(() => { const b = document.querySelector('.grap').getBoundingClientRect(); return [b.x, b.y, b.width, b.height]; })()")
print('grap box', box)
for ch in [1.0, 0.5, 0.1]:
    # override the charge each frame
    s.run(f"const g = __GAME__; Object.defineProperty(g.player, 'grappleCharge', {{get: () => {ch}, set: () => {{}}, configurable: true}});")
    s.wait(0.6)
    print(ch, s.js("(() => { const a = document.querySelector('[data-r=grarc]'); const cs = getComputedStyle(a); const t = getComputedStyle(document.querySelector('.grap .trk')); return {dasharray: cs.strokeDasharray, offset: cs.strokeDashoffset, fill: cs.fill, stroke: cs.stroke, trkStroke: t.stroke, trkFill: t.fill, cls: document.querySelector('.grap').className}; })()"))
    clip_shot(f'exp8_grap_{ch}.png', box[0]-10, box[1]-10, box[2]+20, box[3]+20)
s.close()
