import sys, json, time
from common import *
s = Session(1280, 720)
s.goto('index.html', "window.__GAME__ && window.__GAME__.state === 'menu'", timeout=180)
s.wait(1.0)
def key(code, key_, vk):
    for typ in ('rawKeyDown', 'keyUp'):
        s.cdp.call('Input.dispatchKeyEvent', {'type': typ, 'code': code, 'key': key_, 'windowsVirtualKeyCode': vk, 'nativeVirtualKeyCode': vk})
s.js("(window.__ul = [], document.addEventListener('pointerlockerror', () => window.__ul.push('err')), 1)")
print('initial isActive', s.js("navigator.userActivation.isActive"), 'hasBeenActive', s.js("navigator.userActivation.hasBeenActive"))
# Esc keydown
key('Escape', 'Escape', 27)
s.wait(0.2)
print('after trusted Escape: isActive', s.js("navigator.userActivation.isActive"), 'hasBeenActive', s.js("navigator.userActivation.hasBeenActive"))
# pointer lock request without gesture (canvas)
r = s.run("""
const c = document.querySelector('canvas');
let out = {};
try { const p = c.requestPointerLock({unadjustedMovement: true}); out.ret = typeof p; if (p && p.catch) await p.then(() => { out.res = 'resolved'; }, e => { out.res = e.name + ': ' + e.message; }); } catch (e) { out.thrown = e.name + ': ' + e.message; }
await new Promise(r => setTimeout(r, 200));
out.locked = document.pointerLockElement === c; out.errors = window.__ul.length; return out;""")
print('requestPointerLock w/o activation ->', json.dumps(r))
# KeyP keydown
key('KeyP', 'p', 80)
s.wait(0.2)
print('after trusted KeyP: isActive', s.js("navigator.userActivation.isActive"), 'hasBeenActive', s.js("navigator.userActivation.hasBeenActive"))
s.close()
