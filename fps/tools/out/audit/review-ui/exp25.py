import sys, json
from common import *
s = Session(1280, 720)
print('state', start_match(s, bots=2, score=25))
s.run("__GAME__.bots.update = () => {}; __GAME__.player.god = true; __GAME__.pause();")
s.wait(0.8)
s.click('.s-pause [data-act=settings]'); s.wait(0.6)
s.run("const t = document.querySelector('input[data-set=playerName]'); t.focus(); t.value = 'Zed'; t.dispatchEvent(new Event('input', {bubbles:true}));")
s.click('.s-settings [data-act=back]'); s.wait(0.5)
s.click('.s-pause [data-act=resume]'); s.wait(1.0)
print(s.js("({setting: __GAME__.settings.get('playerName'), playerName: __GAME__.player.name, board: __GAME__.getScoreboard().find(r => r.isPlayer).name})"))
s.close()
