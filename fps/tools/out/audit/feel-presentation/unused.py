import re, json, glob, os
names = list(json.load(open('tools/out/audit/feel-presentation/audio_stats.json')).keys())
src = ''
for f in glob.glob('src/**/*.js', recursive=True):
    if os.path.basename(f) == 'Audio.js': continue
    src += open(f, encoding='utf8').read()
un = []
for n in names:
    if re.search(r"['\"`]" + re.escape(n) + r"['\"`]", src): continue
    if n.startswith('impact_') and "'impact_'" in src: continue
    un.append(n)
print('never referenced:', un)
