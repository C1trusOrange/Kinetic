import sys, json, time
from common import *
s = Session(1280, 720)
s.goto('index.html', "window.__GAME__ && window.__GAME__.state === 'menu'", timeout=180)
s.wait(1.0)
s.cdp.call('Emulation.setFocusEmulationEnabled', {'enabled': True}); s.cdp.call('Page.bringToFront')
s.js("(window.__ul = 0, window.__lc = [], document.addEventListener('pointerlockerror', () => window.__ul++), document.addEventListener('pointerlockchange', () => window.__lc.push(!!document.pointerLockElement)), 1)")
print('state', start_match(s, bots=3, score=25, navigate=False))
def st(tag):
    print(tag, json.dumps(s.js("({state: __GAME__.state, locked: __GAME__.input.locked, failures: __GAME__.input._lockFailures, unavailable: __GAME__.input.lockUnavailable, errEvents: window.__ul, hint: document.querySelector('.hud-hint').textContent, hintOn: document.querySelector('.hud-hint').classList.contains('on')})")))
def key(code, key_, vk):
    for typ in ('rawKeyDown', 'keyUp'):
        s.cdp.call('Input.dispatchKeyEvent', {'type': typ, 'code': code, 'key': key_, 'windowsVirtualKeyCode': vk, 'nativeVirtualKeyCode': vk})
def click_xy(x, y):
    for typ, extra in (('mouseMoved', {}), ('mousePressed', {'button':'left','clickCount':1}), ('mouseReleased', {'button':'left','clickCount':1})):
        s.cdp.call('Input.dispatchMouseEvent', dict(type=typ, x=x, y=y, **extra))
s.wait(1.0)
key('Escape', 'Escape', 27); s.wait(1.0)
s.wait(6.5)
key('Escape', 'Escape', 27); s.wait(1.5)
st('after Esc-resume #1 (1 failure)')
click_xy(640, 360); s.wait(1.0)
st('after canvas click')
# now poison: two consecutive failures, then click
key('Escape', 'Escape', 27); s.wait(1.0)   # browser unlock -> pause
s.wait(6.5)
key('Escape', 'Escape', 27); s.wait(1.0)   # resume #A fail
key('Escape', 'Escape', 27); s.wait(1.0)   # re-pause
s.wait(6.5)
key('Escape', 'Escape', 27); s.wait(1.5)   # resume #B fail
st('after 2 consecutive failures')
click_xy(640, 360); s.wait(1.0)
st('after canvas click when unavailable')
s.wait(15)
st('15s later')
s.shot('v11_poisoned.png')
s.close()
