import sys,json,re
for f in sys.argv[1:]:
    s=open(f).read()
    i=s.find('[result] ')
    j=s.rfind('[run] done')
    try:
        d=json.loads(s[i+9:j].strip())
    except Exception as e:
        print(f,'parse fail',e); continue
    c=d.get('custom',{})
    n=c.get('notes',{})
    print(f, 'fps', d['fps'], 'errs', len(d['errors']))
    print('  notes', {k:v for k,v in n.items() if k not in ('classBefore','classAfter','classEnd')})
    print('  class before/after/end', n.get('classBefore'), n.get('classAfter'), n.get('classEnd'))
    print('  first3', c.get('first5',[])[:3])
    print('  later', [(x['gt'],x['dt'],x['np'],x['ren']) for x in c.get('later',[])])
