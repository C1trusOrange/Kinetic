p = 'src/world/World.js'
s = open(p, encoding='utf-8').read()
s = s.replace("beamMat: new THREE.MeshBasicMaterial({ color: 0xffffff, vertexColors: true, side: THREE.DoubleSide, ...additive }),", "beamMat: new THREE.MeshBasicMaterial({ color: 0xffffff, vertexColors: true, side: THREE.FrontSide, ...additive }),")
s = s.replace("const beam = new THREE.CylinderGeometry(0.72, 0.95, 3.2, 20, 1, true);", "const beam = new THREE.CylinderGeometry(0.62, 0.9, 3.2, 20, 1, true);")
s = s.replace("M.beam.setColorAt(i, _padColor.setHex(PAD_COLOR).multiplyScalar(0.3 + pad.flash * 0.6));", "M.beam.setColorAt(i, _padColor.setHex(PAD_COLOR).multiplyScalar(0.36 + pad.flash * 0.6));")
open(p, 'w', encoding='utf-8').write(s)
