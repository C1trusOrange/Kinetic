import sys, json
from common import *
s = Session(1280, 720)
s.goto('index.html', "window.__GAME__ && window.__GAME__.state === 'menu'", timeout=180)
s.wait(1.5)
s.run("__GAME__.menu._go('settings');")
s.wait(0.8)
# set quality high through the actual button
s.click('[data-set=quality] [data-v=high]')
s.wait(0.6)
print('quality after clicking high button', s.js("__GAME__.settings.get('quality')"))
print('label.control', s.js("(() => { const l = document.querySelector('[data-set=quality]').closest('label'); const c = l.control; return c ? [c.tagName, c.dataset.v] : null; })()"))
pos = s.js("(() => { const b = document.querySelector('[data-set=quality]').closest('label').querySelector('.set-l').getBoundingClientRect(); return [b.x + 10, b.y + b.height/2]; })()")
print('label text pos', pos)
s.js("(window.__clicks = [], document.addEventListener('click', e => window.__clicks.push([e.isTrusted, e.target.tagName, e.target.dataset.v||null, e.detail]), true), 1)")
for typ, extra in (('mouseMoved', {}), ('mousePressed', {'button':'left','clickCount':1}), ('mouseReleased', {'button':'left','clickCount':1})):
    s.cdp.call('Input.dispatchMouseEvent', dict(type=typ, x=pos[0], y=pos[1], **extra))
s.wait(1.5)
print('clicks seen', s.js("window.__clicks"))
print('quality after clicking label text', s.js("__GAME__.settings.get('quality')"), s.js("__GAME__.quality.name"), 'localStorage:', s.js("Object.entries(localStorage).map(([k,v]) => [k, v.slice(0,200)])"))
# other rows, real clicks on their label text
for key in ('sensitivity','invertY','fov','viewBob','showFps','masterVolume','playerName'):
    before = s.js(f"__GAME__.settings.get('{key}')")
    p = s.js(f"(() => {{ const b = document.querySelector('[data-set={key}]').closest('label').querySelector('.set-l').getBoundingClientRect(); return [b.x + 10, b.y + b.height/2]; }})()")
    for typ, extra in (('mouseMoved', {}), ('mousePressed', {'button':'left','clickCount':1}), ('mouseReleased', {'button':'left','clickCount':1})):
        s.cdp.call('Input.dispatchMouseEvent', dict(type=typ, x=p[0], y=p[1], **extra))
    s.wait(0.3)
    print(key, before, '->', s.js(f"__GAME__.settings.get('{key}')"))
s.shot('v1_settings.png')
s.close()
