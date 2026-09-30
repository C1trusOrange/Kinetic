p = 'tools/out/world/harness.js'
s = open(p, encoding='utf-8').read()
s = s.replace("const goals = world.pickups.list.map(p => ({ name: `${p.type}${p.weapon ? ':' + p.weapon : ''}#${p.id}`, pos: p.position }));",
 "const goals = world.pickups.list.length ? world.pickups.list.map(p => ({ name: `${p.type}${p.weapon ? ':' + p.weapon : ''}#${p.id}`, pos: p.position })) : spawns.map((sp, i) => ({ name: 'spawn' + i, pos: sp.position }));")
s = s.replace("    const rn = nav.randomNode();", "    R.navSample = res.failed.slice(0, 3);\n    const rn = nav.randomNode();")
open(p, 'w', encoding='utf-8').write(s)
