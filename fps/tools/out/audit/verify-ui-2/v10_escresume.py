import sys, json, time
from common import *
s = Session(1280, 720)
s.goto('index.html', "window.__GAME__ && window.__GAME__.state === 'menu'", timeout=180)
s.wait(1.0)
s.cdp.call('Emulation.setFocusEmulationEnabled', {'enabled': True}); s.cdp.call('Page.bringToFront')
s.js("(window.__ul = 0, window.__lc = [], document.addEventListener('pointerlockerror', () => window.__ul++), document.addEventListener('pointerlockchange', () => window.__lc.push(!!document.pointerLockElement)), 1)")
print('state', start_match(s, bots=3, score=25, navigate=False))
def st(tag):
    print(tag, json.dumps(s.js("({state: __GAME__.state, locked: __GAME__.input.locked, lockEl: !!document.pointerLockElement, failures: __GAME__.input._lockFailures, unavailable: __GAME__.input.lockUnavailable, errEvents: window.__ul, lockEvents: window.__lc, active: navigator.userActivation.isActive, screen: __GAME__.menu.screen})")))
def key(code, key_, vk):
    for typ in ('rawKeyDown', 'keyUp'):
        s.cdp.call('Input.dispatchKeyEvent', {'type': typ, 'code': code, 'key': key_, 'windowsVirtualKeyCode': vk, 'nativeVirtualKeyCode': vk})
def click_sel(sel):
    pos = s.js(f"(() => {{ const b = document.querySelector({json.dumps(sel)}).getBoundingClientRect(); return [b.x + b.width/2, b.y + b.height/2]; }})()")
    for typ, extra in (('mouseMoved', {}), ('mousePressed', {'button':'left','clickCount':1}), ('mouseReleased', {'button':'left','clickCount':1})):
        s.cdp.call('Input.dispatchMouseEvent', dict(type=typ, x=pos[0], y=pos[1], **extra))
st('after deploy')
s.wait(1.0)
st('playing (1s)')
# --- cycle 1: Esc to pause (browser unlocks), wait 7s, Esc to resume
key('Escape', 'Escape', 27)
s.wait(1.0)
st('after Esc (pause)')
s.wait(7.0)
st('paused, 8s later')
key('Escape', 'Escape', 27)
s.wait(1.0)
st('after Esc-resume #1')
# --- cycle 2: Esc again (game pauses because not locked), wait, Esc resume again
key('Escape', 'Escape', 27)
s.wait(0.8)
st('after Esc (re-pause)')
s.wait(7.0)
key('Escape', 'Escape', 27)
s.wait(1.0)
st('after Esc-resume #2')
# --- recovery: Esc pause again, then click Resume button (gesture)
key('Escape', 'Escape', 27)
s.wait(0.8)
st('after Esc (re-pause 2)')
click_sel('[data-act=resume]')
s.wait(1.0)
st('after Resume button click')
s.close()
