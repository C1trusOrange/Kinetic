import sys, math, glob
import pngtool
def stats(path, region=None, step=3):
    w,h,bpp,rows = pngtool.read_png(path)
    x0,y0,x1,y1 = region or (0,0,w,h)
    n=0; s=0; s2=0; clip=0; dark=0; sat=0
    hist=[0]*8
    for y in range(y0,y1,step):
        line=rows[y]
        for x in range(x0,x1,step):
            i=x*bpp; r,g,b=line[i],line[i+1],line[i+2]
            l=0.2126*r+0.7152*g+0.0722*b
            s+=l; s2+=l*l; n+=1
            if l>245: clip+=1
            if l<20: dark+=1
            mx=max(r,g,b); mn=min(r,g,b)
            sat += (mx-mn)/mx if mx>0 else 0
            hist[min(7,int(l/32))]+=1
    m=s/n; sd=math.sqrt(max(0,s2/n-m*m))
    return dict(mean=round(m,1), sd=round(sd,1), dark=round(100*dark/n,1), clip=round(100*clip/n,1), sat=round(100*sat/n,1), hist=[round(100*v/n) for v in hist])
if __name__=='__main__':
    for p in sys.argv[1:]:
        print(p.split('/')[-1], stats(p))
