p = 'src/ai/BotModel.js'
s = open(p, encoding='utf-8', newline='').read().replace('\r\n', '\n')
def rep(a, b):
    global s
    assert a in s, a
    s = s.replace(a, b)
rep("const w2 = wear * 0.75;\n          r = lerp(C_DARK[0] * shade, C_BARE[0] * 0.55 * bareL, w2);\n          g = lerp(C_DARK[1] * shade, C_BARE[1] * 0.55 * bareL, w2);\n          b = lerp(C_DARK[2] * shade, C_BARE[2] * 0.55 * bareL, w2);",
    "const w2 = wear * 0.5;\n          r = lerp(C_DARK[0] * shade, C_BARE[0] * 0.42 * bareL, w2);\n          g = lerp(C_DARK[1] * shade, C_BARE[1] * 0.42 * bareL, w2);\n          b = lerp(C_DARK[2] * shade, C_BARE[2] * 0.42 * bareL, w2);")
open(p, 'w', encoding='utf-8', newline='\n').write(s)
print('ok')
