import json,sys
txt=open(sys.argv[1]).read()
i=txt.find('[result]'); j=txt.find('\n[run] done', i)
if i<0: print(txt[-2000:]); raise SystemExit
d=json.loads(txt[i+8:j])
c=d['custom']
print('wallMs',c.get('wallMs'),'simTime',c.get('simTime'),'err',c.get('error'))
f=c['fight']
print({k:(v if not isinstance(v,list) else len(v)) for k,v in f.items()})
print('stateTime',f['stateTime'])
print('rescue',f['rescue'])
for k in ('selfDamage','friendlyAttempts','shotsAtProtected','suicides','chaseUnreach','chaseTime','grenadesThrown'): print(k, f.get(k))
print('ignored', json.dumps(f['ignoredSets'])[:1800])
for s in f['idleStuck'][:12]: print('IDLE', s)
for s in f['findPathNull'][:6]: print('NULLPATH', s)
print('clusters:')
for cl in f['stuckClusters']: print(' ', cl['cell'], cl['n'], json.dumps(cl['ex']))
print(c.get('pathStats'))
print(d.get('errors'))
