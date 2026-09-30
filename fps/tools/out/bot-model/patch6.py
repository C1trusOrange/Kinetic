p = 'src/ai/BotModel.js'
s = open(p, encoding='utf-8', newline='').read().replace('\r\n', '\n')
def rep(a, b):
    global s
    assert a in s, a
    s = s.replace(a, b)
rep("""    g.prism(-0.19, 0.0, 0.03, 0.036, 0.10, 6, D, A, 'y');
    geos.pelvis = g.build();""", """    g.prism(-0.19, 0.0, 0.03, 0.036, 0.10, 6, D, A, 'y');
    // flexible spine column (fills the waist gap while the torso twists / pitches)
    g.loft([oct(0.04, 0.095, 0.072, 0.03), oct(0.115, 0.105, 0.078, 0.032), oct(0.185, 0.095, 0.072, 0.03)], (s, i) => (i & 1 ? E : D), { top: D });
    geos.pelvis = g.build();""")
open(p, 'w', encoding='utf-8', newline='\n').write(s)
print('ok')
