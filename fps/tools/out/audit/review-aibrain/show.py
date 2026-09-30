import sys, json, re
txt = open(sys.argv[1]).read()
i = txt.find('[result]')
j = txt.find('\n[run] done', i)
body = txt[i+8:j] if i >= 0 else ''
try:
    d = json.loads(body)
except Exception as e:
    print('parse fail', e); print(txt[-3000:]); sys.exit()
keys = sys.argv[2:] or ['custom']
for k in keys:
    v = d
    for part in k.split('.'):
        v = v.get(part) if isinstance(v, dict) else None
    print('==', k); print(json.dumps(v, indent=None if k!='custom' else 1)[:9000])
print(txt[j:j+400])
