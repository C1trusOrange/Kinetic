import sys, json, time
from sess import Session
W = int(sys.argv[1]) if len(sys.argv) > 1 else 1280
H = int(sys.argv[2]) if len(sys.argv) > 2 else 720
tag = f'{W}'
s = Session(W, H)
s.goto('index.html', "window.__GAME__ && window.__GAME__.state === 'menu'", timeout=180)
s.wait(3.5)
s.shot(f'm_main_{tag}.png')
s.click('[data-act=play]'); s.wait(1.0)
s.shot(f'm_setup_{tag}.png')
s.click('[data-map=ruins]'); s.click('.seg[data-opt=mode] [data-v="tdm"]'); s.wait(0.5)
s.shot(f'm_setup_ruins_tdm_{tag}.png')
s.click('[data-act=back]'); s.wait(0.6)
s.click('[data-act=settings]'); s.wait(0.8)
s.shot(f'm_settings_{tag}.png')
s.click('[data-act=back]'); s.wait(0.6)
s.click('[data-act=controls]'); s.wait(0.8)
s.shot(f'm_controls_{tag}.png')
s.click('[data-act=back]'); s.wait(0.6)
s.run("__GAME__.menu.hide(); __GAME__.menu.showLoading('Loading Foundry', 0.45);")
s.wait(0.7)
s.shot(f'm_loading_{tag}.png')
s.run("__GAME__.menu.hideLoading(); __GAME__.menu.showMain();")
s.wait(1.0)
print(s.js("({fps: __GAME__.fps, info: {calls: __GAME__.renderer.info.render.calls, tris: __GAME__.renderer.info.render.triangles}})"))
s.close()
