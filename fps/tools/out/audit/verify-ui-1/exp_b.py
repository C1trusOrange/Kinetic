import sys, json
from common import *
s = Session(1280, 720)
print('state', start_match(s, bots=4, score=10))
s.run("__GAME__.bots.update = () => {}; __GAME__.player.god = true;")
s.wait(1.5)

# ---- F2 visual: hold grappleCharge via defineProperty
s.run("""const p = __GAME__.player; let v = 0.5; Object.defineProperty(p, 'grappleCharge', {get: () => v, set: x => {}, configurable: true}); window.__setCharge = x => { v = x; };""")
for ch in (0.5, 0.1):
    s.run(f"window.__setCharge({ch});")
    s.wait(0.3)
    print('F2', ch, s.js("""(() => { const a = document.querySelector('[data-r=grarc]'), t = document.querySelector('.grap .trk'); const ca = getComputedStyle(a), ct = getComputedStyle(t);
       return {cls: document.querySelector('.grap').className, arc: {dash: ca.strokeDasharray, off: ca.strokeDashoffset, fill: ca.fill, stroke: ca.stroke}, trk: {stroke: ct.stroke, fill: ct.fill, sw: ct.strokeWidth}}; })()"""))
    r = s.js("(() => { const b = document.querySelector('.grap').getBoundingClientRect(); return [b.x, b.y, b.width, b.height]; })()")
    clip_shot(s, f'b_grap_{ch}.png', r[0]-20, r[1]-20, r[2]+40, r[3]+40)

# install instrumentation
s.run("""
const g = __GAME__;
window.__f = 0; window.__log = [];
const hu = g.hud.update.bind(g.hud);
g.hud.update = function (dt) { window.__f++; return hu(dt); };
const an = g.hud.announce.bind(g.hud);
g.hud.announce = function (...a) { window.__log.push({f: window.__f, t: Math.round(performance.now()), title: a[0], sub: a[1], kind: a[2]}); return an(...a); };
const wu = g.weapons.update.bind(g.weapons);
window.__pending = null;
g.weapons.update = function (dt) { wu(dt); if (window.__pending) { const p = window.__pending; window.__pending = null; p(); } };
""")

# ---- F6: rank vs scoreboard tie-break
s.run("""
const g = __GAME__;
for (const e of g.entities) { e.kills = 0; e.deaths = 0; }
const bots = g.entities.filter(e => e !== g.player);
g.player.kills = 3; g.player.deaths = 2;
bots[0].kills = 3; bots[0].deaths = 1;
g.hud._scoreDirty = true;
""")
s.wait(0.4)
print('F6', s.js("""(() => { const g = __GAME__; const rows = g.getScoreboard(); return {hudOrdinal: document.querySelector('[data-r=tlname]').textContent, hudTag: document.querySelector('[data-r=trtag]').textContent, scoreboardRank: rows.findIndex(r => r.isPlayer) + 1, rows: rows.slice(0, 3).map(r => [r.name, r.kills, r.deaths])}; })()"""))
# end-of-match tie: winner by deaths
print('F6 winner-sort', s.js("""(() => { const g = __GAME__; const w = g.entities.slice().sort((a, b) => b.kills - a.kills || a.deaths - b.deaths)[0]; return {winner: w.name, isPlayer: w.isPlayer}; })()"""))

# F6b: tie -> "YOU TOOK THE LEAD"
s.run("""
const g = __GAME__;
for (const e of g.entities) { e.kills = 0; e.deaths = 0; e.alive = true; }
g.hud._leaderId = -1; g.hud._matchPoint = 0; g.hud._firstBlood = true; window.__log.length = 0;
const bots = g.bots.list.filter(b => b.alive);
window.__pending = () => { g.combat.kill(bots[1], {attacker: bots[0], weapon: 'rifle', headshot: false}); };
""")
s.wait(0.5)
s.run("""
const g = __GAME__; const bots = g.bots.list.filter(b => b.alive);
window.__pending = () => { g.combat.kill(bots[1], {attacker: g.player, weapon: 'rifle', headshot: false}); };
""")
s.wait(0.5)
print('F6b log', s.js("window.__log"), s.js("({p: [__GAME__.player.kills, __GAME__.player.deaths], hud: document.querySelector('[data-r=tlname]').textContent, b: __GAME__.bots.list.map(b => [b.kills, b.deaths])})"))

# ---- F5: callout replaced by MATCH POINT in the same frame
s.run("""
const g = __GAME__;
for (const e of g.entities) { e.kills = 0; e.deaths = 0; e.alive = true; }
g.hud._leaderId = -1; g.hud._matchPoint = 0; g.hud._firstBlood = false; window.__log.length = 0;
g.player.kills = 8;
g.hud._scoreDirty = true;
""")
s.wait(0.4)
s.run("""
const g = __GAME__; window.__log.length = 0;
window.__pending = () => { const bot = g.bots.list.find(b => b.alive); g.combat.kill(bot, {attacker: g.player, weapon: 'rifle', headshot: true}); };
""")
s.wait(0.5)
print('F5 log', s.js("window.__log"), 'kills', s.js("__GAME__.player.kills"), 'shown', s.js("document.querySelector('[data-r=atitle]').textContent"))

# ---- F4: victory banner overwritten by kill callout (final kill, headshot; first blood already happened)
s.run("""
const g = __GAME__;
for (const e of g.entities) { e.alive = true; }
g.hud._firstBlood = true; g.hud._leaderId = -1; window.__log.length = 0;
g.player.kills = 9; for (const b of g.bots.list) b.kills = 0;
g.hud._scoreDirty = true;
""")
s.wait(0.4)
s.run("""
const g = __GAME__; window.__log.length = 0;
window.__pending = () => { const bot = g.bots.list.find(b => b.alive); g.combat.kill(bot, {attacker: g.player, weapon: 'rifle', headshot: true}); };
""")
s.wait(0.6)
print('F4 log', s.js("window.__log"))
print('F4 state', s.js("({state: __GAME__.state, over: __GAME__.match.over, playerWon: __GAME__.match.playerWon, banner: document.querySelector('[data-r=atitle]').textContent + ' / ' + document.querySelector('[data-r=asub]').textContent, opacity: getComputedStyle(document.querySelector('.hud-announce')).opacity})"))
s.shot('b_victory.png')
s.close()
