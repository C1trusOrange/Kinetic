import sys, json
txt = open(sys.argv[1]).read()
i = txt.find('[result]'); j = txt.find('\n[run] done', i)
if i < 0:
    print(txt[-2500:]); sys.exit()
d = json.loads(txt[i+8:j])
keys = sys.argv[2:] or ['custom']
for k in keys:
    v = d
    for part in k.split('.'):
        v = v.get(part) if isinstance(v, dict) else None
    print('==', k); print(json.dumps(v, indent=1)[:12000])
print(txt[j:j+300])
print('errors:', d.get('errors'))
