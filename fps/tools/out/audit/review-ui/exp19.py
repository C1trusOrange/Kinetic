import sys, json, base64, os
from common import *
s = Session(1280, 720)
print('state', start_match(s, bots=1, score=25))
s.run("__GAME__.bots.update = () => {}; __GAME__.player.god = true;")
s.wait(2.0)
def clip_shot(name, x, y, w, h, scale=3):
    data = s.cdp.call('Page.captureScreenshot', {'format': 'png', 'clip': {'x': x, 'y': y, 'width': w, 'height': h, 'scale': scale}}, timeout=60)['data']
    open(os.path.join(os.path.dirname(os.path.abspath(__file__)), name), 'wb').write(base64.b64decode(data))
def force(obj, prop, val):
    s.run(f"Object.defineProperty({obj}, '{prop}', {{get: () => {json.dumps(val)}, set: () => {{}}, configurable: true}});")
force('__GAME__.weapons', 'spreadAngle', 0.03)
for wid in ['rifle', 'shotgun', 'rocket']:
    force('__GAME__.weapons', 'currentId', wid)
    s.wait(0.6)
    print(wid, s.js("(() => { const c = document.querySelector('.hud-cross'); const t = document.querySelector('.ch.t').getBoundingClientRect(); const r = document.querySelector('.ch-ring').getBoundingClientRect(); return {style: c.dataset.style, gap: document.querySelector('.k-hud').style.getPropertyValue('--gap'), ring: document.querySelector('.k-hud').style.getPropertyValue('--ring'), topBottom: t.bottom, ringRect: [r.left, r.top, r.width, r.height], disp: getComputedStyle(document.querySelector('.ch-ring')).display}; })()"))
    clip_shot(f'exp19_{wid}.png', 540, 260, 200, 200)
s.close()
