import json, sys
t = open(sys.argv[1], encoding='utf-8', errors='replace').read()
if '[result]' not in t:
    print(t[-3000:])
    sys.exit(0)
i = t.index('[result]')
j = t.rindex('[run] done')
print(t[:i][-1500:])
d = json.loads(t[i + 9:j])
keys = sys.argv[2].split(',') if len(sys.argv) > 2 else None
for k, v in d.items():
    if isinstance(v, list):
        print('==', k)
        for r in v:
            if keys and isinstance(r, dict):
                print({kk: r.get(kk) for kk in keys})
            else:
                print(r)
    else:
        print(k, '=', v)
print(t[j:])
