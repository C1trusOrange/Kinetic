import sys, json
from common import *
s = Session(1280, 720)
print('state', start_match(s, bots=2, score=25))
s.run("__GAME__.bots.update = () => {}; __GAME__.player.god = true;")
def key(code, keyname, vk, text=None):
    p = {'type': 'keyDown' if text else 'rawKeyDown', 'code': code, 'key': keyname, 'windowsVirtualKeyCode': vk, 'nativeVirtualKeyCode': vk}
    if text: p['text'] = text
    s.cdp.call('Input.dispatchKeyEvent', p)
    s.cdp.call('Input.dispatchKeyEvent', {'type': 'keyUp', 'code': code, 'key': keyname, 'windowsVirtualKeyCode': vk, 'nativeVirtualKeyCode': vk})
def st(label):
    print(label, s.js("({state: __GAME__.state, screen: __GAME__.menu.screen, origin: __GAME__.menu._origin, open: __GAME__.menu.root.classList.contains('open'), lockFail: __GAME__.input._lockFailures, unavail: __GAME__.input.lockUnavailable})"))
# Esc while playing unlocked -> pause
s.wait(1.0)
key('Escape', 'Escape', 27); s.wait(0.6); st('esc-> pause')
# open settings by click
s.click('.s-pause [data-act=settings]'); s.wait(0.6); st('settings')
key('Escape', 'Escape', 27); s.wait(0.6); st('esc from settings')
key('KeyP', 'p', 80, 'p'); s.wait(0.6); st('P at pause')
# now playing; press P again -> pause
key('KeyP', 'p', 80, 'p'); s.wait(0.6); st('P in play')
# typing in name field must not trigger resume
s.click('.s-pause [data-act=settings]'); s.wait(0.6)
s.run("document.querySelector('[data-set=playerName]').focus();")
key('KeyP', 'p', 80, 'p'); s.wait(0.5); st('P typed in name field')
print('name value', s.js("document.querySelector('[data-set=playerName]').value"), s.js("__GAME__.settings.get('playerName')"))
s.close()
