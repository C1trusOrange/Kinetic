import re, sys
for f in ['World', 'MapBuilder', 'Pickups', 'NavGraph', 'Sky']:
    s = open(f'src/world/{f}.js', encoding='utf-8').read()
    names = set(re.findall(r'^(?:const|let|function|class)\s+([A-Za-z_$][\w$]*)', s, re.M))
    names |= set(re.findall(r'^import\s+\{([^}]*)\}', s, re.M) and [n.strip() for grp in re.findall(r'^import\s+\{([^}]*)\}', s, re.M) for n in grp.split(',')])
    for n in sorted(names):
        if not n: continue
        c = len(re.findall(r'\b' + re.escape(n) + r'\b', s))
        if c <= 1:
            print(f, 'unused?', n)
