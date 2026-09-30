import json,sys
def load(fn):
    s=open(fn,encoding='utf-8').read()
    i=s.find('[result]')
    j=s[i+9:]
    return s[:i], json.loads(j[:j.rfind('}')+1])
for fn in sys.argv[1:]:
    head,d=load(fn)
    c=d.get('custom',{})
    print('==',fn, 'err' if c.get('error') else '')
    if c.get('error'): print(c['error'])
    for s in c.get('summary',[]): print(s)
    tot=[t for t in c.get('trials',[])]
    print('total',len(tot),'ok',sum(1 for t in tot if t['ok']))
    for t in tot:
        print(' pad%d k%d ok=%s t=%s air=%s launched=%s inv=%s nreq=%s'%(t['pad'],t['k'],t['ok'],t['t'],t['air'],t['launched'],t['inv'],t['nreq']))
