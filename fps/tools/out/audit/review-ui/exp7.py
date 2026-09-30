import sys, json
from common import *
s = Session(1280, 720)
print('state', start_match(s, bots=15, score=25))
s.run("""
const g=__GAME__; g.bots.update = () => {}; g.player.god = true;
g.bots.list.forEach((b,i)=>{b.kills = (i*7)%9; b.deaths = (i*5)%7;}); g.player.kills=3; g.player.deaths=2;
g.bots.list[0].name = 'MMMMMMMMMMMMMMMM';
g.bots.list[0].kills = 25;
g.endMatch('score');
""")
s.wait(0.5)
print('mid', s.js("({state: __GAME__.state, ts: __GAME__.timeScale, title: document.querySelector('[data-r=atitle]').textContent, sub: document.querySelector('[data-r=asub]').textContent})"))
s.wait(3.5)
print('end', s.js("({state: __GAME__.state, screen: __GAME__.menu.screen, hud: __GAME__.hud.visible})"))
print(s.js("""(() => {
  const vh = innerHeight;
  const q = sel => document.querySelector(sel).getBoundingClientRect();
  const board = document.querySelector('.end-board');
  const b = q('.end-board'); const btn = q('[data-act=again]'); const btn2 = q('[data-act=menu]'); const ban = q('.end-banner');
  return {vh, board:[b.top,b.bottom], boardScroll:[board.scrollHeight, board.clientHeight], again:[btn.top, btn.bottom], menu:[btn2.top, btn2.bottom], banner:[ban.top, ban.bottom], title: document.querySelector('[data-r=endtitle]').textContent, sub: document.querySelector('[data-r=endsub]').textContent};
})()"""))
s.shot('exp7_end.png')
# click play again with real mouse
pos = s.js("(() => { const b = document.querySelector('[data-act=again]').getBoundingClientRect(); return [b.x + b.width/2, b.y + b.height/2]; })()")
s.cdp.call('Input.dispatchMouseEvent', {'type': 'mouseMoved', 'x': pos[0], 'y': pos[1]})
s.cdp.call('Input.dispatchMouseEvent', {'type': 'mousePressed', 'x': pos[0], 'y': pos[1], 'button': 'left', 'clickCount': 1})
s.cdp.call('Input.dispatchMouseEvent', {'type': 'mouseReleased', 'x': pos[0], 'y': pos[1], 'button': 'left', 'clickCount': 1})
t0 = time.time()
while time.time() - t0 < 100 and s.js("__GAME__.state") != 'playing':
    s.wait(0.4)
s.wait(1.0)
print('again', s.js("({state: __GAME__.state, screen: __GAME__.menu.screen, hud: __GAME__.hud.visible, kills: __GAME__.player.kills, timeScale: __GAME__.timeScale, over: __GAME__.match.over, time: __GAME__.match.timeLeft, ent: __GAME__.entities.length, menuOpen: __GAME__.menu.root.classList.contains('open')})"))
s.shot('exp7_again.png')
s.close()
