import sys, json
from common import *
import pngtool
W = int(sys.argv[1]); H = int(sys.argv[2]); m = sys.argv[3]; scen = sys.argv[4]  # scen: feet | wall
s = Session(W, H)
open_game(s, m, bots=0)
s.run("""
const g = __GAME__; g.player.god = true;
g.weapons.giveWeapon('rocket');
window.__exp = null;
g.events.on('explosion', e => { if (!window.__exp) { window.__exp = {t: g.time, effT: g.effects.time, d: e.position.distanceTo(g.camera.position)}; g.timeScale = 0; } });
g.input.setVirtual('weapon5', true);
""")
s.wait(1.5)
s.run("__GAME__.input.setVirtual('weapon5', false);")
s.wait(1.2)
print('weapon', s.js("__GAME__.weapons.currentId + ' ammo ' + __GAME__.weapons.ammo"))
pitch = -1.15 if scen == 'feet' else -0.05
s.run(f"const p=__GAME__.player; p.pitch={pitch}; ")
s.wait(0.3)
s.run("const g=__GAME__; g.player.pitch=%f; g.input.setVirtual('fire', true);" % pitch)
for i in range(60):
    s.wait(0.15)
    s.run("__GAME__.player.pitch=%f;" % pitch)
    if s.js("!!window.__exp"): break
s.run("__GAME__.input.setVirtual('fire', false);")
print('exp', s.js("window.__exp"), 'iters', i)
tot = 0.0
res = []
for cp in [0.02, 0.1, 0.25, 0.5, 0.9, 1.5, 2.3, 3.4]:
    n = int(round((cp - tot) * 60))
    if n > 0:
        s.run(f"for (let i=0;i<{n};i++) __GAME__.update(1/60);")
        tot += n / 60
    s.wait(0.35)
    name = f'r_{m}_{scen}_{W}_{int(cp*100):03d}.png'
    s.shot(name)
    st = pngtool.stats(name)
    st['t'] = cp
    st['glow'] = s.js("__GAME__.effects.stats.glow"); st['smoke'] = s.js("__GAME__.effects.stats.smoke")
    res.append(st)
    print(st)
s.run("__GAME__.timeScale = 1;")
s.close()
json.dump(res, open(f'r_{m}_{scen}.json', 'w'))
