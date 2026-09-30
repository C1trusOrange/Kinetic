import sys, json, time
from common import *
import pngtool
from bloomlib import mk_session
def edge_red(path):
    w,h,bpp,rows = pngtool.read_png(path)
    # outer 8% band, mean of R - (G+B)/2 and luma, vs centre
    def region(x0,y0,x1,y1):
        sr=sl=n=0
        for y in range(y0,y1,3):
            r=rows[y]
            for x in range(x0,x1,3):
                i=x*bpp; R,G,B=r[i],r[i+1],r[i+2]
                sr += R-(G+B)/2; sl += 0.2126*R+0.7152*G+0.0722*B; n+=1
        return round(sr/n,1), round(sl/n,1)
    bw=int(w*0.06)
    left=region(0,int(h*0.3),bw,int(h*0.7)); right=region(w-bw,int(h*0.3),w,int(h*0.7))
    top=region(int(w*0.3),0,int(w*0.7),int(h*0.06)); centre=region(int(w*0.4),int(h*0.4),int(w*0.6),int(h*0.6))
    return dict(left=left,right=right,top=top,centre=centre)
s = mk_session(1280, 720)
open_game(s, 'sandbox', bots=2)
s.run("__GAME__.hud.show(true); __GAME__.bots.update = () => {}; __GAME__.player.god=false; __GAME__.state='playing';")
s.run("const p=__GAME__.player; p.armor=0;")
res = {}
for hp in [100, 35, 20, 8]:
    s.run(f"const p=__GAME__.player; p.health={hp};")
    s.wait(1.3)
    fn = f'x12_hp{hp}.png'; s.shot(fn); res[hp] = edge_red(fn); print(hp, res[hp])
# death overlay with HUD
s.run("const g=__GAME__, p=g.player; const b=g.bots.list[0]; g.combat.kill(p,{attacker:b,weapon:'rifle',headshot:false,point:p.position.clone(),direction:p.position.clone().sub(b.position).normalize()});")
s.wait(1.4); s.shot('x12_death.png')
s.close()
