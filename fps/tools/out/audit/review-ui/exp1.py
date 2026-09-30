import sys, json
from common import *
s = Session(1280, 720)
print('state', start_match(s, bots=3, score=10))
print(s.js("({locked: __GAME__.input.locked, unavail: __GAME__.input.lockUnavailable, state: __GAME__.state})"))
# freeze bots, make player god
s.run("__GAME__.bots.update = () => {}; __GAME__.player.god = true; window.__ann = []; new MutationObserver(() => { window.__ann.push([Math.round(performance.now()), document.querySelector('[data-r=atitle]').textContent, document.querySelector('[data-r=asub]').textContent]); }).observe(document.querySelector('[data-r=atitle]'), {childList:true, characterData:true, subtree:true});")
s.wait(2.5)
print('initial ann', s.js("window.__ann"))
s.run("window.__ann.length = 0;")
# player kills with headshot reaching limit-1 (9)
r = s.run("""
const g = __GAME__;
g.player.kills = 8;
const bot = g.bots.list[0];
g.combat.kill(bot, {attacker: g.player, weapon: 'rifle', headshot: true});
await new Promise(r => setTimeout(r, 400));
return {ann: window.__ann, kills: g.player.kills};
""")
print(json.dumps(r))
s.shot('exp1_after.png')
s.close()
