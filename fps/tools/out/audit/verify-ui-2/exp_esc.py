import json, sys, time
from sess import Session
from common import start_match

s = Session(1280, 720)
def key(code, key_, vk, typ):
    s.cdp.call('Input.dispatchKeyEvent', {'type': typ, 'code': code, 'key': key_, 'windowsVirtualKeyCode': vk, 'nativeVirtualKeyCode': vk})
def press(code, key_, vk):
    key(code, key_, vk, 'rawKeyDown'); key(code, key_, vk, 'keyUp')
def st(label):
    print(label, json.dumps(s.js("""({state: __GAME__.state, locked: __GAME__.input.locked, unavail: __GAME__.input.lockUnavailable, fails: __GAME__.input._lockFailures, errs: window.__lockErrs, pl: !!document.pointerLockElement, active: navigator.userActivation.isActive, screen: __GAME__.menu.screen})""")))
try:
    s.goto('index.html', "window.__GAME__ && window.__GAME__.state === 'menu'", timeout=180)
    s.cdp.call('Emulation.setFocusEmulationEnabled', {'enabled': True}); s.cdp.call('Page.bringToFront')
    s.run("window.__lockErrs = 0; document.addEventListener('pointerlockerror', () => window.__lockErrs++);")
    stt = start_match(s, map_id='sandbox', bots=2, mode='ffa', score=25, timelim=0, navigate=False)
    print('match state', stt)
    s.wait(1.0)
    st('after deploy click')
    print('--- press Esc (user exits lock; game should pause)')
    press('Escape', 'Escape', 27)
    s.wait(1.0)
    st('after Esc #1')
    for cycle in (1, 2):
        s.wait(7.0)   # let transient activation expire
        st(f'cycle {cycle} before resume-Esc')
        press('Escape', 'Escape', 27)
        s.wait(1.5)
        st(f'cycle {cycle} after resume-Esc')
        # if the game went unlocked & playing, press Esc again to pause (what a player would do with no capture)
        if s.js("__GAME__.state") == 'playing':
            s.wait(0.6)
            press('Escape', 'Escape', 27)
            s.wait(1.0)
            st(f'cycle {cycle} after pause-Esc (state playing->paused expected)')
    s.wait(7.0)
    # canvas click should relock if not lockUnavailable
    if s.js("__GAME__.state") == 'paused':
        press('Escape', 'Escape', 27); s.wait(1.5)
    st('final')
    # real canvas click
    s.cdp.call('Input.dispatchMouseEvent', {'type': 'mouseMoved', 'x': 640, 'y': 360})
    s.cdp.call('Input.dispatchMouseEvent', {'type': 'mousePressed', 'x': 640, 'y': 360, 'button': 'left', 'clickCount': 1})
    s.cdp.call('Input.dispatchMouseEvent', {'type': 'mouseReleased', 'x': 640, 'y': 360, 'button': 'left', 'clickCount': 1})
    s.wait(1.0)
    st('after canvas click')
    print('hint text:', s.js("__GAME__.hud.e.hint.textContent"))
finally:
    s.close()
