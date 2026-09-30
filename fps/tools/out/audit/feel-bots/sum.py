import json,sys,re
def load(name):
    s=open(f'r_{name}.txt',encoding='utf-8',errors='replace').read()
    i=s.index('[result]')
    j=s.index('{',i)
    dec=json.JSONDecoder()
    obj,_=dec.raw_decode(s[j:])
    return obj
def show(name, keys=None, drop=('timeline','per','navY','navStats')):
    o=load(name)
    c=o['custom']
    print('=====',name,'fps',o['fps'],'errors',len(o['errors']))
    for k,v in c.items():
        if k in drop: continue
        if keys and k not in keys: continue
        print(k,':',json.dumps(v,separators=(',',':')))
    return o
if __name__=='__main__':
    name=sys.argv[1]
    keys=sys.argv[2].split(',') if len(sys.argv)>2 else None
    show(name,keys)
