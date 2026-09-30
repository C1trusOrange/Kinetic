import sys, json, time
from common import *
s = Session(1280, 720)
s.goto('index.html', "window.__GAME__ && window.__GAME__.state === 'menu'", timeout=180)
s.wait(1.0)
s.run("""
window.__samples = [];
__GAME__.events.on('match:start', () => {
  const t0 = performance.now();
  const a = document.querySelector('.hud-announce');
  const tick = () => {
    const t = performance.now() - t0;
    const cs = getComputedStyle(a);
    const r = a.getBoundingClientRect();
    window.__samples.push([Math.round(t), cs.opacity, Math.round(r.left), document.querySelector('[data-r=atitle]').textContent]);
    if (t < 2600) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
});
""")
s.click('[data-act=quick]')
t0 = time.time()
while time.time() - t0 < 100 and s.js("__GAME__.state") != 'playing':
    s.wait(0.1)
s.wait(3.5)
smp = s.js("window.__samples")
print(len(smp))
for x in smp[:: max(1, len(smp)//14)]: print(x)
s.close()
