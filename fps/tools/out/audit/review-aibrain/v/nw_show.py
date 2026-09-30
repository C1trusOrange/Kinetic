import json,sys
txt=open(sys.argv[1]).read()
i=txt.find('[result]'); j=txt.find('\n[run] done', i)
if i<0: print(txt[-800:]); raise SystemExit
d=json.loads(txt[i+8:j])
c=d['custom']
print('wallMs',c.get('wallMs'),'err',c.get('error'))
n=c.get('navwalk',{})
print({k:v for k,v in n.items() if k not in ('failures','slow')})
for f in n.get('failures',[])[:8]: print(' FAIL',json.dumps(f))
for f in n.get('slow',[])[:5]: print(' SLOW',json.dumps(f))
