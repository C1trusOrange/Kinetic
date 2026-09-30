p = 'src/ai/BotModel.js'
s = open(p, encoding='utf-8', newline='').read().replace('\r\n', '\n')
def rep(a, b):
    global s
    assert a in s, a
    s = s.replace(a, b)

rep("const C_PAINT = [0.60, 0.63, 0.68];", "const C_PAINT = [0.68, 0.71, 0.76];")
rep("const num = number != null ? number : 1 + (((hex * 2654435761) >>> 0) % 98);", "const num = number != null ? number : 1 + ((Math.imul(hex, 2654435761) >>> 0) % 98);")

# gib geometry cache
rep("""// ====================================================================== BotModel
""", """// centred copies of the bone geometries for death gibs (so they tumble about their own centre)
const _gibGeos = new Map();
function gibGeometry(src) {
  let e = _gibGeos.get(src);
  if (!e) {
    if (!src.boundingBox) src.computeBoundingBox();
    const center = src.boundingBox.getCenter(new THREE.Vector3());
    const geo = src.clone().translate(-center.x, -center.y, -center.z);
    geo.computeBoundingSphere();
    e = { geo, center };
    _gibGeos.set(src, e);
  }
  return e;
}

// ====================================================================== BotModel
""")
rep("""    const clone = src => {
      const c = new THREE.Mesh(src.geometry, this._set.mat);
      src.matrixWorld.decompose(c.position, c.quaternion, c.scale);
      c.castShadow = true;""", """    const clone = src => {
      const e = gibGeometry(src.geometry);
      const c = new THREE.Mesh(e.geo, this._set.mat);
      src.matrixWorld.decompose(c.position, c.quaternion, c.scale);
      c.position.copy(e.center).applyMatrix4(src.matrixWorld);
      c.castShadow = true;""")
rep("""   * World-transformed clones of the body pieces for death gibs (not parented; share geometry + material).
   * Head, torso, pelvis, 4 arm pieces, 4 leg pieces and the biggest weapon part.""", """   * World-transformed meshes for the body pieces (death gibs; not parented). Material is the shared bot material;
   * geometry is a shared, centre-pivoted copy of the bone geometry (cached, never disposed), so gibs tumble about their
   * own centre. Head, torso, pelvis, 4 arm pieces, 4 leg pieces and the biggest weapon part.""")

# reload loop
rep("const reloadTau = clamp(this._reloadT / 1.3, 0, 1);", "const reloadTau = (this._reloadT % 1.15) / 1.15;")

# torso breathing without scale
rep("    this.torso.scale.set(1, 1 + 0.008 * breath * (1 - gait), 1 + 0.006 * breath * (1 - gait));", "    this.torso.position.y = WAIST_DY + 0.004 * breath * (1 - gait);")
open(p, 'w', encoding='utf-8', newline='\n').write(s)
print('ok')
