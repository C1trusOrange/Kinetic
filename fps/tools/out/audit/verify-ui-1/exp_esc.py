import sys, json, time
from common import *
s = Session(1280, 720)
s.cdp.call('Emulation.setFocusEmulationEnabled', {'enabled': True})

def key(code, key_, vk, typ):
    s.cdp.call('Input.dispatchKeyEvent', {'type': typ, 'code': code, 'key': key_, 'windowsVirtualKeyCode': vk, 'nativeVirtualKeyCode': vk})
def press(code, key_, vk):
    key(code, key_, vk, 'rawKeyDown'); key(code, key_, vk, 'keyUp')
def esc(): press('Escape', 'Escape', 27)

def real_click(sel):
    r = s.js(f"(() => {{ const e = document.querySelector({json.dumps(sel)}); if (!e) return null; const b = e.getBoundingClientRect(); return [b.x + b.width / 2, b.y + b.height / 2]; }})()")
    mouse_click(s, r[0], r[1])

s.goto('index.html', "window.__GAME__ && window.__GAME__.state === 'menu'", timeout=180)
s.cdp.call('Emulation.setFocusEmulationEnabled', {'enabled': True}); s.cdp.call('Page.bringToFront'); s.wait(1.0); print('hasFocus', s.js('document.hasFocus()'))
s.js("(() => { const g = __GAME__; window.__errs = 0; document.addEventListener('pointerlockerror', () => window.__errs++); return 1; })()")
INSTR = """
window.__rl = [];
const orig = Element.prototype.requestPointerLock;
Element.prototype.requestPointerLock = function (opts) {
  const rec = {t: Math.round(performance.now()), opts: JSON.stringify(opts || null), active: navigator.userActivation.isActive};
  window.__rl.push(rec);
  const p = orig.call(this, opts);
  if (p && p.then) p.then(() => { rec.res = 'ok'; }, e => { rec.res = e.name + ': ' + e.message; });
  return p;
};
return 'ok';
"""
print('instr', s.run(INSTR))
s.click('[data-act=play]')
s.wait(0.5)
s.click('[data-map=sandbox]')
s.run("const r = document.querySelector('input[data-opt=bots]'); r.value = '2'; r.dispatchEvent(new Event('input', {bubbles:true}));")
s.wait(0.3)
real_click('[data-act=deploy]')
t0 = time.time()
while time.time() - t0 < 150:
    if s.js("__GAME__.state") == 'playing': break
    s.wait(0.4)
s.wait(1.5)
def st(label):
    print('   rl:', s.js('window.__rl.splice(0)'))
    print(label, s.js("({state: __GAME__.state, locked: __GAME__.input.locked, lockUnavailable: __GAME__.input.lockUnavailable, failures: __GAME__.input._lockFailures, errs: window.__errs, hint: document.querySelector('.hud-hint').textContent, hintOn: document.querySelector('.hud-hint').classList.contains('on')})"))
st('after deploy (real click)')
# Cycle 1: Esc while locked (browser exits lock, page gets no keydown), then wait, Esc to resume
esc(); s.wait(0.8)
st('after 1st Esc (lock exit)')
s.wait(6.5)
esc(); s.wait(1.2)
st('after Esc-resume #1 (>5s in menu)')
# Path A: player clicks canvas -> relock?
if len(sys.argv) > 1 and sys.argv[1] == 'click':
    mouse_click(s, 640, 360); s.wait(1.0)
    st('after canvas click')
    esc(); s.wait(0.8); st('Esc (lock exit)')
    s.wait(6.5); esc(); s.wait(1.2); st('Esc-resume #2')
else:
    # Path B: pause again without clicking, resume again after >5s
    esc(); s.wait(0.8)
    st('Esc while playing-unlocked (pause again)')
    s.wait(6.5)
    esc(); s.wait(1.2)
    st('Esc-resume #2 (>5s)')
    mouse_click(s, 640, 360); s.wait(1.0)
    st('after canvas click')
    # Resume via button
    esc(); s.wait(0.8); st('Esc (pause)')
    s.wait(1.0)
    real_click('[data-act=resume]'); s.wait(1.0)
    st('after Resume button click')
s.close()
