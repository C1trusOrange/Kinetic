p = 'src/world/NavGraph.js'
s = open(p, encoding='utf-8').read()
s = s.replace("    this.stats.nodes = N;\n    this.stats.links = linkCount;", "    this.stats.nodes = N;\n    this.stats.cells = nx * nz;\n    this.stats.links = linkCount;")
open(p, 'w', encoding='utf-8').write(s)
p = 'src/world/World.js'
s = open(p, encoding='utf-8').read()
s = s.replace("      const s = nav.stats;\n      if (s.traps", "      const s = nav.stats;\n      if (s.cells > 40000) warn(`navigation grid is ${s.cells} cells (${s.buildMs} ms to build): maps larger than ~150 x 150 m load slowly`);\n      if (s.traps")
open(p, 'w', encoding='utf-8').write(s)
