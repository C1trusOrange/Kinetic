import sys, json, base64, os
from common import *
s = Session(1280, 720)
print('state', start_match(s, bots=2, score=25))
s.run("__GAME__.bots.update = () => {}; __GAME__.player.god = true;")
s.wait(3.0)
s.run("__GAME__.hud.announce('DOUBLE KILL', 'HEADSHOT', 'kill', 2000);")
s.wait(0.35)
print('announce mid', s.js("(() => { const a = document.querySelector('.hud-announce'); const r = a.getBoundingClientRect(); const t = document.querySelector('[data-r=atitle]').getBoundingClientRect(); return {annCenter: (r.left + r.right)/2, annLeft: r.left, annRight: r.right, titleCenter: (t.left+t.right)/2, vw: innerWidth, tf: getComputedStyle(a).transform, op: getComputedStyle(a).opacity}; })()"))
s.shot('exp9_announce.png')
s.wait(2.5)
print('announce idle', s.js("(() => { const a = document.querySelector('.hud-announce'); const r = a.getBoundingClientRect(); return {annCenter: (r.left + r.right)/2, tf: getComputedStyle(a).transform, op: getComputedStyle(a).opacity}; })()"))
# kill text + hit marker
s.run("""
const g = __GAME__; const bot = g.bots.list[0];
g.player.kills = 0;
g.combat.applyDamage(bot, {amount: 60, attacker: g.player, weapon: 'rifle', headshot: false, point: bot.position, direction: g.camera.getWorldDirection(new g.camera.position.constructor())});
""")
s.wait(0.25)
print('after dmg', s.js("(() => { const h = document.querySelector('.hud-hit'); const n = [...document.querySelectorAll('.hud-nums span')].map(x => [x.textContent, getComputedStyle(x).opacity, getComputedStyle(x).transform]).filter(x => x[0]); return {hit: [getComputedStyle(h).opacity, h.className], nums: n}; })()"))
s.shot('exp9_hit.png')
s.run("const g = __GAME__; const bot = g.bots.list[0]; g.combat.kill(bot, {attacker: g.player, weapon: 'rifle', headshot: false});")
s.wait(0.3)
print('killtext', s.js("(() => { const k = document.querySelector('.hud-killtext'); const r = k.getBoundingClientRect(); return {center: (r.left + r.right)/2, left: r.left, right: r.right, tf: getComputedStyle(k).transform, op: getComputedStyle(k).opacity, txt: k.textContent}; })()"))
s.shot('exp9_kill.png')
s.close()
