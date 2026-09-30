import sys, json
from common import *
s = Session(1280, 720)
print('state', start_match(s, bots=3, score=25))
s.run("__GAME__.bots.update = () => {}; __GAME__.player.god = true;")
s.wait(1.5)
def heap():
    return s.cdp.call('Runtime.getHeapUsage')['usedSize']
def bench(label, setup=''):
    if setup: s.run(setup)
    s.wait(0.3)
    res = []
    for _ in range(4):
        s.cdp.call('HeapProfiler.collectGarbage', timeout=60) if False else None
        h0 = heap()
        t = s.js("(() => { const g = __GAME__; const t0 = performance.now(); for (let i = 0; i < 300; i++) g.hud.update(1/60); return performance.now() - t0; })()")
        h1 = heap()
        res.append((round((h1 - h0) / 300), round(t / 300 * 1000, 1)))
    print(label, 'bytes/call, us/call:', res)
bench('idle FFA')
bench('moving (spread changes)', "const p = __GAME__.player; window.__sp = 0; const w = __GAME__.weapons; Object.defineProperty(w, 'spreadAngle', {get: () => 0.02 + 0.02*Math.random(), configurable: true});")
bench('scoped', "Object.defineProperty(__GAME__.weapons, 'scoped', {get: () => true, configurable: true});")
s.close()
