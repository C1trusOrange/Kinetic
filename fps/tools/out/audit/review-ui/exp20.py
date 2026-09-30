import sys, json
from common import *
s = Session(1280, 720)
print('state', start_match(s, bots=4, score=25))
snap = """(() => {
  const g = __GAME__;
  const counts = {}; for (const [k, v] of g.events._map) counts[k] = v.length;
  return {listeners: counts, hudNodes: document.querySelector('.k-hud').getElementsByTagName('*').length, uiNodes: document.getElementById('ui').getElementsByTagName('*').length, anims: document.getAnimations().length, feed: document.querySelector('[data-r=feed]').children.length, toasts: document.querySelector('[data-r=toasts]').children.length};
})()"""
print('m1', json.dumps(s.js(snap)))
for i in range(3):
    s.run("const g = __GAME__; g.bots.list.forEach(b => { if (b.alive) g.combat.kill(b, {attacker: g.player, weapon: 'rifle'}); }); g.combat.kill(g.player, {attacker: g.bots.list[0], weapon: 'rifle'});")
    s.wait(0.5)
    s.run("__GAME__.pause();"); s.wait(0.6)
    s.click('[data-act=restart]')
    t0 = time.time()
    while time.time() - t0 < 100 and s.js("__GAME__.state") != 'playing':
        s.wait(0.4)
    s.wait(1.0)
    print(f'm{i+2}', json.dumps(s.js(snap)))
s.close()
