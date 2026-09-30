import sys, time
from sess import Session
s = Session(1280, 720)
s.goto('tools/out/ui/game.html?autotest=1&map=sandbox&bots=6&mode=tdm&duration=999&script=idle&diff=easy', "window.__TEST__ && window.__TEST__.started", timeout=150)
s.wait(6)
s.shot('flow2_tdm.png')
print(s.js("({state: __GAME__.state, mode: __GAME__.match.mode, team: __GAME__.player.team})"))
# force some events to look at the real getScoreboard / end flow
s.run("const g = __GAME__; g.match.teamScores[1] = 24; g.match.teamScores[2] = 19; g.player.kills = 11; g.endMatch('score');")
s.wait(4.0)
s.shot('flow2_end.png')
print(s.js("({state: __GAME__.state, screen: __GAME__.menu.screen, hudVisible: __GAME__.hud.visible})"))
# click Play again (real click)
pos = s.js("(() => { const b = document.querySelector('[data-act=again]').getBoundingClientRect(); return [b.x + b.width/2, b.y + b.height/2]; })()")
for t in ('mouseMoved', 'mousePressed', 'mouseReleased'):
    s.cdp.call('Input.dispatchMouseEvent', {'type': t, 'x': pos[0], 'y': pos[1], 'button': 'left', 'clickCount': 1})
t0 = time.time()
while time.time() - t0 < 60:
    if s.js("__GAME__.state") == 'playing': break
    s.wait(0.5)
print('after again:', s.js("({state: __GAME__.state, screen: __GAME__.menu.screen, hudVisible: __GAME__.hud.visible, kills: __GAME__.player.kills})"))
s.wait(3)
s.shot('flow2_again.png')
# quit to main menu via pause -> quit twice
s.run("__GAME__.pause();")
s.wait(0.5)
for i in range(2):
    pos = s.js("(() => { const b = document.querySelector('[data-act=quit]').getBoundingClientRect(); return [b.x + b.width/2, b.y + b.height/2]; })()")
    for t in ('mouseMoved', 'mousePressed', 'mouseReleased'):
        s.cdp.call('Input.dispatchMouseEvent', {'type': t, 'x': pos[0], 'y': pos[1], 'button': 'left', 'clickCount': 1})
    s.wait(0.4)
print('after quit:', s.js("({state: __GAME__.state, screen: __GAME__.menu.screen, hudVisible: __GAME__.hud.visible})"))
s.wait(1.0)
s.shot('flow2_menu.png')
s.close()
