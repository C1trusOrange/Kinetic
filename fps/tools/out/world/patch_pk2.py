p = 'src/world/Pickups.js'
s = open(p, encoding='utf-8').read()

# shared class materials in assets()
s = s.replace("  M.placeholder = mat(0x8899aa, { roughness: 0.4, metalness: 0.6 });",
"""  M.placeholder = mat(0x8899aa, { roughness: 0.4, metalness: 0.6 });
  // weapon pads: parts are baked into vertex-coloured 'metal' and 'paint' meshes (+ the original glowing parts)
  M.wMetal = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.38, metalness: 0.85 });
  M.wPaint = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.15 });""")

bake = '''
/**
 * Bake a weapon model into a handful of meshes: every plain opaque part goes into a vertex-coloured
 * 'metal' or 'paint' mesh (chosen by the part's metalness); emissive / transparent / textured parts keep
 * their original (shared, never disposed) material and merge per signature. Returns [{geometry, material}].
 */
function bakeWeaponProp(root) {
  const A = assets();
  root.updateMatrixWorld(true);
  const groups = new Map();
  let ok = true;
  root.traverse(o => {
    if (!o.isMesh || !ok || !o.visible) return;
    if (o.isSkinnedMesh || o.isInstancedMesh || Array.isArray(o.material) || !o.geometry || !o.geometry.attributes.position) { ok = false; return; }
    const m = o.material;
    const g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
    g.applyMatrix4(o.matrixWorld);
    if (!g.attributes.normal) g.computeVertexNormals();
    g.clearGroups();
    const special = m.transparent || m.map || m.emissiveMap || (m.emissive && m.emissive.getHex() !== 0 && (m.emissiveIntensity ?? 1) > 0.25);
    let key, material, attrs;
    if (special) {
      key = materialKey(m);
      material = m;
      attrs = ['position', 'normal', 'uv'];
      if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    } else {
      key = m.metalness >= 0.5 ? 'metal' : 'paint';
      material = key === 'metal' ? A.mat.wMetal : A.mat.wPaint;
      attrs = ['position', 'normal', 'color'];
      const c = m.color || _c.set(0x888888);
      const n = g.attributes.position.count;
      const arr = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
      g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    }
    for (const name of Object.keys(g.attributes)) if (!attrs.includes(name)) g.deleteAttribute(name);
    let entry = groups.get(key);
    if (!entry) { entry = { material, list: [] }; groups.set(key, entry); }
    entry.list.push(g);
  });
  const disposeAll = () => { for (const e of groups.values()) e.list.forEach(g => g.dispose()); };
  if (!ok) { disposeAll(); return null; }
  const out = [];
  for (const { material, list } of groups.values()) {
    const merged = list.length === 1 ? list[0] : mergeGeometries(list, false);
    if (!merged) { disposeAll(); return null; }
    if (list.length > 1) list.forEach(g => g.dispose());
    out.push({ geometry: merged, material });
  }
  return out;
}
'''
marker = "/** Merged, cached parts for a prop kind"
s = s.replace(marker, bake + "\n" + marker, 1)
s = s.replace("    const parts = bakeMerged(scaler);\n    if (parts && parts.length) {", "    const parts = model && model.root ? bakeWeaponProp(scaler) : bakeMerged(scaler);\n    if (parts && parts.length) {")
open(p, 'w', encoding='utf-8').write(s)
print('ok')
