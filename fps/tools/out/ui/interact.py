from sess import Session
import json
s = Session(1280, 720)
s.goto('tools/out/ui/harness.html', 'window.__READY')
s.run("localStorage.clear(); window.__H.menu.showMain();")
s.wait(0.5)
def st(): return s.js("({screen: __H.menu.screen, started: __H.game.started, cfg: __H.menu._cfg, set: {sens: __H.settings.get('sensitivity'), inv: __H.settings.get('invertY'), fov: __H.settings.get('fov'), q: __H.settings.get('quality'), name: __H.settings.get('playerName'), fps: __H.settings.get('showFps'), vol: __H.settings.get('masterVolume')}, sfx: __H.played.slice(-4)})")
print('main', st())
s.click('[data-act=play]'); s.wait(0.3)
s.click('[data-map=ruins]'); s.click('.seg[data-opt=mode] [data-v=tdm]'); s.click('.seg[data-opt=difficulty] [data-v=insane]')
s.click('.seg[data-opt=scoreLimit] [data-v=50]'); s.click('.seg[data-opt=timeLimit] [data-v=0]')
s.run("const r = document.querySelector('input[data-opt=bots]'); r.value = '11'; r.dispatchEvent(new Event('input', {bubbles:true}));")
print('setup', st())
s.click('[data-act=deploy]')
print('deployed', st()['started'])
# settings
s.run("__H.menu.showMain();"); s.wait(0.3)
s.click('.s-main [data-act=settings]'); s.wait(0.3)
s.run("""
const set = (k, v) => { const r = document.querySelector(`[data-set=${k}]`); r.value = String(v); r.dispatchEvent(new Event('input', {bubbles:true})); };
set('sensitivity', 1.75); set('fov', 90); set('masterVolume', 0.4); set('playerName', 'Neo the Great and Terrible');
""")
s.click('.k-toggle[data-set=invertY]'); s.click('.k-toggle[data-set=showFps]')
s.click('.seg[data-set=quality] [data-v=low]')
print('settings', st())
s.click('[data-act=reset-settings]')
print('reset', st())
# pause / quit confirm / escape
s.run("__H.startFakeMatch('ffa'); __H.game.state='paused'; __H.menu.showPause();")
s.wait(0.5)
s.click('[data-act=quit]'); print('quit1 label:', s.js("document.querySelector('[data-r=quitlbl]').textContent"))
s.click('[data-act=quit]')
s.run("__H.menu.showPause();")
s.wait(0.5)
s.js("window.dispatchEvent(new KeyboardEvent('keydown', {code: 'Escape'}))")
s.close()
