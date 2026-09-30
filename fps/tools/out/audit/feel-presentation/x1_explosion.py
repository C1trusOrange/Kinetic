import sys, json, time
from common import *
import pngtool
W, H = 1280, 720
m = sys.argv[1] if len(sys.argv) > 1 else 'foundry'
dists = [float(x) for x in sys.argv[2].split(',')] if len(sys.argv) > 2 else [3, 6, 10]
from bloomlib import mk_session
s = mk_session(W, H)
open_game(s, m, bots=0)
s.run("__GAME__.hud.show(false); __GAME__.player.god = true;")
cam = s.js("""(() => { const w = __GAME__.world; const sp = w.spawnPoints.slice().sort((a,b)=>a.position.y-b.position.y); const q = sp[Math.floor(sp.length/2)]; const p = q.position; return [p.x, p.y+1.7, p.z, q.yaw, -0.05]; })()""")
print('cam', cam)
s.run(f"__GAME__.fixedCam = {json.dumps(cam)};")
s.wait(1.5)
times = [0.03, 0.1, 0.2, 0.35, 0.5, 0.75, 1.0, 1.5, 2.0, 3.0, 4.0]
res = {}
for d in dists:
    s.run("__GAME__.effects.clear();")
    s.run(f"""const g=__GAME__; const c=g.camera; const f=new g.camera.position.constructor(0,0,-1).applyQuaternion(c.quaternion);
      const pos=c.position.clone().addScaledVector(f,{d}); pos.y -= 0.6;
      g.state='paused'; g.effects.explosion(pos,{{radius:5, normal: new c.position.constructor(0,1,0)}});""")
    t = 0.0
    rows = []
    for tt in times:
        steps = int(round((tt - t) / (1/60)))
        s.run(f"for(let i=0;i<{steps};i++) __GAME__.effects.update(1/60);")
        t = tt
        s.wait(0.25)
        fn = f'x1_{m}_d{int(d)}_t{int(tt*100):03d}.png'
        s.shot(fn)
        st = pngtool.stats(fn)
        rows.append((tt, st))
        print(m, 'd', d, 't', tt, st)
    res[d] = rows
    s.run("__GAME__.state='playing';")
    s.wait(0.5)
print(json.dumps({str(k): [(t, st) for t, st in v] for k, v in res.items()}))
s.close()
