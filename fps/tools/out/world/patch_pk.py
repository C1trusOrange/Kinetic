p = 'src/world/Pickups.js'
s = open(p, encoding='utf-8').read()
s = s.replace("const WEAPON_LENGTH = { pistol: 0.5, rifle: 0.95, shotgun: 1.0, sniper: 1.15, rocket: 1.05 };",
              "const WEAPON_LENGTH = { pistol: 0.62, rifle: 1.15, shotgun: 1.2, sniper: 1.4, rocket: 1.3 };")
s = s.replace("const WEAPON_FLOAT_Y = 1.1;", "const WEAPON_FLOAT_Y = 1.2;")
# beam: front side only, dimmer, faster fade
s = s.replace("const k = Math.pow(Math.max(0, 1 - t), 1.7);", "const k = Math.pow(Math.max(0, 1 - t), 2.1);")
s = s.replace("""    color: 0xffffff, vertexColors: true, transparent: true, opacity: 0.32, blending: THREE.AdditiveBlending,
    depthWrite: false, side: THREE.DoubleSide,""", """    color: 0xffffff, vertexColors: true, transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending,
    depthWrite: false, side: THREE.FrontSide,""")
# material signature merging
s = s.replace("""    let list = groups.get(o.material);
    if (!list) { list = []; groups.set(o.material, list); }
    list.push(g);""", """    const key = materialKey(o.material);
    let entry = groups.get(key);
    if (!entry) { entry = { material: o.material, list: [] }; groups.set(key, entry); }
    entry.list.push(g);""")
s = s.replace("""  if (!ok) { for (const l of groups.values()) l.forEach(g => g.dispose()); return null; }
  const out = [];
  for (const [material, list] of groups) {""", """  if (!ok) { for (const e of groups.values()) e.list.forEach(g => g.dispose()); return null; }
  const out = [];
  for (const { material, list } of groups.values()) {""")
s = s.replace("    if (!merged) { for (const l of groups.values()) l.forEach(g => g.dispose()); return null; }", "    if (!merged) { for (const e of groups.values()) e.list.forEach(g => g.dispose()); return null; }")
s = s.replace("""/**
 * Bake a static object tree into one merged geometry per material.""", """/** Signature of everything that affects how a material looks, so equal clones merge. */
function materialKey(m) {
  const hex = c => (c && c.isColor ? c.getHex() : '-');
  const id = t => (t ? t.uuid : '-');
  return [m.type, hex(m.color), hex(m.emissive), m.emissiveIntensity, m.roughness, m.metalness, id(m.map), id(m.normalMap),
    id(m.roughnessMap), id(m.metalnessMap), id(m.emissiveMap), m.vertexColors, m.transparent, m.opacity, m.side, m.envMapIntensity].join('|');
}

/**
 * Bake a static object tree into one merged geometry per distinct material.""")
open(p, 'w', encoding='utf-8').write(s)
print('ok')
