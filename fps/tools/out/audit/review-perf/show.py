import json,sys,re
txt=open(sys.argv[1],encoding='utf8').read()
i=txt.index('[result] ')
j=txt.index('\n[run] done')
data=json.loads(txt[i+9:j])
c=data.get('custom',{})
print('fps',data['fps'],'renderer',data['renderer'])
print('marks',c.get('marks'))
for k,v in c.items():
    if k in ('marks','hitches'): continue
    print(k, json.dumps(v)[:1500])
print('hitches (playing only):')
for h in c.get('hitches',[]):
    if h['st']=='playing': print(h)
print('n hitches total',len(c.get('hitches',[])))
