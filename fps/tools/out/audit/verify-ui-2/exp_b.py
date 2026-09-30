import json, sys, time
from sess import Session
from common import start_match

def new_match(s, bots, score, mode='ffa', timelim=0):
    s.run(f"""
      await __GAME__.startMatch({{mapId:'sandbox', mode:'{mode}', botCount:{bots}, difficulty:'easy', scoreLimit:{score}, timeLimit:{timelim}}});
    """, timeout=120)
    t0 = time.time()
    while time.time() - t0 < 120:
        if s.js("__GAME__.state") == 'playing': break
        s.wait(0.4)
    s.wait(1.0)

s = Session(1280, 720)
try:
    st = start_match(s, map_id='sandbox', bots=3, mode='ffa', score=10, timelim=10)
    print('state', st)

    # ---- C: settings label click via a REAL mouse click ----
    s.run("__GAME__.pause();")
    s.wait(0.6)
    s.click('[data-act=settings]')
    s.wait(0.8)
    print('screen', s.js("__GAME__.menu.screen"), 'quality before', s.js("__GAME__.settings.get('quality')"), s.js("__GAME__.quality && __GAME__.quality.pixelRatio"))
    rect = s.js("""(() => { const l = document.querySelector('[data-set=quality]').closest('label'); const t = l.querySelector('.set-l'); const b = t.getBoundingClientRect(); const lb = l.getBoundingClientRect(); return {text:[b.x + 10, b.y + b.height/2], label:[lb.x, lb.y, lb.width, lb.height], firstLabelable: (l.control && l.control.outerHTML)}; })()""")
    print('rect', rect)
    x, y = rect['text']
    s.cdp.call('Input.dispatchMouseEvent', {'type': 'mouseMoved', 'x': x, 'y': y})
    s.cdp.call('Input.dispatchMouseEvent', {'type': 'mousePressed', 'x': x, 'y': y, 'button': 'left', 'clickCount': 1})
    s.cdp.call('Input.dispatchMouseEvent', {'type': 'mouseReleased', 'x': x, 'y': y, 'button': 'left', 'clickCount': 1})
    s.wait(0.6)
    print('quality after label-text click:', s.js("__GAME__.settings.get('quality')"), 'live quality', s.js("__GAME__.quality && __GAME__.quality.pixelRatio"), 'ls', s.js("(() => { try { return localStorage.getItem('kinetic.settings') || Object.keys(localStorage).map(k=>k+'='+localStorage.getItem(k)).join('|'); } catch(e) { return String(e); } })()"))

    # ---- I: playerName not applied live ----
    s.run("""
      const inp = document.querySelector('input[data-set=playerName]');
      inp.value = 'Zed'; inp.dispatchEvent(new Event('input', {bubbles:true}));
    """)
    s.wait(0.3)
    print('name: setting', s.js("__GAME__.settings.get('playerName')"), 'player.name', s.js("__GAME__.player.name"), 'board', s.js("__GAME__.getScoreboard().find(r => r.isPlayer).name"))
    s.run("__GAME__.resume();")
    s.wait(0.5)
    print('after resume: player.name', s.js("__GAME__.player.name"), 'state', s.js("__GAME__.state"))
    print('settings hint text', s.js("document.querySelector('.s-settings .k-head small').textContent"))
finally:
    s.close()
