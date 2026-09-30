import sys, json, math
from common import *
import pngtool
W, H = 1280, 720
maps = sys.argv[1].split(',')
dists = [float(x) for x in sys.argv[2].split(',')] if len(sys.argv) > 2 else [12, 25, 40]

def analyze(a_path, b_path):
    w, h, bpp, ra = pngtool.read_png(a_path)
    _, _, _, rb = pngtool.read_png(b_path)
    n = 0; sa = 0; sb = 0; minx = 9999; maxx = -1; miny = 9999; maxy = -1
    # first pass: mask
    pts = []
    for y in range(0, h):
        la = ra[y]; lb = rb[y]
        for x in range(0, w):
            i = x * bpp
            ya = 0.2126 * la[i] + 0.7152 * la[i+1] + 0.0722 * la[i+2]
            yb = 0.2126 * lb[i] + 0.7152 * lb[i+1] + 0.0722 * lb[i+2]
            if abs(ya - yb) > 6:
                pts.append((x, y, ya, yb))
    if len(pts) < 20:
        return None
    for x, y, ya, yb in pts:
        sa += ya; sb += yb; n += 1
        minx = min(minx, x); maxx = max(maxx, x); miny = min(miny, y); maxy = max(maxy, y)
    Lb = sa / n; Lbg = sb / n
    # surrounding ring luma from image B in a box 1.6x bbox minus bbox
    bw = maxx - minx; bh = maxy - miny
    x0 = max(0, minx - bw); x1 = min(w - 1, maxx + bw); y0 = max(0, miny - bh // 2); y1 = min(h - 1, maxy + bh // 2)
    rs = 0; rn = 0
    for y in range(y0, y1, 2):
        lb = rb[y]
        for x in range(x0, x1, 2):
            if minx <= x <= maxx and miny <= y <= maxy: continue
            i = x * bpp
            rs += 0.2126 * lb[i] + 0.7152 * lb[i+1] + 0.0722 * lb[i+2]; rn += 1
    Lring = rs / max(1, rn)
    return dict(px=n, bbox=[minx, miny, maxx, maxy], h_px=bh, Lbot=round(Lb, 1), Lbg_same=round(Lbg, 1), Lring=round(Lring, 1),
                weber=round((Lb - Lbg) / max(1.0, Lbg), 2), ring_weber=round((Lb - Lring) / max(1.0, Lring), 2))

allres = {}
for m in maps:
    s = Session(W, H)
    open_game(s, m, bots=1)
    s.run("__GAME__.hud.show(false); __GAME__.player.god = true; __GAME__.bots.update = () => {}; __GAME__.state='paused';")
    cams = s.js("""(() => { const w = __GAME__.world; const sp = w.spawnPoints.slice().sort((a,b)=>a.position.y-b.position.y);
      const pick = [sp[0], sp[Math.floor(sp.length*0.25)], sp[Math.floor(sp.length/2)], sp[sp.length-1]];
      return pick.map(s => [s.position.x, s.position.y+1.7, s.position.z, s.yaw, -0.03]); })()""")
    res = []
    for ci, cam in enumerate(cams):
        for d in dists:
            ok = s.js(f"""(() => {{ const g=__GAME__; const b=g.bots.list[0]; const cam={json.dumps(cam)};
              const fx=-Math.sin(cam[3]), fz=-Math.cos(cam[3]);
              const x=cam[0]+fx*{d}, z=cam[2]+fz*{d};
              const T=new g.camera.position.constructor(x, cam[1]+2, z); const h=g.world.raycast(T, new g.camera.position.constructor(0,-1,0), 10);
              if(!h) return 'nofloor';
              const p=h.point; b.alive=true; b.position.copy(p); b.velocity.set(0,0,0); b.yaw=cam[3]+Math.PI; if(b.model){{ b.model.root.position.copy(p); b.model.root.rotation.set(0,b.yaw,0); b.model.setVisible(true); }}
              g.fixedCam = cam; g._updateCamera(0.016);
              const eye=new g.camera.position.constructor(cam[0],cam[1],cam[2]); const chest=new g.camera.position.constructor(p.x,p.y+1.2,p.z);
              return g.combat.canSee(eye, chest) ? 'ok' : 'blocked'; }})()""")
            if ok != 'ok':
                print(m, ci, d, ok); continue
            s.wait(0.5)
            fa = f'x3_{m}_c{ci}_d{int(d)}_A.png'; fb = f'x3_{m}_c{ci}_d{int(d)}_B.png'
            s.shot(fa)
            s.run("__GAME__.bots.list[0].model.setVisible(false);")
            s.wait(0.4)
            s.shot(fb)
            s.run("__GAME__.bots.list[0].model.setVisible(true);")
            r = analyze(fa, fb)
            print(m, 'cam', ci, 'd', d, r)
            res.append(dict(cam=ci, d=d, r=r))
    allres[m] = res
    s.close()
json.dump(allres, open('x3_botvis_' + '_'.join(maps) + '.json', 'w'), indent=1)
