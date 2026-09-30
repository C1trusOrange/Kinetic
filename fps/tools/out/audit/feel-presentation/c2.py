import sys
from common import *
W = int(sys.argv[1]); H = int(sys.argv[2]); maps = sys.argv[3].split(',')
for m in maps:
    s = Session(W, H)
    open_game(s, m, bots=6)
    drive(s)
    for i in range(4):
        s.wait(3.0)
        s.shot(f'g_{m}_{W}_{i}.png')
    print(m, s.js("({fps: __GAME__.fps, kills: __GAME__.player.kills, hp: __GAME__.player.health, calls: __GAME__.renderer.info.render.calls, tris: __GAME__.renderer.info.render.triangles, weapon: __GAME__.weapons.currentId, alive: __GAME__.bots.list.filter(b=>b.alive).length})"))
    s.close()
