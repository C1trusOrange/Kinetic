import json,sys
s=open(sys.argv[1]).read()
i=s.find('[result] {')+len('[result] ')
j=s.rfind('\n}')
d=json.loads(s[i:j+2])
c=d['custom']
print('fps',d['fps'])
for k in c:
    if k in ('big','first','quality'): continue
    print(k, json.dumps(c[k])[:600])
print('big', [(x['f'],x['dt'],x['u'],x['r'],x['st'],x['np']) for x in c.get('big',[])])
