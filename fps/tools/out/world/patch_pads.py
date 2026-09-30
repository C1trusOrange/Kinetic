p = 'src/world/World.js'
s = open(p, encoding='utf-8').read()

# 1. pad assets: merged base geometry + shared materials
a = s.index("let PAD_ASSETS = null;")
b = s.index("/** Ballistic launch velocity")
new_assets = '''let PAD_ASSETS = null;
function padAssets() {
  if (PAD_ASSETS) return PAD_ASSETS;
  const chev = new THREE.Shape();
  chev.moveTo(0, 0.42);
  chev.lineTo(0.55, -0.02);
  chev.lineTo(0.55, -0.24);
  chev.lineTo(0, 0.2);
  chev.lineTo(-0.55, -0.24);
  chev.lineTo(-0.55, -0.02);
  chev.closePath();
  const chevron = new THREE.ShapeGeometry(chev);
  chevron.rotateX(-HALF_PI);
  const beam = new THREE.CylinderGeometry(0.72, 0.95, 3.2, 20, 1, true);
  beam.translate(0, 1.6, 0);
  const pos = beam.attributes.position;
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const k = Math.pow(Math.max(0, 1 - pos.getY(i) / 3.2), 1.8);
    col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = k;
  }
  beam.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const tint = (geo, hex) => {
    const c = new THREE.Color(hex);
    const arr = new Float32Array(geo.attributes.position.count * 3);
    for (let i = 0; i < arr.length; i += 3) { arr[i] = c.r; arr[i + 1] = c.g; arr[i + 2] = c.b; }
    geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    return geo;
  };
  const base = tint(new THREE.CylinderGeometry(1.25, 1.35, 0.14, 28).translate(0, 0.07, 0), 0x1b222b);
  const top = tint(new THREE.CylinderGeometry(1.05, 1.1, 0.04, 28).translate(0, 0.15, 0), 0x0d1a1a);
  const additive = { transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false };
  PAD_ASSETS = {
    base: mergeGeometries([base, top], false),
    ring: new THREE.TorusGeometry(1.0, 0.055, 6, 40).rotateX(HALF_PI).translate(0, 0.19, 0),
    disc: new THREE.CircleGeometry(0.98, 28).rotateX(-HALF_PI).translate(0, 0.175, 0),
    chevron,
    beam,
    baseMat: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, metalness: 0.8 }),
    ringMat: new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }),
    discMat: new THREE.MeshBasicMaterial({ color: 0xffffff, ...additive }),
    chevMat: new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide, ...additive }),
    beamMat: new THREE.MeshBasicMaterial({ color: 0xffffff, vertexColors: true, side: THREE.DoubleSide, ...additive }),
  };
  return PAD_ASSETS;
}

'''
s = s[:a] + new_assets + s[b:]
s = s.replace("import { Capsule } from 'three/addons/math/Capsule.js';", "import { Capsule } from 'three/addons/math/Capsule.js';\nimport { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';")

# 2. build pads
a = s.index("  _buildJumpPads(def, warn) {")
b = s.index("  /** Warn when the pad's arc runs into geometry")
new_build = '''  _buildJumpPads(def, warn) {
    this.jumpPads = [];
    this._padCool = new WeakMap();
    this._padMeshes = null;
    const list = Array.isArray(def.jumpPads) ? def.jumpPads : [];
    list.forEach((jp, i) => {
      if (!jp || !Array.isArray(jp.pos) || jp.pos.some(v => !Number.isFinite(v))) { warn(`jumpPad #${i}: 'pos' must be [x,y,z]`); return; }
      const pos = new THREE.Vector3(jp.pos[0], jp.pos[1], jp.pos[2]);
      const fy = this._floorY(pos.x, pos.y, pos.z);
      if (fy === null) warn(`jumpPad #${i} at [${jp.pos}] has no floor below it`);
      else pos.y = fy;
      const velocity = new THREE.Vector3();
      let target = null;
      if (Array.isArray(jp.target)) {
        target = new THREE.Vector3(jp.target[0], jp.target[1], jp.target[2]);
        ballisticVelocity(pos, target, jp.apex ?? 3, velocity);
        if (this._floorY(target.x, target.y, target.z) === null) warn(`jumpPad #${i}: target [${jp.target}] has no floor below it`);
        this._checkArc(i, pos, target, velocity, warn);
      } else if (Array.isArray(jp.velocity)) {
        velocity.set(jp.velocity[0], jp.velocity[1], jp.velocity[2]);
        // estimate where it lands (level ground assumption) for nav links
        const tLand = (velocity.y + Math.sqrt(velocity.y * velocity.y)) / GRAVITY;
        target = new THREE.Vector3(pos.x + velocity.x * tLand, pos.y, pos.z + velocity.z * tLand);
      } else {
        warn(`jumpPad #${i}: needs 'target' [x,y,z] (+ optional 'apex') or 'velocity' [x,y,z]`);
        return;
      }
      this.jumpPads.push({ position: pos, radius: PAD_RADIUS, velocity, target, flash: 0 });
    });
    if (!this.jumpPads.length) { this._padGroup = null; return; }
    this._buildPadVisuals();
  }

'''
s = s[:a] + new_build + s[b:]

# 3. visuals + update
a = s.index("  _buildPadVisual(pad, A, parent) {")
b = s.index("  // ==================================================================== validation")
new_vis = '''  /** All jump pads share five InstancedMeshes (base, ring, glow disc, chevrons, beam). */
  _buildPadVisuals() {
    const A = padAssets();
    const pads = this.jumpPads, n = pads.length;
    const group = (this._padGroup = new THREE.Group());
    group.name = 'jump-pads';
    const base = new THREE.InstancedMesh(A.base, A.baseMat, n);
    const ring = new THREE.InstancedMesh(A.ring, A.ringMat, n);
    const disc = new THREE.InstancedMesh(A.disc, A.discMat, n);
    const beam = new THREE.InstancedMesh(A.beam, A.beamMat, n);
    const chev = new THREE.InstancedMesh(A.chevron, A.chevMat, n * 3);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), one = new THREE.Vector3(1, 1, 1), yAxis = new THREE.Vector3(0, 1, 0);
    const p = new THREE.Vector3(), sc = new THREE.Vector3();
    pads.forEach((pad, i) => {
      m.compose(pad.position, q.identity(), one);
      base.setMatrixAt(i, m); ring.setMatrixAt(i, m); disc.setMatrixAt(i, m); beam.setMatrixAt(i, m);
      _dirv.set(pad.velocity.x, 0, pad.velocity.z);
      const yaw = _dirv.lengthSq() > 1e-4 ? yawFromDirection(_dirv.x, _dirv.z) : 0;
      q.setFromAxisAngle(yAxis, yaw);
      for (let k = 0; k < 3; k++) {
        // chevrons line up along the launch direction (local -Z after the yaw)
        p.set(0, 0.2, 0.55 - k * 0.55).applyQuaternion(q).add(pad.position);
        chev.setMatrixAt(i * 3 + k, m.compose(p, q, sc.setScalar(0.62)));
      }
      for (const im of [ring, disc, beam]) im.setColorAt(i, _padColor.setHex(PAD_COLOR));
      for (let k = 0; k < 3; k++) chev.setColorAt(i * 3 + k, _padColor.setHex(PAD_COLOR));
    });
    for (const im of [base, ring, disc, beam, chev]) { im.frustumCulled = false; im.castShadow = false; im.receiveShadow = false; group.add(im); }
    base.receiveShadow = true;
    beam.renderOrder = 5;
    this._padMeshes = { base, ring, disc, beam, chev };
    this._updatePadVisuals();
  }

  _updatePadVisuals() {
    const M = this._padMeshes;
    if (!M) return;
    const t = this._time;
    const pads = this.jumpPads;
    for (let i = 0; i < pads.length; i++) {
      const pad = pads[i];
      const boost = 1 + pad.flash * 2.5;
      M.ring.setColorAt(i, _padColor.setHex(PAD_COLOR).multiplyScalar((1.9 + 0.5 * Math.sin(t * 4)) * boost));
      M.disc.setColorAt(i, _padColor.setHex(PAD_COLOR).multiplyScalar(0.16 + 0.08 * Math.sin(t * 3) + pad.flash * 0.35));
      M.beam.setColorAt(i, _padColor.setHex(PAD_COLOR).multiplyScalar(0.3 + pad.flash * 0.6));
      for (let k = 0; k < 3; k++) {
        const ph = (t * 1.9 - k * 0.33) % 1;
        const a = Math.max(0.08, Math.pow(1 - Math.abs((ph < 0 ? ph + 1 : ph) * 2 - 1), 1.5)) * (0.7 + pad.flash);
        M.chev.setColorAt(i * 3 + k, _padColor.setHex(PAD_COLOR).multiplyScalar(2.2 * a));
      }
    }
    M.ring.instanceColor.needsUpdate = true;
    M.disc.instanceColor.needsUpdate = true;
    M.beam.instanceColor.needsUpdate = true;
    M.chev.instanceColor.needsUpdate = true;
  }

  _updatePads(dt) {
    const pads = this.jumpPads;
    if (!pads.length) return;
    const game = this.game;
    const ents = game.entities || [];
    for (const pad of pads) {
      pad.flash = Math.max(0, pad.flash - dt * 2.5);
      for (let i = 0; i < ents.length; i++) {
        const e = ents[i];
        if (!e.alive) continue;
        const dx = e.position.x - pad.position.x, dz = e.position.z - pad.position.z;
        if (dx * dx + dz * dz > pad.radius * pad.radius) continue;
        if (Math.abs(e.position.y - pad.position.y) > PAD_VERTICAL) continue;
        const last = this._padCool.get(e);
        if (last !== undefined && game.time - last < PAD_COOLDOWN && game.time >= last) continue;
        if (game.time - (e.lastLaunchTime ?? -999) < PAD_COOLDOWN && game.time >= (e.lastLaunchTime ?? -999)) continue;
        this._padCool.set(e, game.time);
        e.launch(_launch.copy(pad.velocity));
        pad.flash = 1;
        if (game.audio && game.audio.play) game.audio.play('jumppad', { position: pad.position });
      }
    }
    this._updatePadVisuals();
  }

'''
s = s[:a] + new_vis + s[b:]
s = s.replace("const _dirv = new THREE.Vector3();", "const _dirv = new THREE.Vector3();\nconst _padColor = new THREE.Color();")
s = s.replace("    this._padGroup = null;\n    this._solidsGroup = null;", "    this._padGroup = null;\n    this._padMeshes = null;\n    this._solidsGroup = null;")

# unload
a = s.index("    if (this._padGroup) {\n      for (const p of this.jumpPads) {")
b = s.index("    if (this.group) {\n      scene.remove(this.group);")
s = s[:a] + '''    if (this._padMeshes) {
      for (const im of Object.values(this._padMeshes)) im.dispose();
      this._padMeshes = null;
    }
    this._padGroup = null;
''' + s[b:]
open(p, 'w', encoding='utf-8').write(s)
print('patched')
