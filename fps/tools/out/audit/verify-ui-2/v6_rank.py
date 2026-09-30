import sys, json
from common import *
from sess import HERE
WRAP = """window.__ann = []; const g = __GAME__; const h = g.hud; const orig = h.announce.bind(h);
h.announce = (...a) => { window.__ann.push({frame: g.frame, t: a[0], sub: a[1]}); orig(...a); };"""
s = Session(1280, 720)
print('state', start_match(s, bots=9, score=25, timelim=0))
s.run("__GAME__.bots.update = () => {}; __GAME__.player.god = true;" + WRAP)
s.wait(2.0)
# 1. tie-break mismatch: player 3k/2d, bot 3k/1d, others 0
r = s.run("""
const g = __GAME__;
for (const e of g.entities) { e.kills = 0; e.deaths = 0; }
g.player.kills = 3; g.player.deaths = 2;
const b = g.bots.list[0]; b.kills = 3; b.deaths = 1;
g.hud._scoreDirty = true;
await new Promise(r => setTimeout(r, 400));
const rows = g.getScoreboard();
return {hudRank: document.querySelector('[data-r=tlname]').textContent, hudTag: document.querySelector('[data-r=trtag]').textContent,
  scoreboardPlayerRank: rows.findIndex(x => x.isPlayer) + 1, top3: rows.slice(0,3).map(x => [x.name, x.kills, x.deaths])};
""")
print('tie-break', json.dumps(r))
# 2. tie treated as lead: everyone 0; bot scores 1 -> LEAD? then player 1 (tie)
s.run("window.__ann.length = 0;")
r = s.run("""
const g = __GAME__;
for (const e of g.entities) { e.kills = 0; e.deaths = 0; }
g.hud._leaderId = -1;
await new Promise(r => setTimeout(r, 300));
const b = g.bots.list[0];
// bot kills player-side dummy (another bot) -> bot leads 1-0
g.combat.kill(g.bots.list[1], {attacker: b, weapon: 'rifle'});
await new Promise(r => setTimeout(r, 400));
const afterBot = {rank: document.querySelector('[data-r=tlname]').textContent, ann: window.__ann.slice()};
g.combat.kill(g.bots.list[2], {attacker: g.player, weapon: 'rifle'});   // player ties 1-1 (player has more deaths? no deaths)
await new Promise(r => setTimeout(r, 400));
const rows = g.getScoreboard();
return {afterBot, afterTie: {rank: document.querySelector('[data-r=tlname]').textContent, tag: document.querySelector('[data-r=trtag]').textContent, ann: window.__ann.slice(),
  board: rows.slice(0,3).map(x => [x.name, x.kills, x.deaths])}};
""")
print('tie-lead', json.dumps(r))
s.close()
