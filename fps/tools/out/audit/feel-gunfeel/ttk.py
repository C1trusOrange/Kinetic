import math
W = {
 'pistol': dict(d=30,hm=2.0,p=1,rate=5.2,mag=12,rel=1.3,fo=(22,65,0.6),auto=False),
 'rifle':  dict(d=16,hm=2.0,p=1,rate=11,mag=32,rel=1.9,fo=(20,60,0.55),auto=True),
 'shotgun':dict(d=11,hm=1.5,p=9,rate=1.15,mag=6,rel=3.4,fo=(5,22,0.12),auto=False),
 'sniper': dict(d=100,hm=2.5,p=1,rate=0.95,mag=5,rel=2.8,fo=None,auto=False),
}
def fall(w,dist):
    f=w['fo']
    if not f or dist<=f[0]: return 1.0
    k=min(1,(dist-f[0])/(f[1]-f[0]))
    return 1-(1-f[2])*k
def shots_to_kill(dmg_per_hit, hp=100, armor=0):
    # emulate takeDamage: armor absorbs 60% until depleted
    n=0
    while hp>0 and n<200:
        n+=1
        a=min(armor, dmg_per_hit*0.6)
        armor-=a
        hp-=min(hp, dmg_per_hit-a)
    return n
def ttk(w, dist, part, armor, dmgmult=1.0):
    d=w['d']*fall(w,dist)*(w['hm'] if part=='head' else (0.8 if part=='legs' else 1))
    per_shot = d*w['p']*dmgmult  # if all pellets hit
    n=shots_to_kill(per_shot,armor=armor)
    # bolt/pump: fire interval = 1/rate; (n-1) intervals
    return n,(n-1)/w['rate'], per_shot
print("weapon dist part armor -> shots, TTK(s), dmg/shot")
for wid,w in W.items():
    for dist in (5,10,20,30,45,65,100):
        row=[]
        for part in ('body','head'):
            for armor in (0,50,100):
                n,t,ps=ttk(w,dist,part,armor)
                row.append(f"{part[0]}{armor}:{n}/{t:.2f}")
        print(f"{wid:8s} {dist:4d}m  dmg/hit={w['d']*fall(w,dist):5.1f}  "+"  ".join(row))
    print()
# DPS and sustained (magazine) stats
for wid,w in W.items():
    print(wid,"raw dps",round(w['d']*w['p']*w['rate'],1),"per-mag dmg",w['d']*w['p']*w['mag'],"mag time",round(w['mag']/w['rate'],2),"reload",w['rel'])
