import json, subprocess, sys, urllib.parse
ov = sys.argv[1]; name = sys.argv[2]
q = urllib.parse.quote(ov)
url = f"index.html?autotest=1&map=sandbox&bots=0&god=1&script=idle&scenario=tools/out/audit/feel-gunfeel/mc2.js&duration=1&ov={q}"
out = subprocess.run([sys.executable, 'tools/out/audit/feel-gunfeel/run2.py', url, '--report', '--timeout', '200'], capture_output=True, text=True, encoding='utf8').stdout
i = out.index('[result] ') + 9; j = out.index('[run] done')
c = json.loads(out[i:j])['custom']
json.dump(c, open(f'tools/out/audit/feel-gunfeel/{name}.json', 'w'), indent=1)
print("PER PULL expected dmg / pellet hit% (chest aim)")
for w, st in c['perPull'].items():
    for s, ds in st.items():
        print(f"{w:8s} {s:5s} " + "  ".join(f"{d}m:{v['expDmg']}/{v['hitPct']}%" for d, v in ds.items()), " ang", list(ds.values())[0]['ang'])
print("TTK chest, stationary target, perfect recoil control: killPct/median/p90 (armor0 | armor50 median)")
for w, st in c['ttkChest'].items():
    for s, ds in st.items():
        print(f"{w:8s} {s:4s} " + "  ".join(f"{d}m:[{v['a0']['killPct']}%,{v['a0']['medTTK']},{v['a0']['p90TTK']}|{v['a50']['medTTK']}]" for d, v in ds.items()))
