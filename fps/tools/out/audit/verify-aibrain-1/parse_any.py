import json,sys
def load(fn):
    s=open(fn,encoding='utf-8').read()
    i=s.find('[result]')
    j=s[i+9:]
    return s[:i], json.loads(j[:j.rfind('}')+1])
for fn in sys.argv[1:]:
    head,d=load(fn)
    c=d.get('custom',{})
    print('==',fn,'errors',d.get('errors'))
    print(json.dumps(c,indent=None)[:6000] if len(json.dumps(c))<6000 else json.dumps(c)[:6000])
