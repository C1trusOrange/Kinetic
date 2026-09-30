import sys, json, time
from common import *
import pngtool
def mk_session(W, H):
    for a in range(6):
        try: return Session(W, H)
        except Exception as e: print('[retry session]', e); time.sleep(5)
    raise SystemExit('no chrome')
def diffstats(a, b):
    w,h,bpp,ra = pngtool.read_png(a); _,_,_,rb = pngtool.read_png(b)
    n=0; ch=0; big=0; sd=0
    for y in range(0,h,2):
        la=ra[y]; lb=rb[y]
        for x in range(0,w,2):
            i=x*bpp
            ya=0.2126*la[i]+0.7152*la[i+1]+0.0722*la[i+2]; yb=0.2126*lb[i]+0.7152*lb[i+1]+0.0722*lb[i+2]
            d=ya-yb; n+=1
            if abs(d)>8: ch+=1
            if abs(d)>40: big+=1
            sd+=d
    return dict(changed8=round(100*ch/n,1), changed40=round(100*big/n,1), meanDelta=round(sd/n,1))
