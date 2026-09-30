p = 'src/world/Pickups.js'
s = open(p, encoding='utf-8').read()
s = s.replace("    const special = m.transparent || m.map || m.emissiveMap || (m.emissive && m.emissive.getHex() !== 0 && (m.emissiveIntensity ?? 1) > 0.25);",
              "    const special = m.transparent || m.emissiveMap || (m.emissive && m.emissive.getHex() !== 0 && (m.emissiveIntensity ?? 1) > 0.25);")
s = s.replace("      const c = m.color || _c.set(0x888888);\n", "      const c = surfaceColor(m);\n")
s = s.replace("/**\n * Bake a weapon model into a handful of meshes", """const _avgCache = new Map();
const _mc = new THREE.Color();
/** Approximate flat colour of a material: its colour times the average of its map (when it is a canvas / image). */
function surfaceColor(m) {
  _mc.copy(m.color || _c.set(0x888888));
  const t = m.map;
  if (t && t.image) {
    let avg = _avgCache.get(t.uuid);
    if (!avg) {
      avg = new THREE.Color(1, 1, 1);
      try {
        const cv = document.createElement('canvas');
        cv.width = cv.height = 1;
        const ctx = cv.getContext('2d');
        ctx.imageSmoothingEnabled = true;
        ctx.drawImage(t.image, 0, 0, 1, 1);
        const d = ctx.getImageData(0, 0, 1, 1).data;
        avg.setRGB(d[0] / 255, d[1] / 255, d[2] / 255, THREE.SRGBColorSpace);
      } catch (err) { /* tainted or non-drawable image: keep white */ }
      _avgCache.set(t.uuid, avg);
    }
    _mc.multiply(avg);
  }
  return _mc;
}

/**
 * Bake a weapon model into a handful of meshes""", 1)
open(p, 'w', encoding='utf-8').write(s)
print('ok')
