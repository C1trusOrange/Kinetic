import json, sys, time
from sess import Session

s = Session(1280, 720)
def key(code, key_, vk, typ):
    s.cdp.call('Input.dispatchKeyEvent', {'type': typ, 'code': code, 'key': key_, 'windowsVirtualKeyCode': vk, 'nativeVirtualKeyCode': vk})
def press(code, key_, vk):
    key(code, key_, vk, 'rawKeyDown'); key(code, key_, vk, 'keyUp')
def click(x, y):
    s.cdp.call('Input.dispatchMouseEvent', {'type': 'mouseMoved', 'x': x, 'y': y})
    s.cdp.call('Input.dispatchMouseEvent', {'type': 'mousePressed', 'x': x, 'y': y, 'button': 'left', 'clickCount': 1})
    s.cdp.call('Input.dispatchMouseEvent', {'type': 'mouseReleased', 'x': x, 'y': y, 'button': 'left', 'clickCount': 1})
def dump(label):
    s.wait(0.6)
    print(label, json.dumps(s.js('window.__log.splice(0)')), '| locked=', s.js('!!document.pointerLockElement'))
try:
    s.goto('tools/out/audit/verify-ui-2/pl2.html', "document.readyState==='complete'")
    s.cdp.call('Emulation.setFocusEmulationEnabled', {'enabled': True}); s.cdp.call('Page.bringToFront'); s.wait(0.5)
    print('hasFocus', s.js('document.hasFocus()'))
    print('A fresh page, Escape'); press('Escape', 'Escape', 27); dump('A')
    print('B click'); click(300, 200); dump('B')
    print('B2 exitPointerLock (by target)'); s.run('document.exitPointerLock()'); dump('B2')
    print('C wait 6.5s, Escape'); s.wait(6.5); print(' active?', s.js('navigator.userActivation.isActive')); press('Escape', 'Escape', 27); dump('C')
    print('D wait 6.5s, KeyP'); s.wait(6.5); press('KeyP', 'p', 80); dump('D')
    s.run('document.exitPointerLock()'); s.wait(0.5); s.js('window.__log.splice(0)')
    print('E click then Esc within 1s'); click(300, 200); s.wait(0.3); s.run('document.exitPointerLock()'); s.wait(0.3); s.js('window.__log.splice(0)'); press('Escape', 'Escape', 27); dump('E')
finally:
    s.close()
