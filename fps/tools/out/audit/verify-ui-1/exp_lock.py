import sys, json, time
from common import *
s = Session(1280, 720)
s.goto('tools/out/audit/verify-ui-1/pl.html', "document.readyState==='complete'")
s.cdp.call('Emulation.setFocusEmulationEnabled', {'enabled': True}); s.cdp.call('Page.bringToFront'); s.wait(0.5); print('hasFocus', s.js('document.hasFocus()'))

def key(code, key_, vk, typ='keyDown'):
    s.cdp.call('Input.dispatchKeyEvent', {'type': typ, 'code': code, 'key': key_, 'windowsVirtualKeyCode': vk, 'nativeVirtualKeyCode': vk})

def press(code, key_, vk):
    key(code, key_, vk, 'rawKeyDown'); key(code, key_, vk, 'keyUp')

def dump(label):
    s.wait(0.5)
    print(label, json.dumps(s.js('window.__log.splice(0)')))
    print('   isActive now:', s.js('navigator.userActivation.isActive'))

print('A: fresh page, no activation -> Esc')
press('Escape', 'Escape', 27); dump('A')
print('   isActive after Esc:', s.js('navigator.userActivation.isActive'), 'hasBeenActive', s.js('navigator.userActivation.hasBeenActive'))
print('B: KeyP')
press('KeyP', 'p', 80); dump('B')
print('C: wait 6.5s then Esc (activation expired)')
s.wait(6.5)
print('   isActive before:', s.js('navigator.userActivation.isActive'))
press('Escape', 'Escape', 27); dump('C')
print('D: wait 6.5 s then KeyP')
s.wait(6.5)
press('KeyP', 'p', 80); dump('D')
print('E: mouse click activation then immediate Esc')
mouse_click(s, 100, 50)
s.wait(0.2)
press('Escape', 'Escape', 27); dump('E')
print('F: wait 6.5s then Esc again')
s.wait(6.5)
press('Escape', 'Escape', 27); dump('F')
s.close()
