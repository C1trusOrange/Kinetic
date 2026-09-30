import sys, json
from common import *
s = Session(1280, 720)
print('state', start_match(s, bots=3, score=10))
s.run("__GAME__.bots.update = () => {}; __GAME__.player.god = true; window.__ann = []; const h = __GAME__.hud; const orig = h.announce.bind(h); h.announce = (...a) => { window.__ann.push([Math.round(performance.now()), ...a]); orig(...a); };")
s.wait(2.5)
s.run("window.__ann.length = 0;")
r = s.run("""
const g = __GAME__;
g.player.kills = 9;
const bot = g.bots.list[0];
g.combat.kill(bot, {attacker: g.player, weapon: 'rifle', headshot: true});
await new Promise(r => setTimeout(r, 600));
return {ann: window.__ann, state: g.state, playerWon: g.match.playerWon, kills: g.player.kills};
""")
print(json.dumps(r))
s.shot('exp16_after.png')
s.close()
