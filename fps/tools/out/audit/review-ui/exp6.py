import sys, json
from common import *
s = Session(1280, 720)
print('state', start_match(s, bots=15, score=25, mode='tdm'))
s.run("""
const g=__GAME__; g.bots.update = () => {}; g.player.god = true; g.input.setVirtual('scoreboard', true);
g.player.name = 'WWWWWWWWWWWWWWWW';
g.bots.list.forEach((b,i)=>{b.kills = (i*7)%9; b.deaths = (i*5)%7;}); g.player.kills=3; g.player.deaths=2; g.hud._scoreDirty = true;
g.bots.list[1].name = 'MMMMMMMMMMMMMMMM';
g.match.teamScores[1] = 12; g.match.teamScores[2] = 9;
// kill feed with long names
g.combat.kill(g.bots.list[2], {attacker: g.player, weapon: 'rocket'});
g.combat.kill(g.bots.list[4], {attacker: g.bots.list[1], weapon: 'melee', headshot: true});
""")
s.wait(1.2)
print(s.js("(() => { const p = document.querySelector('.board-panel').getBoundingClientRect(); const rows = document.querySelectorAll('[data-r=board] .sb-row'); const last = rows[rows.length-1].getBoundingClientRect(); return {panel:[p.top,p.bottom,p.height], lastRowBottom:last.bottom, rows: rows.length, scrollH: document.querySelector('.board-panel').scrollHeight, clientH: document.querySelector('.board-panel').clientHeight}; })()"))
s.shot('exp6_board_tdm.png')
s.run("__GAME__.input.setVirtual('scoreboard', false);")
s.wait(0.5)
s.shot('exp6_hud_tdm.png')
s.close()
