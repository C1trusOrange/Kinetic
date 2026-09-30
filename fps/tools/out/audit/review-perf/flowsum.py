import json,sys
sys.path.insert(0,'.')
from parse import load
d,txt=load(sys.argv[1])
print('errors',d['errors'][:3])
for m in d['marks']: print(m)
fr=d['frames']
print('frames',len(fr),'programs',d.get('programs'),'renderer',d.get('renderer'))
print('worldStats',d.get('worldStats'))
st=None
for f in fr:
    if f['dt']>100 or f['np']>0:
        print(f)
