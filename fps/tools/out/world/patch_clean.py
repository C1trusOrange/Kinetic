p = 'src/world/World.js'
s = open(p, encoding='utf-8').read()
s = s.replace("const _v = new THREE.Vector3();\nconst _launch", "const _launch")
open(p, 'w', encoding='utf-8').write(s)
p = 'src/world/NavGraph.js'
s = open(p, encoding='utf-8').read()
s = s.replace("const DROP_MIN = 0.65;      // downward step counted as a drop\n", "")
s = s.replace("const DROP_REACH = 2.55;    // horizontal reach of drop links\n", "")
s = s.replace("const _v = new THREE.Vector3();\n\n", "")
open(p, 'w', encoding='utf-8').write(s)
