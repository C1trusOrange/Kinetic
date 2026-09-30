import sys, json
from common import *
from sess import HERE
WRAP = """window.__ann = []; window.__renders = 0; const g = __GAME__; const h = g.hud; const orig = h.announce.bind(h);
h.announce = (...a) => { window.__ann.push({frame: g.frame, renders: window.__renders, t: a[0], sub: a[1]}); orig(...a); };
const origRender = g.render.bind(g); g.render = (...a) => { window.__renders++; return origRender(...a); };"""
s = Session(1280, 720)
print('state', start_match(s, bots=3, score=10))
s.run("__GAME__.bots.update = () => {}; __GAME__.player.god = true;" + WRAP)
s.wait(2.5)
s.run("window.__ann.length = 0;")
# A: kill inside a frame (like real gameplay: death emitted from weapons/bots/projectiles update) -> callout vs MATCH POINT
r = s.run("""
const g = __GAME__;
g.player.kills = 8;
const origUpdate = g.update.bind(g);
g.update = function(dt) { g.update = origUpdate; g.combat.kill(g.bots.list[0], {attacker: g.player, weapon: 'rifle', headshot: true}); origUpdate(dt); };
await new Promise(r => setTimeout(r, 700));
return {ann: window.__ann.slice(), kills: g.player.kills, titleNow: document.querySelector('[data-r=atitle]').textContent};
""")
print('A in-frame', json.dumps(r))
s.wait(2.2)
s.run("window.__ann.length = 0;")
# B: final kill inside a frame
r = s.run("""
const g = __GAME__;
const origUpdate = g.update.bind(g);
g.update = function(dt) { g.update = origUpdate; g.combat.kill(g.bots.list[1], {attacker: g.player, weapon: 'rifle', headshot: true}); origUpdate(dt); };
await new Promise(r => setTimeout(r, 700));
return {ann: window.__ann.slice(), state: g.state, over: g.match.over, playerWon: g.match.playerWon, titleNow: document.querySelector('[data-r=atitle]').textContent};
""")
print('B in-frame', json.dumps(r))
s.close()
