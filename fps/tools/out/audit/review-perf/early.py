import json,glob,sys,os
pat=sys.argv[1]
for fn in sorted(glob.glob(pat)):
    s=open(fn).read()
    i=s.find('[result]'); j=s.find('[run] done')
    try:
        d=json.loads(s[i+9:j]); pr=d['custom']['prof']
    except Exception as e:
        print(os.path.basename(fn),'ERR'); continue
    early=[(f['i'],f['t'],f['dur'],f['interval']) for f in pr['slow'] if f['t']<0.6 and f['interval']>150]
    print(os.path.basename(fn), 'max interval',pr['intervalMs']['max'],'early stalls',early)
