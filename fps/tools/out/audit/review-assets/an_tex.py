import json,sys
s=open('tools/out/audit/review-assets/tex.out',encoding='utf8').read()
i=s.index('[result] ')+9
j=s.index('[run] done')
d=json.loads(s[i:j])
print('missing',d['missingNames'],'extra',d['extraNames'],'total ms',d['totalMs'], 'unknown', d['unknown'])
print('%-22s %5s %-9s %s'%('name','ms','surface','worst seam rX/rY per slot'))
for n,m in d['mats'].items():
    seams=[]
    for s_,t in m['tex'].items():
        seams.append('%s:%.1f/%.1f(w%.1f/%.1f)'%(s_[:4],t['rX'],t['rY'],t['wrapX'],t['wrapY']))
    print('%-22s %5d %-9s scale%-4s met%.2f rough%.2f emI%.2f aT%.1f %s'%(n,m['ms'],m['surface'],m['scale'],m['metalness'],m['roughness'],m['emissiveIntensity'],m['alphaTest'],' '.join(seams)))
print()
for n,m in d['mats'].items():
    for s_,t in m['tex'].items():
        exp = 'srgb' if s_ in ('map','emissiveMap') else 'none'
        if t['cs']!=exp: print('COLORSPACE',n,s_,t['cs'])
        if not t['wrap']: print('NOWRAP',n,s_)
        if t['size']!='512x512' and t['size']!='256x256': print('SIZE',n,s_,t['size'])
