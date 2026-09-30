import json, sys
txt = open(sys.argv[1], encoding='utf-8', errors='replace').read()
i = txt.index('[result] ') + 9
j = txt.rindex('[run] done')
data = json.loads(txt[i:j])
c = data.get('custom', data)
what = sys.argv[2] if len(sys.argv) > 2 else 'summary'
if what == 'summary':
    print('counts', c.get('counts'))
    for k, v in (c.get('samples') or {}).items():
        print(k, json.dumps(v))
    for k in c:
        if k not in ('samples', 'counts', 'ring'):
            print(k, json.dumps(c[k]))
elif what == 'ring':
    name = sys.argv[3]
    for e in c['ring'][name]:
        print(json.dumps(e))
else:
    print(json.dumps(c.get(what), indent=1))
