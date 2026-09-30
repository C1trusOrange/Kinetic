import sys, json
from common import *
s = Session(1280, 720)
s.goto('index.html', "window.__GAME__ && window.__GAME__.state === 'menu'", timeout=180)
s.wait(1.0)
s.run("window.__pl = {err:0, chg:0}; document.addEventListener('pointerlockerror', () => window.__pl.err++); document.addEventListener('pointerlockchange', () => window.__pl.chg++);")
print('state', start_match(s, bots=2, score=25, navigate=False))
print(s.js("({pl: window.__pl, locked: __GAME__.input.locked, fail: __GAME__.input._lockFailures, unavail: __GAME__.input.lockUnavailable, pe: !!document.pointerLockElement, focus: document.hasFocus()})"))
# pause via api, then wait, then real Escape key event
s.run("__GAME__.pause();")
s.wait(0.8)
print('paused', s.js("({state: __GAME__.state, screen: __GAME__.menu.screen})"))
def key(t, code, key, vk):
    s.cdp.call('Input.dispatchKeyEvent', {'type': t, 'code': code, 'key': key, 'windowsVirtualKeyCode': vk, 'nativeVirtualKeyCode': vk})
key('rawKeyDown', 'Escape', 'Escape', 27); key('keyUp', 'Escape', 'Escape', 27)
s.wait(1.0)
print('after esc', s.js("({pl: window.__pl, state: __GAME__.state, fail: __GAME__.input._lockFailures, unavail: __GAME__.input.lockUnavailable, locked: __GAME__.input.locked})"))
# second cycle: Esc while playing & unlocked -> pause ; Esc -> resume
key('rawKeyDown', 'Escape', 'Escape', 27); key('keyUp', 'Escape', 'Escape', 27)
s.wait(0.8)
print('after esc2', s.js("({state: __GAME__.state, fail: __GAME__.input._lockFailures, unavail: __GAME__.input.lockUnavailable})"))
key('rawKeyDown', 'Escape', 'Escape', 27); key('keyUp', 'Escape', 'Escape', 27)
s.wait(1.0)
print('after esc3', s.js("({pl: window.__pl, state: __GAME__.state, fail: __GAME__.input._lockFailures, unavail: __GAME__.input.lockUnavailable, locked: __GAME__.input.locked})"))
s.close()
