import json, time, os, base64
from sess import Session

HERE = os.path.dirname(os.path.abspath(__file__))

def start_match(s, map_id='sandbox', bots=3, mode='ffa', score=25, timelim=10, diff='normal'):
    s.goto('index.html', "window.__GAME__ && window.__GAME__.state === 'menu'", timeout=180)
    s.wait(1.0)
    s.click('[data-act=play]')
    s.wait(0.5)
    s.click(f'[data-map={map_id}]')
    s.click(f'.seg[data-opt=mode] [data-v="{mode}"]')
    s.click(f'.seg[data-opt=difficulty] [data-v="{diff}"]')
    s.click(f'.seg[data-opt=scoreLimit] [data-v="{score}"]')
    s.click(f'.seg[data-opt=timeLimit] [data-v="{timelim}"]')
    s.run(f"const r = document.querySelector('input[data-opt=bots]'); r.value = '{bots}'; r.dispatchEvent(new Event('input', {{bubbles:true}}));")
    s.wait(0.3)
    s.click('[data-act=deploy]')
    t0 = time.time()
    st = None
    while time.time() - t0 < 150:
        st = s.js("__GAME__.state")
        if st == 'playing': break
        s.wait(0.4)
    s.wait(1.0)
    return st

def mouse_click(s, x, y):
    s.cdp.call('Input.dispatchMouseEvent', {'type': 'mouseMoved', 'x': x, 'y': y})
    s.cdp.call('Input.dispatchMouseEvent', {'type': 'mousePressed', 'x': x, 'y': y, 'button': 'left', 'clickCount': 1})
    s.cdp.call('Input.dispatchMouseEvent', {'type': 'mouseReleased', 'x': x, 'y': y, 'button': 'left', 'clickCount': 1})

def clip_shot(s, name, x, y, w, h, scale=4):
    d = s.cdp.call('Page.captureScreenshot', {'format': 'png', 'clip': {'x': x, 'y': y, 'width': w, 'height': h, 'scale': scale}}, timeout=60)['data']
    open(os.path.join(HERE, name), 'wb').write(base64.b64decode(d))
