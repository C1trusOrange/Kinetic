import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { toColor } from '../core/utils.js';

/**
 * Storm: the weather and set-piece animation of a map (Stratos). Driven by `def.fx`:
 *
 *   fx: {
 *     storm: {
 *       rods: [{ pos: [x, y, z] (floor under the rod), h: rod height above pos, weight, hazard: bool, r: damage radius }],
 *       strikeEvery: [11, 19], sheetEvery: [3, 7], warn: 1.2,          // seconds
 *       damage: 60, knockback: 16,                                     // hazard strikes
 *     },
 *     spinners: [{ pos: [x, y, z], radius, tube, rps, color, intensity, segments }],   // HDR dashed rings turning about Y
 *   }
 *
 * World builds it after the lighting (`world.storm = new Storm(world, def.fx)`), calls `update(dt)` every frame and
 * `dispose()` on unload. It never adds or removes scene lights: flashes multiply the intensities of the map's existing
 * hemisphere / sun / environment / bloom (restored afterwards) and use the pooled effects lights.
 *
 * Two kinds of lightning:
 *  - sheet lightning every few seconds: a glow inside the cloud deck + a faint sky flash (no geometry);
 *  - strikes every ~15 s on a rod: a multi-stroke bolt from the sky, a whole-map flash and delayed thunder. Strikes on
 *    `hazard` rods are telegraphed (pulsing ring on the deck + hum for `warn` seconds) and then deal real damage
 *    (weapon 'lightning', kill feed "Storm Strike").
 * Flash peaks are deliberately small (sky flash <= ~0.4, three strokes per strike) - photosensitivity and glare.
 */

const MAX_LINES = 6;          // polylines per bolt (1 main + forks)
const MAX_PTS = 26;           // points per polyline
const MAX_QUADS = 2 * MAX_LINES * (MAX_PTS - 1);
const STROKES = [[0, 1.0], [0.12, 0.45], [0.22, 0.8]];   // [start s, peak]
const STRIKE_LEN = 0.62;
const SOUND_SPEED = 150;      // m/s used for the thunder delay (dramatic, not physical)

const _v0 = new THREE.Vector3();
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _side = new THREE.Vector3();
const _tip = new THREE.Vector3();
const _base = new THREE.Vector3();
const rr = (a, b) => a + Math.random() * (b - a);

export class Storm {
  /**
   * @param {import('./World.js').World} world
   * @param {object} fx def.fx
   */
  constructor(world, fx = {}) {
    this.world = world;
    this.game = world.game;
    this.group = new THREE.Group();
    this.group.name = 'storm-fx';
    world.group.add(this.group);
    this.time = 0;
    this._disposables = [];
    this.spinners = [];
    this.cfg = null;
    this.rods = [];

    for (const s of fx.spinners || []) this._addSpinner(s);
    if (fx.storm && Array.isArray(fx.storm.rods) && fx.storm.rods.length) this._initStorm(fx.storm);
  }

  // ------------------------------------------------------------------ spinners

  _addSpinner(s) {
    const n = s.segments ?? 20, r = s.radius ?? 8, tube = s.tube ?? 0.16;
    const step = (Math.PI * 2) / n, arc = step * (s.dash ?? 0.62);
    const parts = [];
    for (let i = 0; i < n; i++) {
      const g = new THREE.TorusGeometry(r, tube * (i % 5 === 0 ? 1.5 : 1), 5, 6, arc);
      g.rotateZ(i * step);
      parts.push(g);
    }
    const geo = mergeGeometries(parts, false);
    for (const g of parts) g.dispose();
    geo.rotateX(Math.PI / 2);
    const col = toColor(s.color ?? '#5cf2ff').multiplyScalar(s.intensity ?? 1.6);
    const mat = new THREE.MeshBasicMaterial({ color: col });
    const mesh = new THREE.Mesh(geo, mat);
    const p = s.pos || [0, 0, 0];
    mesh.position.set(p[0], p[1], p[2]);
    mesh.frustumCulled = false;
    this.group.add(mesh);
    this._disposables.push(geo, mat);
    this.spinners.push({ mesh, speed: (s.rps ?? 0.05) * Math.PI * 2 });
  }

  // ------------------------------------------------------------------ storm setup

  _initStorm(st) {
    this.cfg = {
      strikeEvery: st.strikeEvery || [11, 19],
      sheetEvery: st.sheetEvery || [3, 7],
      warn: st.warn ?? 1.2,
      damage: st.damage ?? 60,
      knockback: st.knockback ?? 16,
    };
    this.rods = st.rods.map(r => ({
      base: new THREE.Vector3(r.pos[0], r.pos[1], r.pos[2]),
      tip: new THREE.Vector3(r.pos[0], r.pos[1] + (r.h ?? 26), r.pos[2]),
      weight: r.weight ?? 1, hazard: !!r.hazard, r: r.r ?? 4.2,
    }));
    const add = (obj, ...d) => { this.group.add(obj); this._disposables.push(...d); return obj; };

    // bolt ribbons (camera facing, rebuilt while a strike is active)
    const pos = new Float32Array(MAX_QUADS * 4 * 3), col = new Float32Array(MAX_QUADS * 4 * 3);
    const idx = new Uint16Array(MAX_QUADS * 6);
    for (let q = 0; q < MAX_QUADS; q++) idx.set([q * 4, q * 4 + 1, q * 4 + 2, q * 4 + 2, q * 4 + 1, q * 4 + 3], q * 6);
    const bg = new THREE.BufferGeometry();
    bg.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
    bg.setAttribute('color', new THREE.BufferAttribute(col, 3).setUsage(THREE.DynamicDrawUsage));
    bg.setIndex(new THREE.BufferAttribute(idx, 1));
    bg.setDrawRange(0, 0);
    const bm = new THREE.MeshBasicMaterial({
      vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false,
    });
    this.bolt = add(new THREE.Mesh(bg, bm), bg, bm);
    this.bolt.frustumCulled = false;
    this.bolt.visible = false;
    this.bolt.renderOrder = 6;
    this._bpos = pos; this._bcol = col; this._bgeo = bg; this._bmat = bm;
    this._lines = [];
    for (let i = 0; i < MAX_LINES; i++) this._lines.push({ n: 0, w: 1, pts: new Float32Array(MAX_PTS * 3) });

    // telegraph / shock ring (one pooled mesh) + tip beacon
    const rg = new THREE.RingGeometry(0.9, 1.0, 56);
    rg.rotateX(-Math.PI / 2);
    const dg = new THREE.CircleGeometry(0.9, 40);
    dg.rotateX(-Math.PI / 2);
    const addMat = { transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false };
    const rm = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 0.42, 0.16), ...addMat });
    const dm = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 0.42, 0.16), opacity: 0.1, ...addMat });
    const bmat = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 0.6, 0.3), ...addMat });
    const bgeo = new THREE.IcosahedronGeometry(0.7, 1);
    this.ring = add(new THREE.Mesh(rg, rm), rg, rm);
    this.disc = add(new THREE.Mesh(dg, dm), dg, dm);
    this.beacon = add(new THREE.Mesh(bgeo, bmat), bgeo, bmat);
    for (const m of [this.ring, this.disc, this.beacon]) { m.visible = false; m.frustumCulled = false; m.renderOrder = 5; }
    this._ringMat = rm; this._discMat = dm; this._beaconMat = bmat;

    this._thunder = [];               // pending delayed sounds
    this._bl = [{ x: 0, z: 0, radius: 60, intensity: 0 }];   // reused deck-glow list
    this._strike = null;              // active strike state
    this._sheet = null;               // active sheet lightning
    this._lastRod = -1;
    this._baseLight = null;
    this._scheduleReset();
  }

  _scheduleReset() {
    this._nextStrike = rr(6, 9);
    this._nextSheet = rr(1.5, 3.5);
  }

  /** Same map, new match. */
  reset() {
    if (!this.cfg) return;
    this._endFlash();
    this._strike = null; this._sheet = null; this._thunder.length = 0;
    this.bolt.visible = false; this.ring.visible = false; this.disc.visible = false; this.beacon.visible = false;
    const sky = this.world.sky;
    if (sky) { sky.setFlash(0); sky.setBolts(null); }
    this._scheduleReset();
  }

  // ------------------------------------------------------------------ scheduling

  update(dt) {
    this.time += dt;
    for (const s of this.spinners) s.mesh.rotation.y += s.speed * dt;
    if (!this.cfg) return;

    // delayed thunder
    for (let i = this._thunder.length - 1; i >= 0; i--) {
      const t = this._thunder[i];
      t.delay -= dt;
      if (t.delay <= 0) {
        const a = this.game.audio;
        if (a && a.play) a.play(t.name, { position: t.pos, volume: t.vol });
        this._thunder.splice(i, 1);
      }
    }

    // online clients never pick strikes: the host's 'storm' message starts each one (beginStrike), with its warning
    const net = this.game.net;
    const local = !net || net.authority;
    if (this._strike) this._updateStrike(dt);
    else if (local) {
      this._nextStrike -= dt;
      if (this._nextStrike <= 0) this._beginStrike();
    }
    if (this._sheet) this._updateSheet(dt);
    else {
      this._nextSheet -= dt;
      if (this._nextSheet <= 0 && !this._strike) this._beginSheet();
    }
  }

  _pickRod() {
    let total = 0;
    for (let i = 0; i < this.rods.length; i++) if (i !== this._lastRod) total += this.rods[i].weight;
    let x = Math.random() * total;
    for (let i = 0; i < this.rods.length; i++) {
      if (i === this._lastRod) continue;
      x -= this.rods[i].weight;
      if (x <= 0) return i;
    }
    return 0;
  }

  _queueThunder(pos, big, vol = 1) {
    const cam = this.game.camera;
    const d = cam ? cam.position.distanceTo(pos) : 60;
    if (this._thunder.length > 6) return;
    this._thunder.push({ delay: d / SOUND_SPEED, name: d < 70 ? 'thunder_near' : 'thunder_far', pos: pos.clone(), vol: big ? vol : vol * 0.5 });
  }

  // ------------------------------------------------------------------ sheet lightning (deck glow only)

  _beginSheet() {
    const a = rr(0, Math.PI * 2), d = rr(70, 190);
    this._sheet = { t: 0, len: rr(0.35, 0.6), x: Math.cos(a) * d, z: Math.sin(a) * d, radius: rr(45, 85), power: rr(1.1, 2.0), stroke2: rr(0.1, 0.2) };
    if (Math.random() < 0.4) this._queueThunder(_v0.set(this._sheet.x, 0, this._sheet.z), false, 0.55);
  }

  _updateSheet(dt) {
    const s = this._sheet, sky = this.world.sky;
    s.t += dt;
    const e = Math.max(Math.exp(-s.t * 7), s.t > s.stroke2 ? 0.7 * Math.exp(-(s.t - s.stroke2) * 8) : 0);
    if (s.t >= s.len) {
      this._sheet = null;
      this._nextSheet = rr(this.cfg.sheetEvery[0], this.cfg.sheetEvery[1]);
      if (sky && !this._strike) { sky.setFlash(0); sky.setBolts(null); }
      return;
    }
    if (sky && !this._strike) {
      const b = this._bl[0];
      b.x = s.x; b.z = s.z; b.radius = s.radius; b.intensity = s.power * e;
      sky.setFlash(0.2 * e * this._reduce());
      sky.setBolts(this._bl);
    }
  }

  _reduce() {
    const st = this.game.settings;
    try { return st && st.get && st.get('reduceFlashes') ? 0.4 : 1; } catch { return 1; }
  }

  // ------------------------------------------------------------------ strikes

  /**
   * Start the strike on rod `index` with `warn` seconds of warning (online clients: from the host's message).
   * @param {number} index @param {number} warn
   */
  beginStrike(index, warn) {
    if (!this.cfg || !this.rods[index]) return;
    if (this._strike) this._strike = null;   // a late message: the new strike wins
    this._beginStrike(index, Math.max(0, Number(warn) || 0));
  }

  _beginStrike(forced = -1, forcedWarn = -1) {
    const i = forced >= 0 ? forced : this._pickRod();
    this._lastRod = i;
    const rod = this.rods[i];
    const playing = this.game.state === 'playing';
    const warn = forcedWarn >= 0 ? forcedWarn : rod.hazard && playing ? this.cfg.warn : 0;
    if (forced < 0 && this.game.events) this.game.events.emit('storm:strike', { rod: i, warn });
    this._strike = { rod, t: -warn, warn, fired: false, stroke: -1 };
    if (warn > 0) {
      const a = this.game.audio;
      if (a && a.play) a.play('storm_warning', { position: _v0.copy(rod.base).setY(rod.base.y + 1.5) });
      this._ringMat.color.setRGB(1.6, 0.42, 0.16);
      this._discMat.color.setRGB(1.6, 0.42, 0.16);
      this._placeRing(rod, 1);
      this.ring.visible = this.disc.visible = true;
      this.beacon.position.copy(rod.tip);
      this.beacon.visible = true;
    }
  }

  _placeRing(rod, scale) {
    this.ring.position.set(rod.base.x, rod.base.y + 0.09, rod.base.z);
    this.disc.position.copy(this.ring.position);
    this.ring.scale.set(rod.r * scale, 1, rod.r * scale);
    this.disc.scale.copy(this.ring.scale);
  }

  _updateStrike(dt) {
    const S = this._strike, rod = S.rod, sky = this.world.sky;
    S.t += dt;
    if (S.t < 0) {
      // telegraph: ring pulses faster as the strike nears
      const k = 1 - (-S.t) / S.warn;
      const pulse = 0.5 + 0.5 * Math.sin(this.time * (8 + 16 * k));
      this._ringMat.opacity = 0.35 + 0.65 * pulse * (0.5 + 0.5 * k);
      this._discMat.opacity = 0.05 + 0.13 * pulse * k;
      this._beaconMat.opacity = 0.4 + 0.6 * pulse;
      this.beacon.scale.setScalar(0.8 + 0.8 * k * pulse);
      this._placeRing(rod, 1 + 0.03 * pulse);
      return;
    }
    if (!S.fired) this._fire(S);
    const t = S.t;
    let env = 0, stroke = -1;
    for (let i = 0; i < STROKES.length; i++) {
      const [t0, pk] = STROKES[i];
      if (t < t0) break;
      const v = pk * Math.exp(-(t - t0) * 11);
      if (v > env) env = v;
      stroke = i;
    }
    if (stroke !== S.stroke) { S.stroke = stroke; this._buildBolt(rod, stroke); }
    const red = this._reduce();
    this._applyFlash(env, red);
    if (this.ring.visible) {
      // shock ring after a hazard strike: cyan-white, expanding
      const u = Math.min(1, t / 0.4);
      this._placeRing(rod, 1 + 0.7 * u);
      this._ringMat.opacity = (1 - u) * 0.9;
      this._discMat.opacity = (1 - u) * 0.12;
      if (u >= 1) { this.ring.visible = this.disc.visible = false; }
    }
    this._bmat.color.setScalar(0.25 + 1.5 * Math.min(1, env * 1.4));
    this._writeBolt();
    if (t >= STRIKE_LEN) {
      this.bolt.visible = false;
      this.ring.visible = this.disc.visible = false;
      this._endFlash();
      if (sky) { sky.setFlash(0); sky.setBolts(null); }
      this._strike = null;
      this._nextStrike = rr(this.cfg.strikeEvery[0], this.cfg.strikeEvery[1]);
    }
  }

  _fire(S) {
    S.fired = true;
    const rod = S.rod, game = this.game;
    this._captureBase();
    this.beacon.visible = false;
    if (rod.hazard) {
      // recolour the ring for the shock wave
      this._ringMat.color.setRGB(1.0, 1.5, 1.7);
      this._discMat.color.setRGB(0.6, 1.1, 1.4);
      this.ring.visible = this.disc.visible = true;
      if (game.state === 'playing' && game.combat && game.combat.radialDamage) {
        _base.copy(rod.base).setY(rod.base.y + 0.6);
        game.combat.radialDamage(_base, { radius: rod.r, damage: this.cfg.damage, attacker: null, weapon: 'lightning', knockback: this.cfg.knockback });
      }
    }
    // light on the rod, camera shake by distance, thunder
    const fx = game.effects;
    if (fx && fx.flashLight) {
      _v1.copy(rod.base).setY(rod.base.y + Math.min(rod.tip.y - rod.base.y, 16));
      fx.flashLight(_v1, '#bfe0ff', 420, 70, 0.4);
    }
    const cam = game.camera;
    if (cam && game.player && game.player.addShake) {
      const d = cam.position.distanceTo(rod.base);
      if (d < 60) game.player.addShake(0.32 * (1 - d / 60) * this._reduce());
    }
    this._queueThunder(_v2.copy(rod.tip), true, 1);
  }

  // ------------------------------------------------------------------ global flash

  _captureBase() {
    if (this._baseLight) return;
    const w = this.world, g = this.game, sc = g.scene;
    this._baseLight = {
      hemi: w.hemi ? w.hemi.intensity : 0,
      sun: w.sun ? w.sun.intensity : 0,
      env: sc.environmentIntensity,
      viewHemi: g.viewHemi ? g.viewHemi.intensity : 0,
      bloom: g.bloomPass ? g.bloomPass.strength : 0,
    };
  }

  _applyFlash(env, red) {
    const b = this._baseLight;
    if (!b) return;
    const w = this.world, g = this.game, k = env * red;
    if (w.hemi) w.hemi.intensity = b.hemi * (1 + 1.6 * k);
    if (w.sun) w.sun.intensity = b.sun * (1 + 0.7 * k);
    g.scene.environmentIntensity = b.env * (1 + 1.8 * k);
    if (g.viewHemi) g.viewHemi.intensity = b.viewHemi * (1 + 0.9 * k);
    if (g.bloomPass && b.bloom > 0.002) g.bloomPass.strength = b.bloom * (1 + 0.5 * k);
    if (w.sky) {
      w.sky.setFlash(0.4 * k);
      const b = this._bl[0], rb = this._strike.rod.base;
      b.x = rb.x + 30; b.z = rb.z - 20; b.radius = 90; b.intensity = 2.2 * k;
      w.sky.setBolts(this._bl);
    }
  }

  _endFlash() {
    const b = this._baseLight;
    if (!b) return;
    const w = this.world, g = this.game;
    if (w.hemi) w.hemi.intensity = b.hemi;
    if (w.sun) w.sun.intensity = b.sun;
    g.scene.environmentIntensity = b.env;
    if (g.viewHemi) g.viewHemi.intensity = b.viewHemi;
    if (g.bloomPass) g.bloomPass.strength = b.bloom;
    this._baseLight = null;
  }

  // ------------------------------------------------------------------ bolt geometry

  /** Random-walk polyline from `from` to `to` (corrected so it ends exactly on `to`). */
  _path(line, from, to, n, amp) {
    line.n = n + 1;
    const p = line.pts;
    let ox = 0, oz = 0;
    const off = [];
    for (let i = 0; i <= n; i++) {
      if (i > 0) { ox += rr(-amp, amp); oz += rr(-amp, amp); }
      off.push(ox, oz);
    }
    const ex = ox, ez = oz;
    for (let i = 0; i <= n; i++) {
      const f = i / n;
      p[i * 3] = from.x + (to.x - from.x) * f + off[i * 2] - ex * f;
      p[i * 3 + 1] = from.y + (to.y - from.y) * f;
      p[i * 3 + 2] = from.z + (to.z - from.z) * f + off[i * 2 + 1] - ez * f;
    }
  }

  _buildBolt(rod, stroke) {
    // start high above and to the side of the rod, come down in a jagged line; re-rolled on every stroke
    _v0.set(rod.tip.x + rr(-35, 35), rod.tip.y + rr(110, 150), rod.tip.z + rr(-35, 35));
    const main = this._lines[0];
    main.w = 1;
    this._path(main, _v0, rod.tip, 24, 4.2);
    let li = 1;
    const forks = 3 + (stroke === 0 ? 2 : 0);
    for (let k = 0; k < forks && li < MAX_LINES; k++, li++) {
      const s = 3 + Math.floor(Math.random() * 17);
      _v1.set(main.pts[s * 3], main.pts[s * 3 + 1], main.pts[s * 3 + 2]);
      const a = rr(0, Math.PI * 2), len = rr(22, 46);
      _v2.set(_v1.x + Math.cos(a) * len, _v1.y - rr(10, 30), _v1.z + Math.sin(a) * len);
      this._path(this._lines[li], _v1, _v2, 7, 3.2);
      this._lines[li].w = 0.5;
    }
    for (let i = li; i < MAX_LINES; i++) this._lines[i].n = 0;
    this.bolt.visible = true;
  }

  _writeBolt() {
    const cam = this.game.camera;
    if (!cam) return;
    const pos = this._bpos, col = this._bcol;
    let q = 0;
    for (let li = 0; li < MAX_LINES; li++) {
      const L = this._lines[li];
      for (let layer = 0; layer < 2; layer++) {
        const half = (layer === 0 ? 1.5 : 0.24) * L.w;      // glow / core half width (m)
        const cr = layer === 0 ? 0.22 : 0.9, cg = layer === 0 ? 0.42 : 0.96, cb = 1.0;
        const k = layer === 0 ? 1.0 : 1.5;
        for (let i = 0; i < L.n - 1; i++) {
          if (q >= MAX_QUADS) break;
          const a = i * 3, b = a + 3, p = L.pts;
          _v0.set(p[a], p[a + 1], p[a + 2]);
          _v1.set(p[b], p[b + 1], p[b + 2]);
          _v2.copy(_v1).sub(_v0);
          _side.copy(cam.position).sub(_v0).cross(_v2);
          if (_side.lengthSq() < 1e-8) _side.set(1, 0, 0);
          _side.normalize().multiplyScalar(half);
          const o = q * 12;
          pos[o] = _v0.x - _side.x; pos[o + 1] = _v0.y - _side.y; pos[o + 2] = _v0.z - _side.z;
          pos[o + 3] = _v0.x + _side.x; pos[o + 4] = _v0.y + _side.y; pos[o + 5] = _v0.z + _side.z;
          pos[o + 6] = _v1.x - _side.x; pos[o + 7] = _v1.y - _side.y; pos[o + 8] = _v1.z - _side.z;
          pos[o + 9] = _v1.x + _side.x; pos[o + 10] = _v1.y + _side.y; pos[o + 11] = _v1.z + _side.z;
          for (let v = 0; v < 4; v++) { col[o + v * 3] = cr * k; col[o + v * 3 + 1] = cg * k; col[o + v * 3 + 2] = cb * k; }
          q++;
        }
      }
    }
    this._bgeo.setDrawRange(0, q * 6);
    this._bgeo.attributes.position.needsUpdate = true;
    this._bgeo.attributes.color.needsUpdate = true;
  }

  // ------------------------------------------------------------------ teardown

  dispose() {
    this._endFlash();
    const sky = this.world.sky;
    if (sky) { sky.setFlash(0); sky.setBolts(null); }
    if (this.group.parent) this.group.parent.remove(this.group);
    for (const d of this._disposables) d.dispose();
    this._disposables.length = 0;
    this.spinners.length = 0;
    this.cfg = null;
  }
}
