import sys, json, base64, os
from common import *
s = Session(1280, 720)
print('state', start_match(s, bots=2, score=25))
s.run("__GAME__.bots.update = () => {}; __GAME__.player.god = true;")
s.wait(2.5)
def force(obj, prop, val):
    s.run(f"Object.defineProperty({obj}, '{prop}', {{get: () => {json.dumps(val)}, set: () => {{}}, configurable: true}});")
def unforce(obj, prop):
    s.run(f"delete {obj}.{prop};")
# state 1: reload + low ammo
force('__GAME__.weapons', 'reloading', True); force('__GAME__.weapons', 'reloadProgress', 0.55)
force('__GAME__.weapons', 'ammo', 3)
s.wait(0.5); s.shot('exp13_reload.png')
unforce('__GAME__.weapons', 'reloading'); unforce('__GAME__.weapons', 'reloadProgress')
# state 2: empty
force('__GAME__.weapons', 'ammo', 0)
s.wait(0.5); s.shot('exp13_empty.png')
unforce('__GAME__.weapons', 'ammo')
# state 3: cook hot
force('__GAME__.weapons', 'cooking', True); force('__GAME__.weapons', 'cookProgress', 0.85)
s.wait(0.5); s.shot('exp13_cook.png')
unforce('__GAME__.weapons', 'cooking'); unforce('__GAME__.weapons', 'cookProgress')
# state 4: fast + wallrun + sliding chips
force('__GAME__.player', 'speed', 22); force('__GAME__.player', 'isWallRunning', True); force('__GAME__.player', 'isSprinting', True); force('__GAME__.player', 'isGrappling', True)
s.wait(0.7); s.shot('exp13_fast.png')
for p in ['speed','isWallRunning','isSprinting','isGrappling']: unforce('__GAME__.player', p)
# state 5: low health
s.run("__GAME__.player.god = false; __GAME__.player.health = 18; __GAME__.player.armor = 45;")
s.wait(0.7); s.shot('exp13_lowhp.png')
s.close()
