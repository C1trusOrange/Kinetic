p = 'tools/out/world/harness.js'
s = open(p, encoding='utf-8').read()
s = s.replace("kids: p.holder.children.length,", "kids: p.holder.children.length, kidInfo: p.holder.children.map(c => [c.geometry.attributes.position.count, c.material.type, c.material.color && c.material.color.getHexString(), !!c.geometry.attributes.color]),")
open(p, 'w', encoding='utf-8').write(s)
