import json, time
from sess import Session

def start_match(s, map_id='sandbox', bots=3, mode='ffa', score=25, timelim=10, diff='normal', navigate=True):
    if navigate:
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
    pos = s.js("(() => { const b = document.querySelector('[data-act=deploy]').getBoundingClientRect(); return [b.x + b.width/2, b.y + b.height/2]; })()")
    s.cdp.call('Input.dispatchMouseEvent', {'type': 'mouseMoved', 'x': pos[0], 'y': pos[1]})
    s.cdp.call('Input.dispatchMouseEvent', {'type': 'mousePressed', 'x': pos[0], 'y': pos[1], 'button': 'left', 'clickCount': 1})
    s.cdp.call('Input.dispatchMouseEvent', {'type': 'mouseReleased', 'x': pos[0], 'y': pos[1], 'button': 'left', 'clickCount': 1})
    t0 = time.time()
    while time.time() - t0 < 150:
        st = s.js("__GAME__.state")
        if st == 'playing': break
        s.wait(0.4)
    s.wait(1.0)
    return st
