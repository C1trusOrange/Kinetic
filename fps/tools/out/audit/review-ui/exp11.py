import sys, json, base64, os
from common import *
s = Session(1280, 720)
print('state', start_match(s, bots=3, score=25))
s.run("__GAME__.bots.update = () => {}; __GAME__.player.god = true;")
s.wait(2.5)
def metrics():
    m = s.cdp.call('Performance.getMetrics')['metrics']
    return {x['name']: x['value'] for x in m}
s.cdp.call('Performance.enable')
def measure(label, secs=3.0, setup=None):
    a = metrics(); f0 = s.js("__GAME__.frame")
    s.wait(secs)
    b = metrics(); f1 = s.js("__GAME__.frame")
    fr = max(1, f1 - f0)
    print(label, {k: round((b[k]-a[k])/fr, 4) for k in ['LayoutCount','RecalcStyleCount','LayoutDuration','RecalcStyleDuration','ScriptDuration']}, 'frames', fr)
measure('idle static')
# constant gap change: sprint/jitter spread by patching spreadAngle each frame via getter that varies with time
s.run("const w = __GAME__.weapons; Object.defineProperty(w, 'spreadAngle', {get: () => 0.02 + 0.015*Math.sin(performance.now()/150), set: () => {}, configurable: true});")
measure('spread varying')
s.run("const w = __GAME__.weapons; delete w.spreadAngle; w.spreadAngle = 0.02;")
measure('spread static')
s.run("__GAME__.hud.show(false)")
measure('hud hidden')
s.close()
