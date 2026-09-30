import json,sys
d=json.load(open(sys.argv[1]))
if 'eval' not in d or not d['eval']:
    print('NO EVAL', d.get('errors')); sys.exit()
for s in d['eval']['snaps']:
    print('==',s['label'],'size',s['size'],'pr',s['pixelRatio'],'liveBots',s['liveBots'])
    print('  mapStats',s['mapStats'])
    print('  world main pass',s['base']['main'],'shadow pass',s['base']['shadow'],'view pass',s['view'],'full composer frame',s['full'],'postCalls',s['postCalls'])
    for r in s['rows']:
        if r['mainCalls'] or r['shadowCalls'] or r['mainTris'] or r['shadowTris']:
            print('   %-22s n=%-3d meshes=%-4d | main %4d calls %7d tris | shadow %4d calls %7d tris' % (r['name'],r['n'],r['sceneMeshes'],r['mainCalls'],r['mainTris'],r['shadowCalls'],r['shadowTris']))
