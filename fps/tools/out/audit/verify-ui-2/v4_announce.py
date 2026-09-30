import sys, json
from common import *
from sess import HERE
WRAP = "window.__ann = []; const h = __GAME__.hud; const orig = h.announce.bind(h); h.announce = (...a) => { window.__ann.push([Math.round(performance.now()), ...a]); orig(...a); };"
s = Session(1280, 720)
print('state', start_match(s, bots=3, score=10))
s.run("__GAME__.bots.update = () => {}; __GAME__.player.god = true;" + WRAP)
s.wait(2.5)
s.run("window.__ann.length = 0;")
# A: kill callout overwritten by MATCH POINT (player reaches limit-1 with a headshot)
r = s.run("""
const g = __GAME__;
g.player.kills = 8;
const bot = g.bots.list[0];
g.combat.kill(bot, {attacker: g.player, weapon: 'rifle', headshot: true});
await new Promise(r => setTimeout(r, 500));
return {ann: window.__ann.slice(), kills: g.player.kills, titleNow: document.querySelector('[data-r=atitle]').textContent};
""")
print('A', json.dumps(r))
s.wait(2.2)
s.run("window.__ann.length = 0;")
# B: final kill with headshot -> VICTORY then HEADSHOT
r = s.run("""
const g = __GAME__;
const bot = g.bots.list[1];
g.combat.kill(bot, {attacker: g.player, weapon: 'rifle', headshot: true});
await new Promise(r => setTimeout(r, 500));
return {ann: window.__ann.slice(), state: g.state, over: g.match.over, playerWon: g.match.playerWon, titleNow: document.querySelector('[data-r=atitle]').textContent, subNow: document.querySelector('[data-r=asub]').textContent, kind: document.querySelector('.hud-announce').dataset.kind};
""")
print('B', json.dumps(r))
s.shot('v4_after_victory.png')
# after end screen
s.wait(2.6)
print('end screen state', s.js("({state: __GAME__.state, screen: __GAME__.menu.screen, banner: document.querySelector('[data-r=endtitle]').textContent})"))
s.close()
