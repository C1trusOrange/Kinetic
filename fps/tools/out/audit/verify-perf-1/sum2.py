
import sys,json
for f in sys.argv[1:]:
    s=open(f).read()
    i=s.find('[result] '); j=s.rfind('[run] done')
    try: d=json.loads(s[i+9:j].strip())
    except Exception as e: print(f,'parse fail'); continue
    c=d['custom']
    print(f, 'fps', d['fps'], 'errs', len(d['errors']), 'endProgs', c.get('endProgs'), 'stalls>120', c.get('stallsOver120'), 'sumMs', c.get('stallSumMs'), 'first', c.get('first'))
    for e in c.get('events',[]): print('   ', e)
