import re,sys,json
for m in ['foundry','ruins','sandbox']:
    try:
        t=open('logs/pads2_%s.log'%m,encoding='utf8').read()
    except Exception as e:
        print(m,'ERR',e); continue
    print('===',m, len(t))
    i=t.find('[result]')
    if i<0:
        print(t[:1500]); continue
    s=t[i+8:]
    dec=json.JSONDecoder()
    try:
        d,_=dec.raw_decode(s.strip())
    except Exception as e:
        print('parse err',e); print(s[:800]); continue
    cu=d.get('custom',{})
    for p in cu.get('pads',[]): print(json.dumps(p))
    print('finished',cu.get('finished'),'errors',d.get('errors'))
