import re,json,sys
t=open(sys.argv[1],encoding='utf-8',errors='replace').read()
i=t.find('[result]')
j=t.find('\n[run] done')
blob=t[i+len('[result]'):j]
try:
    d=json.loads(blob)
except Exception as e:
    # fallback: find the first balanced object
    dec=json.JSONDecoder()
    d,_=dec.raw_decode(blob.strip())
c=d.get('custom')
if len(sys.argv)>2:
    for k in sys.argv[2:]:
        c=c[k]
if isinstance(c,dict) and 'log' in c:
    for k,v in c['log']: print(k, json.dumps(v))
else:
    print(json.dumps(c,indent=1))
print(t[t.find('[run] done'):][:200])
for m in re.finditer(r'\[(error|warning)\][^\n]*', t): print(m.group(0)[:300])
