import sys
from sess import Session
size = sys.argv[1] if len(sys.argv) > 1 else '1280x720'
w, h = (int(v) for v in size.split('x'))
s = Session(w, h)
s.goto('tools/out/ui/game.html', "window.__GAME__ && window.__GAME__.state === 'menu'", timeout=150)
s.wait(2.5)
s.shot(f'flow_main_{w}.png')
print('state', s.js("__GAME__.state"), 'map', s.js("__GAME__.world.mapId"))
# open setup, pick sandbox, deploy via real mouse click
s.click('[data-act=play]')
s.wait(0.6)
s.click('[data-map=sandbox]')
s.click('.seg[data-opt=timeLimit] [data-v="3"]')
s.run("const r = document.querySelector('input[data-opt=bots]'); r.value = '4'; r.dispatchEvent(new Event('input', {bubbles:true}));")
s.wait(0.3)
s.shot(f'flow_setup_{w}.png')
# real click on deploy
pos = s.js("(() => { const b = document.querySelector('[data-act=deploy]').getBoundingClientRect(); return [b.x + b.width/2, b.y + b.height/2]; })()")
s.cdp.call('Input.dispatchMouseEvent', {'type': 'mouseMoved', 'x': pos[0], 'y': pos[1]})
s.cdp.call('Input.dispatchMouseEvent', {'type': 'mousePressed', 'x': pos[0], 'y': pos[1], 'button': 'left', 'clickCount': 1})
s.cdp.call('Input.dispatchMouseEvent', {'type': 'mouseReleased', 'x': pos[0], 'y': pos[1], 'button': 'left', 'clickCount': 1})
s.wait(0.6)
s.shot(f'flow_loading_{w}.png')
ok = s.goto('about:blank' if False else 'tools/out/ui/game.html', "window.__GAME__.state === 'playing'", timeout=1) if False else None
import time
t0 = time.time()
while time.time() - t0 < 120:
    st = s.js("__GAME__.state")
    if st == 'playing': break
    s.wait(0.5)
print('state after deploy', st, 'lock', s.js("({locked: __GAME__.input.locked, unavailable: __GAME__.input.lockUnavailable})"))
s.wait(3.0)
s.shot(f'flow_play_{w}.png')
s.wait(2.0)
s.shot(f'flow_play2_{w}.png')
print(s.js("({hudVisible: __GAME__.hud.visible, menuOpen: __GAME__.menu.root.classList.contains('open'), match: __GAME__.match.mapId, activeEl: document.activeElement.tagName})"))
# pause via API (as Game does on lock loss), screenshot, then click resume
s.run("__GAME__.pause();")
s.wait(0.6)
s.shot(f'flow_pause_{w}.png')
s.close()
