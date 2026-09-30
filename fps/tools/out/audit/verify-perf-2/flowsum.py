import json,sys
s=open(sys.argv[1]).read()
i=s.find('[result] ')
j=s.rfind('[run] done')
body=s[i+len('[result] '):j].strip()
d=json.loads(body)
if isinstance(d,str): d=json.loads(d)
print('errors',d['errors'][:3],'fix',d.get('fix'),'warmMs',d.get('warmMs'),'warmProgs',d.get('warmProgs'),'programs',d.get('programs'))
for m in d['marks']: print(m)
st=None
fr=d['frames']
first=None
for k,f in enumerate(fr):
    if f['st']=='playing' and first is None: first=k
for k,f in enumerate(fr):
    if f['dt']>100 or f['np']>0:
        print({x:y for x,y in f.items() if x!='names'}, ('NAMES: '+', '.join(f['names'])) if 'names' in f else '')
