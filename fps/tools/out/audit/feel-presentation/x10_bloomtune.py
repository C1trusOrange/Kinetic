import sys, json, time
from common import *
import pngtool
from bloomlib import diffstats, mk_session
m = sys.argv[1]; camsel = [int(x) for x in sys.argv[2].split(',')]
V = [('cur', None), ('A', (0.55, 0.35, 1.0)), ('B', (0.45, 0.30, 1.25))]
s = mk_session(1280, 720)
open_game(s, m, bots=0)
s.run("__GAME__.hud.show(false);")
cams = s.js("""(() => { const w = __GAME__.world; const sp = w.spawnPoints.slice().sort((a,b)=>a.position.y-b.position.y);
  const pick = [sp[0], sp[Math.floor(sp.length/2)], sp[sp.length-1], sp[Math.floor(sp.length*0.25)]];
  return pick.map(s => [s.position.x, s.position.y+1.7, s.position.z, s.yaw, -0.03]); })()""")
cur = s.js("(() => { const b=__GAME__.bloomPass; return [b.strength, b.radius, b.threshold]; })()")
print('current bloom', cur)
res = {}
for ci in camsel:
    s.run(f"__GAME__.fixedCam = {json.dumps(cams[ci])}; __GAME__.bloomPass.enabled = false;"); s.wait(1.4)
    off = f'x10_{m}_c{ci}_off.png'; s.shot(off)
    for name, v in V:
        vv = cur if v is None else list(v)
        s.run(f"const b=__GAME__.bloomPass; b.enabled=true; b.strength={vv[0]}; b.radius={vv[1]}; b.threshold={vv[2]};"); s.wait(0.8)
        fn = f'x10_{m}_c{ci}_{name}.png'; s.shot(fn)
        res[f'c{ci}_{name}'] = diffstats(fn, off); print(m, ci, name, vv, res[f'c{ci}_{name}'])
s.close()
json.dump(res, open(f'x10_{m}.json','w'))
