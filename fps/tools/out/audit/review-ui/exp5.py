import sys, json
from common import *
s = Session(1280, 720)
print('state', start_match(s, bots=15, score=25))
s.run("__GAME__.bots.update = () => {}; __GAME__.player.god = true; __GAME__.input.setVirtual('scoreboard', true); ")
# give bots varied kills
s.run("const g=__GAME__; g.bots.list.forEach((b,i)=>{b.kills = (i*7)%9; b.deaths = (i*5)%7;}); g.player.kills=3; g.player.deaths=2; g.hud._scoreDirty = true;")
s.wait(1.0)
print(s.js("(() => { const p = document.querySelector('.board-panel').getBoundingClientRect(); const rows = document.querySelectorAll('[data-r=board] .sb-row'); const last = rows[rows.length-1].getBoundingClientRect(); return {panel:[p.top,p.bottom,p.height], lastRowBottom:last.bottom, rows: rows.length, scrollH: document.querySelector('.board-panel').scrollHeight, clientH: document.querySelector('.board-panel').clientHeight}; })()"))
s.shot('exp5_board_ffa.png')
s.close()
