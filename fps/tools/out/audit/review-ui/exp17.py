import sys, json
from common import *
s = Session(1280, 720)
print('state', start_match(s, bots=3, score=25))
s.run("__GAME__.bots.update = () => {}; __GAME__.player.god = true; window.__ann = []; const h = __GAME__.hud; const orig = h.announce.bind(h); h.announce = (...a) => { window.__ann.push([Math.round(performance.now()), ...a]); orig(...a); };")
s.wait(2.5)
s.run("window.__ann.length = 0;")
r = s.run("""
const g = __GAME__;
const [b1, b2, b3] = g.bots.list;
g.combat.kill(b2, {attacker: b1, weapon: 'rifle'});   // bot leads 1-0
await new Promise(r => setTimeout(r, 200));
const a1 = window.__ann.slice();
g.combat.kill(b3, {attacker: g.player, weapon: 'rifle'});  // tie 1-1
await new Promise(r => setTimeout(r, 200));
return {afterBotKill: a1, all: window.__ann, hudRank: document.querySelector('[data-r=tlname]').textContent, pk: g.player.kills, bk: b1.kills, pd: g.player.deaths, bd: b1.deaths, rows: g.getScoreboard().map(r => [r.name, r.kills, r.deaths])};
""")
print(json.dumps(r))
s.close()
