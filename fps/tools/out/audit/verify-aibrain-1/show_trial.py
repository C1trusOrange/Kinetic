import json,sys
fn=sys.argv[1]; k=int(sys.argv[2]); maxl=int(sys.argv[3]) if len(sys.argv)>3 else 90
s=open(fn,encoding='utf-8').read()
i=s.find('[result]'); j=s[i+9:]
d=json.loads(j[:j.rfind('}')+1])
c=d['custom']
for t in c['trials']:
    if t['k']!=k: continue
    print({x:y for x,y in t.items() if x not in ('trace','reqs','invSites')})
    print('\n'.join(t['trace'][:maxl]))
    for r in t['reqs']: print('REQ',r)
    for r in t['invSites']: print('INV',r)
