p = 'src/ai/BotModel.js'
s = open(p, encoding='utf-8', newline='').read().replace('\r\n', '\n')
def rep(a, b):
    global s
    assert a in s, a
    s = s.replace(a, b)
rep("g.loft([oct(0, 0.014, 0.095, 0.006, 0.03), oct(0.036, 0.009, 0.06, 0.005, 0.05)]", "g.loft([oct(0, 0.014, 0.095, 0.006, 0.03), oct(0.03, 0.009, 0.06, 0.005, 0.05)]")
rep("g.box(0, 0.04, 0, 0.012, 0.08, 0.012, D);\n    g.box(0, 0.09, 0, 0.022, 0.022, 0.022, 'glow');", "g.box(0, 0.035, 0, 0.012, 0.07, 0.012, D);\n    g.box(0, 0.08, 0, 0.022, 0.022, 0.022, 'glow');")
open(p, 'w', encoding='utf-8', newline='\n').write(s)
print('ok')
