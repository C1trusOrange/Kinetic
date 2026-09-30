import sys, json, subprocess, re
# usage: rep.py "<url>" [key ...]   -> runs tools/run.py --report and prints selected top-level keys / custom
url = sys.argv[1]
keys = sys.argv[2:] or ['fps', 'errorCount', 'events']
p = subprocess.run(['python', 'tools/run.py', url, '--report'] , capture_output=True, text=True)
out = p.stdout
i = out.find('[result]')
if i < 0:
    print(out[-2000:]); print(p.stderr[-1000:]); sys.exit(1)
body = out[i + 9:]
# cut trailing "[run] done" line
j = body.rfind('\n[run] done')
if j > 0: body = body[:j]
try:
    j = json.loads(body)
except Exception as e:
    print('parse failed', e); print(body[:500]); sys.exit(1)
for k in keys:
    v = j.get(k)
    if isinstance(v, list) and v and isinstance(v[0], str):
        print(k + ':'); print('\n'.join(v))
    elif isinstance(v, dict) and k == 'custom':
        for kk, vv in v.items():
            if isinstance(vv, list) and vv and isinstance(vv[0], str):
                print(kk + ':'); print('\n'.join(vv))
            else:
                print(kk, json.dumps(vv))
    else:
        print(k, json.dumps(v))
tail = out[out.rfind('[run] done'):]
print(tail.strip())
