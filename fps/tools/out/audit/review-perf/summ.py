import json,sys
def load(path):
    s=open(path).read()
    i=s.find('[result]'); j=s.find('[run] done')
    return json.loads(s[i+9:j])
for path in sys.argv[1:]:
    d=load(path)
    if not d or not d.get("custom"):
        print("==",path,"NO DATA"); continue
    c=d['custom']; pr=c['prof']
    print('==',path,'fps',d['fps'],'calls',d['renderer']['calls'],'tris',d['renderer']['triangles'])
    print('  startProgs',c.get('startProgs'),'warmMs',c.get('warmMs'),'warmNew',c.get('warmNewProgs'),'totalProgs',pr['totalNewPrograms'])
    print('  cpu',pr['cpuMs'],'interval',pr['intervalMs'])
    for f in pr['slow']:
        if f['dur']>60 or f['interval']>150 or (f['newProg'] and f['i']>40):
            print('   frame',f['i'],'t',f['t'],'dur',f['dur'],'iv',f['interval'],'newProg',f['newProg'] if not isinstance(f['newProg'],list) else len(f['newProg']),{k:v for k,v in f['gl'].items() if v['ms']>5})
