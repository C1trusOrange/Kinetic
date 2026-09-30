import sys, json
from common import *
s = Session(1280, 720)
print('state', start_match(s, bots=2, score=25))
s.run("__GAME__.bots.update = () => {}; ")
s.wait(2.5)
probe = """(() => {
  const q = sel => document.querySelector(sel);
  const g = __GAME__;
  return {
    t: +g.time.toFixed(2), alive: g.player.alive, respawnAt: +g.player.respawnAt.toFixed(2),
    death: q('.hud-death').classList.contains('on'),
    dcount: q('[data-r=dcount]').textContent, dtag: q('[data-r=dtag]').textContent, dby: q('[data-r=dby]').textContent,
    dhp: q('[data-r=dhp]').textContent,
    dprog: q('[data-r=dprog]').style.transform,
    cross_off: q('.hud-cross').classList.contains('off'),
    scope_on: q('.hud-scope').classList.contains('on'), scoped: g.weapons.scoped,
    feed: q('[data-r=feed]').children.length,
    ring: q('[data-r=ring]').className,
  };
})()"""
# Test A: death
s.run("const g = __GAME__; g.combat.kill(g.player, {attacker: g.bots.list[0], weapon: 'rifle', headshot: true});")
for i in range(9):
    print('A', json.dumps(s.js(probe)))
    s.wait(0.4)
s.shot('exp3_after_respawn.png')
# Test B: scope
s.run("const g = __GAME__; g.weapons.giveWeapon('sniper'); ")
s.wait(1.5)
s.run("__GAME__.input.setVirtual('ads', true);")
s.wait(1.5)
print('B scoped', json.dumps(s.js(probe)))
s.shot('exp3_scoped.png')
s.run("const g = __GAME__; g.combat.kill(g.player, {attacker: g.bots.list[1], weapon: 'sniper', headshot: false});")
s.wait(0.5)
print('B dead', json.dumps(s.js(probe)))
s.run("__GAME__.input.setVirtual('ads', false);")
s.wait(3.5)
print('B respawned', json.dumps(s.js(probe)))
# Test C: feed lifetime
s.wait(4)
print('C feed after 7+s', s.js("document.querySelector('[data-r=feed]').children.length"), s.js("__GAME__.hud._feedCount"))
# Test D: restart while dead
s.run("const g = __GAME__; g.combat.kill(g.player, {attacker: g.bots.list[0], weapon: 'rifle'});")
s.wait(0.8)
print('D dead', json.dumps(s.js(probe)))
s.run("__GAME__.restartMatch();")
t0 = time.time()
while time.time() - t0 < 100 and s.js("__GAME__.state") != 'playing':
    s.wait(0.4)
s.wait(0.3)
print('D restarted', json.dumps(s.js(probe)))
s.wait(1.0)
print('D restarted+1s', json.dumps(s.js(probe)))
s.close()
