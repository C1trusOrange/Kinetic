import sys, json
from common import *
s = Session(1280, 720)
s.goto('index.html', "window.__GAME__ && window.__GAME__.state === 'menu'", timeout=180)
s.wait(1.5)
s.run("__GAME__.menu._go('settings');")
s.wait(0.5)
def setrange(key, val):
    s.run(f"const r = document.querySelector('input[data-set={key}]'); r.value = '{val}'; r.dispatchEvent(new Event('input', {{bubbles:true}}));")
setrange('sensitivity', 2.5); setrange('fov', 85); setrange('masterVolume', 0)
s.click('[data-set=invertY]'); s.click('[data-set=showFps]')
s.click('.seg[data-set=quality] [data-v=medium]')
s.run("const t = document.querySelector('input[data-set=playerName]'); t.focus(); t.value = '  Bobby Tables  '; t.dispatchEvent(new Event('input', {bubbles:true}));")
print('data', s.js("__GAME__.settings.data"))
print('stored', s.js("localStorage.getItem('kinetic.settings.v1')"))
# reload page
s.cdp.call('Page.reload', {}, timeout=150)
t0 = time.time()
while time.time() - t0 < 150:
    try:
        if s.js("window.__GAME__ && window.__GAME__.state === 'menu'") is True: break
    except Exception: pass
    s.wait(0.5)
s.wait(1.0)
print('after reload', s.js("__GAME__.settings.data"), s.js("__GAME__.quality.name"))
s.run("__GAME__.menu._go('settings');")
s.wait(0.5)
print('ui values', s.js("({sens: document.querySelector('input[data-set=sensitivity]').value, out: document.querySelector('[data-out=sensitivity]').textContent, fov: document.querySelector('[data-out=fov]').textContent, vol: document.querySelector('[data-out=masterVolume]').textContent, name: document.querySelector('input[data-set=playerName]').value, invert: document.querySelector('[data-set=invertY]').className, qual: document.querySelector('.seg[data-set=quality] .on').textContent})"))
s.click('[data-act=reset-settings]')
s.wait(0.5)
print('after reset', s.js("__GAME__.settings.data"))
s.close()
