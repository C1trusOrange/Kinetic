import sys, json, time
from common import *
s = Session(1280, 720)
s.goto('index.html', "window.__GAME__ && window.__GAME__.state === 'menu'", timeout=180)
s.wait(1.0)
s.cdp.call('Emulation.setFocusEmulationEnabled', {'enabled': True}); s.cdp.call('Page.bringToFront')
s.js("(window.__ul = [], window.__lc = [], document.addEventListener('pointerlockerror', () => window.__ul.push('err')), document.addEventListener('pointerlockchange', () => window.__lc.push(!!document.pointerLockElement)), 1)")
s.js("(window.addEventListener('click', () => { window.__res = 'pending'; document.querySelector('canvas').requestPointerLock().then(() => window.__res = 'resolved', e => window.__res = e.name + ': ' + e.message); }, true), 1)")
for typ, extra in (('mouseMoved', {}), ('mousePressed', {'button':'left','clickCount':1}), ('mouseReleased', {'button':'left','clickCount':1})):
    s.cdp.call('Input.dispatchMouseEvent', dict(type=typ, x=900, y=300, **extra))
s.wait(0.6)
print('with click ->', s.js("window.__res"), 'locked', s.js("document.pointerLockElement && document.pointerLockElement.tagName"), 'events', s.js("window.__lc"), s.js("window.__ul"))
# now Esc via CDP: does the browser unlock?
for typ in ('rawKeyDown', 'keyUp'):
    s.cdp.call('Input.dispatchKeyEvent', {'type': typ, 'code': 'Escape', 'key': 'Escape', 'windowsVirtualKeyCode': 27, 'nativeVirtualKeyCode': 27})
s.wait(0.6)
print('after Esc: locked', s.js("!!document.pointerLockElement"), 'events', s.js("window.__lc"))
s.close()
