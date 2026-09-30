import json,sys,collections
def load(fn):
    s=open(fn,encoding='utf-8').read()
    i=s.find('[result]')
    j=s[i+9:]
    return s[:i], json.loads(j[:j.rfind('}')+1])
for fn in sys.argv[1:]:
    head,d=load(fn)
    c=d.get('custom',{})
    print('==',fn, d.get('map'), 'errors',len(d.get('errors',[])))
    if c.get('error'): print(c['error'])
    print('summary',c.get('summary'))
    print('-- ignore events (long blacklists):')
    for x in c.get('ign',[]): print('  ',x)
    print('-- rescue:')
    for x in c.get('rescue',[]): print('  ',x)
    print('-- launches by bot', collections.Counter(x['bot'] for x in c.get('launches',[])))
    print('-- stuck clusters (rounded pos):')
    cl=collections.Counter()
    for x in c.get('stuck',[]):
        p=x['pos']; cl[(round(p[0]),round(p[1]),round(p[2]))]+=1
    for k,v in cl.most_common(12): print('  ',k,v)
