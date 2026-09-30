import json,sys
fn=sys.argv[1]; key=sys.argv[2] if len(sys.argv)>2 else 'custom'
s=open(fn,encoding='utf8',errors='replace').read()
i=s.find('[result] {')
body=s[i+9:]
j=body.rfind('[run] done')
if j>0: body=body[:j]
d=json.loads(body)
c=d
for k in key.split('.'):
    if k: c=c[k]
print(json.dumps(c,indent=None,separators=(',',':')))
