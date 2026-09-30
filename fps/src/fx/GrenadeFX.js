import * as THREE from 'three';
import { F, D } from './Atlas.js';
import { TAU } from '../core/utils.js';

/**
 * Visuals for the special grenades (Vortex, Static, Kinetic Charge, Smoke Screen): the vortex rig (event-horizon
 * core + three spinning rings + inflow streaks), lightning bolts (own pooled renderer), shock / blast rings and
 * sparks, smoke clouds and a few screen-space overlays (smoke veil, shock flash, vortex vignette).
 *
 * Everything is built from the shared particle layers of `game.effects` (its private emitters are stable
 * within this project) plus a handful of pooled meshes. Sounds are played by GrenadeTypes.js, not here.
 */

// ------------------------------------------------------------------ constants

const BOLT_MAX = 40;
const BOLT_POINTS = 10;
const BOLT_SEGS = 320;
const RIG_COUNT = 3;

const _c = new THREE.Color();
/** sRGB hex -> linear rgb triple (for the particle emitters). */
const lin = hex => { _c.set(hex); return [_c.r, _c.g, _c.b]; };

const COL = {
  white: [1, 1, 1],
  violetHot: lin(0xe6d0ff), violet: lin(0xa062ff), violetDeep: lin(0x4a1fc0), lilac: lin(0xc8a8ff),
  cyanHot: lin(0xd8fbff), cyan: lin(0x5cf2ff), cyanDeep: lin(0x1a68ff),
  mintHot: lin(0xe0fff0), mint: lin(0x62ff9a), mintDeep: lin(0x18b060),
  smoke: [0.72, 0.76, 0.82], smokeDark: [0.62, 0.66, 0.73], dust: lin(0xa8a196),
  chip: lin(0x8c8a86),
};

const UP = new THREE.Vector3(0, 1, 0);
const Z_AXIS = new THREE.Vector3(0, 0, 1);
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _p1 = new THREE.Vector3();
const _p2 = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _s = new THREE.Vector3();
const _col = new THREE.Color();

const rr = (a, b) => a + Math.random() * (b - a);

/** HDR colours of the vortex rings / lightning (linear, scaled a bit above 1 so bloom picks them up softly). */
const RING_COLORS = [[0.75, 0.38, 1.35], [0.28, 0.95, 1.25], [0.85, 0.66, 1.3]];
const BOLT_RGB = [0.3, 1.35, 2.0];

export class GrenadeFX {
  /** @param {object} game */
  constructor(game) {
    this.game = game;
    this.time = 0;
    this.rigs = [];
    this.clouds = [];
    this.bolts = [];
    this._boltMesh = null;
    this._ready = false;
    /** Screen overlay strengths 0..1 (smoke veil, shock flash, vortex vignette). */
    this.screen = { smoke: 0, shock: 0, vortex: 0 };
    this._overlay = null;
    this._shown = { smoke: -1, shock: -1, vortex: -1 };
    this._lightMap = null;
    this._vortexNear = 0;
    this._zapT = 0;
  }

  get fx() { return this.game.effects; }

  /** Build pooled meshes and the DOM overlay. Safe to call once. */
  init() {
    if (this._ready) return;
    this._buildBolts();
    this._buildRigs();
    this._buildOverlay();
    this._ready = true;
  }

  // ================================================================== lightning bolts

  _buildBolts() {
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, fog: false,
    });
    const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), mat, BOLT_SEGS);
    mesh.frustumCulled = false;
    mesh.count = 0;
    mesh.renderOrder = 6;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.setColorAt(0, _col.setRGB(0, 0, 0));
    mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    mesh.visible = false;
    mesh.name = 'grenade_bolts';
    this.game.scene.add(mesh);
    this._boltMesh = mesh;
    for (let i = 0; i < BOLT_MAX; i++) {
      this.bolts.push({ on: false, age: 0, delay: 0, life: 0.14, w: 0.1, n: 0, pts: new Float32Array(BOLT_POINTS * 3), rgb: BOLT_RGB });
    }
  }

  /**
   * Jagged lightning bolt (re-struck with fresh jitter for every entry of `restrike`).
   * @param {THREE.Vector3} from
   * @param {THREE.Vector3} to
   * @param {{width?:number, life?:number, jitter?:number, restrike?:number[], rgb?:number[]}} [o]
   */
  bolt(from, to, { width = 0.1, life = 0.14, jitter = 0.28, restrike = [0], rgb = BOLT_RGB } = {}) {
    if (!this._ready) return;
    _dir.subVectors(to, from);
    const len = _dir.length();
    if (len < 0.2) return;
    _dir.multiplyScalar(1 / len);
    _a.crossVectors(_dir, UP);
    if (_a.lengthSq() < 0.01) _a.set(1, 0, 0);
    _a.normalize();
    _b.crossVectors(_dir, _a).normalize();
    const n = Math.max(4, Math.min(BOLT_POINTS, Math.ceil(len / 0.8) + 1));
    for (const delay of restrike) {
      const bolt = this.bolts.find(x => !x.on);
      if (!bolt) return;
      bolt.on = true; bolt.age = 0; bolt.delay = delay; bolt.life = life; bolt.w = width; bolt.n = n; bolt.rgb = rgb;
      const P = bolt.pts;
      for (let i = 0; i < n; i++) {
        const u = i / (n - 1);
        const env = Math.sin(u * Math.PI) * jitter * Math.min(2.2, 0.5 + len * 0.18);
        const ja = i === 0 || i === n - 1 ? 0 : rr(-1, 1) * env;
        const jb = i === 0 || i === n - 1 ? 0 : rr(-1, 1) * env;
        P[i * 3] = from.x + _dir.x * len * u + _a.x * ja + _b.x * jb;
        P[i * 3 + 1] = from.y + _dir.y * len * u + _a.y * ja + _b.y * jb;
        P[i * 3 + 2] = from.z + _dir.z * len * u + _a.z * ja + _b.z * jb;
      }
    }
  }

  _updateBolts(dt) {
    const mesh = this._boltMesh;
    if (!mesh) return;
    let inst = 0;
    for (const bolt of this.bolts) {
      if (!bolt.on) continue;
      bolt.age += dt;
      const t = bolt.age - bolt.delay;
      if (t > bolt.life) { bolt.on = false; continue; }
      if (t < 0) continue;
      const fade = 1 - t / bolt.life;
      const k = fade * fade * 0.7 + 0.3 * fade;
      const P = bolt.pts;
      for (let i = 0; i < bolt.n - 1 && inst < BOLT_SEGS; i++) {
        _p1.set(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]);
        _p2.set(P[i * 3 + 3], P[i * 3 + 4], P[i * 3 + 5]);
        _dir.subVectors(_p2, _p1);
        const len = _dir.length();
        if (len < 1e-4) continue;
        _dir.multiplyScalar(1 / len);
        _q.setFromUnitVectors(Z_AXIS, _dir);
        _p1.lerp(_p2, 0.5);
        const w = bolt.w * (0.6 + 0.4 * fade);
        _m.compose(_p1, _q, _s.set(w, w, len + w * 0.6));
        mesh.setMatrixAt(inst, _m);
        mesh.setColorAt(inst, _col.setRGB(bolt.rgb[0] * k, bolt.rgb[1] * k, bolt.rgb[2] * k));
        inst++;
      }
    }
    mesh.count = inst;
    mesh.visible = inst > 0;
    if (inst > 0) {
      mesh.instanceMatrix.needsUpdate = true;
      mesh.instanceColor.needsUpdate = true;
    }
  }

  // ================================================================== vortex rig

  _buildRigs() {
    const coreMat = new THREE.MeshBasicMaterial({ color: 0x000000, fog: false });
    const coreGeo = new THREE.SphereGeometry(0.42, 18, 12);
    const radii = [1.05, 1.75, 2.5];
    const hc = document.createElement('canvas');
    hc.width = hc.height = 64;
    const hg = hc.getContext('2d');
    const grad = hg.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, 'rgba(255,255,255,0.0)');
    grad.addColorStop(0.28, 'rgba(180,120,255,0.55)');
    grad.addColorStop(0.6, 'rgba(110,60,255,0.18)');
    grad.addColorStop(1, 'rgba(90,40,255,0)');
    hg.fillStyle = grad;
    hg.fillRect(0, 0, 64, 64);
    const haloTex = new THREE.CanvasTexture(hc);
    haloTex.colorSpace = THREE.SRGBColorSpace;
    const haloMat = new THREE.SpriteMaterial({ map: haloTex, color: new THREE.Color(0.9, 0.7, 1.6), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, fog: false });
    const ringMats = RING_COLORS.map(c => new THREE.MeshBasicMaterial({
      color: new THREE.Color(c[0], c[1], c[2]), transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending,
      depthWrite: false, toneMapped: false, fog: false, side: THREE.DoubleSide,
    }));
    const ringGeos = radii.map(r => new THREE.TorusGeometry(r, 0.045 + r * 0.014, 6, 48));
    for (let i = 0; i < RIG_COUNT; i++) {
      const group = new THREE.Group();
      group.visible = false;
      const core = new THREE.Mesh(coreGeo, coreMat);
      core.frustumCulled = false;
      group.add(core);
      // soft violet halo behind the core (additive billboard)
      const halo = new THREE.Sprite(haloMat);
      halo.scale.setScalar(5.5);
      group.add(halo);
      const rings = [];
      for (let k = 0; k < 3; k++) {
        const pivot = new THREE.Group();
        pivot.rotation.set(0.35 + k * 0.9, k * 1.1, k * 0.5);
        const ring = new THREE.Mesh(ringGeos[k], ringMats[k]);
        ring.frustumCulled = false;
        pivot.add(ring);
        group.add(pivot);
        rings.push(pivot);
      }
      group.name = 'vortex_rig';
      this.game.scene.add(group);
      this.rigs.push({ group, core, rings, used: false, acc: 0, lightT: 0, phase: Math.random() * 6 });
    }
  }

  /** Reserve a rig for a vortex grenade (null when all are busy). */
  vortexAcquire(g) {
    if (!this._ready) return null;
    const rig = this.rigs.find(r => !r.used);
    if (!rig) return null;
    rig.used = true;
    rig.acc = 0;
    rig.lightT = 0;
    rig.group.visible = true;
    rig.group.scale.setScalar(0.05);
    rig.group.position.copy(g.center);
    g.rig = rig;
    return rig;
  }

  vortexRelease(g) {
    const rig = g.rig;
    if (!rig) return;
    rig.used = false;
    rig.group.visible = false;
    g.rig = null;
  }

  /**
   * Per-frame vortex visuals.
   * @param {object} g grenade (uses g.center, g.def, g.stateT, g.state)
   * @param {number} dt
   */
  vortexTick(g, dt) {
    const rig = g.rig;
    if (!rig) return;
    const def = g.def;
    const active = g.state === 'active';
    const t = active ? g.stateT : 0;
    const left = active ? def.duration - g.stateT : def.duration;
    // scale: grow during the deploy, swell 1.0 -> 1.3, then shrink into the collapse
    let s;
    if (!active) s = 0.1 + 0.9 * Math.min(1, g.stateT / def.deploy);
    else if (left > 0.4) s = 1 + 0.3 * (t / (def.duration - 0.4));
    else s = 1.3 - 1.1 * (1 - left / 0.4);
    rig.group.scale.setScalar(Math.max(0.05, s));
    rig.group.position.copy(g.center);
    const spin = (active ? 1.8 + 3.5 * (t / def.duration) : 1.4);
    rig.phase += dt * spin;
    rig.rings[0].rotation.y = rig.phase;
    rig.rings[1].rotation.x = 1.3 + rig.phase * 1.35;
    rig.rings[2].rotation.z = 0.5 - rig.phase * 1.7;
    if (!active) return;

    const fx = this.fx;
    if (!fx || !fx._ready) return;
    // a violet ring that collapses from the pull radius into the core shows the reach of the well
    rig.ringT = (rig.ringT || 0) - dt;
    if (rig.ringT <= 0) {
      rig.ringT = 0.4;
      const fy = fx._floorBelow(g.center.x, g.center.y, g.center.z, 3);
      const y = fy > -1e8 ? fy + 0.08 : g.center.y;
      fx._ring(g.center.x, y, g.center.z, 0, 1, 0, def.radius * 1.05, 0.7, 0.9, COL.violetHot, 0.9, COL.violet, 0.35, 0.55);
    }
    // inflow streaks on a tilted disc
    const sc = this.game.quality && this.game.quality.particleScale != null ? this.game.quality.particleScale : 1;
    rig.acc += dt * 42 * Math.max(0.4, sc);
    const R = def.radius;
    while (rig.acc >= 1) {
      rig.acc -= 1;
      const a = Math.random() * TAU;
      const r = rr(1.2, R * 0.92);
      const tilt = 0.35;
      const px = Math.cos(a) * r, pz = Math.sin(a) * r;
      const py = px * tilt + rr(-0.5, 0.5);
      const inv = 1 / Math.max(0.5, r);
      const inward = r / 0.5;                     // arrive at the core in ~0.5 s
      const sw = 3.5;
      fx._spark(g.center.x + px, g.center.y + py, g.center.z + pz,
        -px * inv * inward + -pz * inv * sw, -py * inv * inward * 0.8, -pz * inv * inward + px * inv * sw,
        0.5, rr(0.14, 0.24), 3.4, 0.6,
        { rgb0: Math.random() < 0.3 ? COL.cyanHot : COL.violetHot, rgb1: COL.violetDeep, grav: 0, drag: 0, stretch: 0.03 });
    }
    // steady violet light
    rig.lightT -= dt;
    if (rig.lightT <= 0) {
      rig.lightT = 0.1;
      fx.flashLight(g.center, 0xa060ff, 30, 14, 0.14);
    }
  }

  /** Scorch decal + a small dust puff when a vortex sticks. */
  vortexStick(g) {
    const fx = this.fx;
    if (!fx || !fx._ready) return;
    _a.copy(g.normal);
    fx._decal(D.SCORCH_ENERGY, g.position.x, g.position.y, g.position.z, _a, 3.4, COL.white, 0.9, 40, true);
    fx._flash(g.center.x, g.center.y, g.center.z, 1.8, 0.15, COL.violetHot, 1.2);
  }

  /** Big violet implosion / release. */
  vortexCollapse(center, R) {
    const fx = this.fx;
    if (!fx || !fx._ready) return;
    const x = center.x, y = center.y, z = center.z;
    const gl = fx._glareScale(x, y, z, R);
    fx._flash(x, y, z, R * 1.5, 0.09, COL.white, 2.2 * gl);
    fx._flash(x, y, z, R * 2.2, 0.35, COL.violet, 0.9 * gl);
    // inward then outward shock rings
    fx._ring(x, y, z, 0, 1, 0, R * 1.6, 0.6, 0.22, COL.violet, 1.1, COL.violetDeep, 0.4, 0.8);
    fx._ring(x, y, z, 0, 1, 0, 0.7, R * 2.6, 0.42, COL.white, 1.4 * gl, COL.violet, 0.7 * gl, 0.75);
    _a.set(1, 0.3, 0.2).normalize();
    fx._ring(x, y, z, _a.x, _a.y, _a.z, 0.7, R * 2.1, 0.36, COL.violetHot, 1.0 * gl, COL.violet, 0.5 * gl, 0.6);
    const floorY = fx._floorBelow(x, y, z, 6);
    const hasFloor = floorY > -1e8;
    const n = fx._cnt(60);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU, e = rr(-0.5, 1.0), ce = Math.sqrt(Math.max(0, 1 - e * e));
      const sp = rr(6, 22);
      fx._spark(x, y, z, Math.cos(a) * ce * sp, e * sp + 1, Math.sin(a) * ce * sp, rr(0.5, 1.2), rr(0.1, 0.2), 3.4, 0.6,
        { rgb0: Math.random() < 0.4 ? COL.white : COL.violetHot, rgb1: COL.violet, grav: 10, drag: 0.7, stretch: 0.045, floor: hasFloor ? floorY : undefined });
    }
    const nc = fx._cnt(14);
    for (let i = 0; i < nc; i++) {
      const a = Math.random() * TAU, e = rr(0.1, 1), ce = Math.sqrt(1 - e * e), sp = rr(5, 14);
      fx._chip(x, y, z, Math.cos(a) * ce * sp, e * sp + 2, Math.sin(a) * ce * sp, rr(0.9, 1.8), rr(0.18, 0.4), COL.chip,
        { grav: 20, drag: 0.15, floor: hasFloor ? floorY : undefined });
    }
    if (hasFloor && y - floorY < R) {
      fx._decal(D.SCORCH_ENERGY, x, floorY, z, UP, R * 1.5, COL.white, 0.95, 60, true);
    }
    fx.flashLight(center, 0xa565ff, 170, R * 8, 0.4);
    this._shake(x, y, z, R, 0.8);
  }

  // ================================================================== static

  /**
   * Static burst: white flash, expanding cyan ring, one bolt per target plus random ground arcs, sparks and zaps.
   * @param {THREE.Vector3} center
   * @param {THREE.Vector3[]} chests target chest positions
   * @param {number} R burst radius
   */
  staticBurst(center, chests, R) {
    const fx = this.fx;
    if (!fx || !fx._ready) return;
    const x = center.x, y = center.y, z = center.z;
    const gl = fx._glareScale(x, y, z, 4);
    fx._flash(x, y, z, 5.5, 0.09, COL.cyanHot, 2.0 * gl);
    fx._flash(x, y, z, 9, 0.3, COL.cyan, 0.6 * gl);
    const floorY = fx._floorBelow(x, y, z, 3);
    const hasFloor = floorY > -1e8;
    const fy = hasFloor ? floorY + 0.06 : y;
    fx._ring(x, fy, z, 0, 1, 0, 0.6, R * 1.15, 0.36, COL.cyanHot, 1.5 * gl, COL.cyanDeep, 0.7 * gl, 0.75);
    fx._ring(x, fy, z, 0, 1, 0, 0.4, R * 0.7, 0.24, COL.white, 1.1 * gl, COL.cyan, 0.6 * gl, 0.6);
    // arcs to the targets
    for (const c of chests) this.bolt(center, c, { width: 0.1, life: 0.14, jitter: 0.22, restrike: [0, 0.06, 0.12] });
    // random ground arcs
    const nArc = 8;
    for (let i = 0; i < nArc; i++) {
      const a = Math.random() * TAU, d = rr(3, 8);
      _b.set(x + Math.cos(a) * d, (hasFloor ? floorY : y) + rr(0.05, 0.9), z + Math.sin(a) * d);
      this.bolt(center, _b, { width: 0.06, life: 0.12, jitter: 0.3, restrike: [0, 0.07] });
    }
    const ns = fx._cnt(40);
    for (let i = 0; i < ns; i++) {
      const a = Math.random() * TAU, e = rr(-0.1, 1), ce = Math.sqrt(1 - e * e), sp = rr(5, 20);
      fx._spark(x, y, z, Math.cos(a) * ce * sp, e * sp + 2, Math.sin(a) * ce * sp, rr(0.3, 0.8), rr(0.08, 0.16), 3.2, 0.7,
        { rgb0: Math.random() < 0.3 ? COL.white : COL.cyanHot, rgb1: COL.cyanDeep, grav: 12, drag: 0.6, stretch: 0.04, floor: hasFloor ? floorY : undefined });
    }
    for (let i = 0; i < 4; i++) fx._zap(x + rr(-0.6, 0.6), y + rr(-0.2, 0.6), z + rr(-0.6, 0.6), rr(0.8, 1.6), 0.18);
    for (const c of chests) fx._zap(c.x, c.y, c.z, 1.3, 0.2);
    if (hasFloor) fx._decal(D.SCORCH_ENERGY, x, floorY, z, UP, 4.2, COL.white, 0.9, 50, true);
    fx.flashLight(center, 0x5cf2ff, 150, 20, 0.3);
    this._shake(x, y, z, 6, 0.5);
  }

  /** A spark at a random point of a shocked entity's body. */
  zap(e) {
    const fx = this.fx;
    if (!fx || !fx._ready) return;
    const h = e.height || 1.8;
    const x = e.position.x + rr(-0.3, 0.3), y = e.position.y + rr(0.15, h * 0.95), z = e.position.z + rr(-0.3, 0.3);
    fx._zap(x, y, z, rr(0.3, 0.55), 0.12);
    if (Math.random() < 0.6) fx._spark(x, y, z, rr(-2, 2), rr(0.5, 3), rr(-2, 2), rr(0.15, 0.3), 0.07, 2.6, 0.6,
      { rgb0: COL.cyanHot, rgb1: COL.cyanDeep, grav: 8, drag: 1, stretch: 0.03 });
  }

  // ================================================================== kinetic

  /** Displacement blast: mint flash, ground + camera-facing rings, sparks, no fire and no smoke. */
  kineticBlast(center, R) {
    const fx = this.fx;
    if (!fx || !fx._ready) return;
    const x = center.x, y = center.y, z = center.z;
    const gl = fx._glareScale(x, y, z, R);
    fx._flash(x, y, z, R * 0.85, 0.07, COL.mintHot, 2.0 * gl);
    fx._flash(x, y, z, R * 1.4, 0.24, COL.mint, 0.55 * gl);
    const floorY = fx._floorBelow(x, y, z, R * 1.2);
    const hasFloor = floorY > -1e8;
    if (hasFloor && y - floorY < R) {
      fx._ring(x, floorY + 0.06, z, 0, 1, 0, 0.8, R * 1.45, 0.45, COL.mintHot, 1.5 * gl, COL.mintDeep, 0.6 * gl, 0.8);
      const nr = fx._cnt(8);
      for (let i = 0; i < nr; i++) {
        const a = (i / nr) * TAU + rr(-0.2, 0.2), sp = rr(5, 10);
        fx._puff(x + Math.cos(a) * R * 0.25, floorY + 0.3, z + Math.sin(a) * R * 0.25, Math.cos(a) * sp, rr(0.2, 0.7), Math.sin(a) * sp,
          rr(0.7, 1.3), R * 0.16, R * rr(0.45, 0.7), COL.dust, rr(0.25, 0.35), { drag: 2.8, sizePow: 0.5, floor: floorY });
      }
    }
    const cam = this.game.camera.position;
    _dir.set(cam.x - x, cam.y - y, cam.z - z);
    if (_dir.lengthSq() < 1e-4) _dir.set(0, 1, 0);
    _dir.normalize();
    fx._ring(x, y, z, _dir.x, _dir.y, _dir.z, 0.4, R * 1.15, 0.32, COL.white, 1.3 * gl, COL.mint, 0.6 * gl, 0.7);
    const n = fx._cnt(40);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU, e = rr(-0.2, 1), ce = Math.sqrt(1 - e * e), sp = rr(6, 20);
      fx._spark(x, y, z, Math.cos(a) * ce * sp, e * sp + 1, Math.sin(a) * ce * sp, rr(0.35, 0.9), rr(0.09, 0.16), 3.0, 0.6,
        { rgb0: Math.random() < 0.4 ? COL.white : COL.mintHot, rgb1: COL.mintDeep, grav: 10, drag: 0.8, stretch: 0.04, floor: hasFloor ? floorY : undefined });
    }
    fx.flashLight(center, 0x62ffa0, 130, R * 2.4, 0.3);
    this._shake(x, y, z, R, 0.55);
  }

  /** Small impact burst where a knocked-back entity slams into a wall. */
  splat(pos) {
    const fx = this.fx;
    if (!fx || !fx._ready) return;
    fx._flash(pos.x, pos.y, pos.z, 1.2, 0.1, COL.mintHot, 1.2);
    for (let i = 0; i < 10; i++) {
      const a = Math.random() * TAU;
      fx._spark(pos.x, pos.y, pos.z, Math.cos(a) * rr(2, 6), rr(0.5, 5), Math.sin(a) * rr(2, 6), rr(0.25, 0.5), 0.08, 2.4, 0.6,
        { rgb0: COL.mintHot, rgb1: COL.mintDeep, grav: 12, drag: 1, stretch: 0.03 });
    }
  }

  // ================================================================== smoke

  /**
   * A smoke cloud: puffs inflate over 0.8 s, sustain, then stop feeding for the last 2.5 s so it thins out.
   * @param {THREE.Vector3} center sphere centre
   * @param {number} radius
   * @param {number} duration seconds
   */
  smokeCloud(center, radius, duration) {
    const fx = this.fx;
    if (!fx || !fx._ready) return;
    const cloud = { x: center.x, y: center.y, z: center.z, r: radius, dur: duration, age: 0, acc: 0, floorY: fx._floorBelow(center.x, center.y, center.z, radius + 2) };
    this.clouds.push(cloud);
    while (this.clouds.length > 3) this.clouds.shift();
    // instant burst so it "pops"
    fx._flash(center.x, center.y, center.z, radius * 0.9, 0.08, COL.smoke, 0.6);
    for (let i = 0; i < 10; i++) this._puffAt(cloud, 0.5);
  }

  _puffAt(cloud, spread) {
    const fx = this.fx;
    const R = cloud.r;
    // random point inside a sphere of 0.7 R * spread
    let x, y, z;
    do { x = rr(-1, 1); y = rr(-1, 1); z = rr(-1, 1); } while (x * x + y * y + z * z > 1);
    const k = R * 0.7 * spread;
    const px = cloud.x + x * k, py = cloud.y + y * k * 0.85, pz = cloud.z + z * k;
    const sz = R / 4.6;
    const hasFloor = cloud.floorY > -1e8;
    fx._puff(px, Math.max(py, hasFloor ? cloud.floorY + 0.4 : py), pz, x * 0.6, y * 0.35 + 0.15, z * 0.6, 3.0, 3.2 * sz, 4.5 * sz,
      Math.random() < 0.35 ? COL.smokeDark : COL.smoke, 0.55,
      { drag: 2.6, fadeIn: 0.15, fadePow: 0.8, sizePow: 0.6, rgb1: COL.smoke, floor: hasFloor ? cloud.floorY : undefined });
  }

  _updateClouds(dt) {
    const fx = this.fx;
    if (!fx || !fx._ready || this.clouds.length === 0) return;
    const sc = this.game.quality && this.game.quality.particleScale != null ? this.game.quality.particleScale : 1;
    for (let i = this.clouds.length - 1; i >= 0; i--) {
      const c = this.clouds[i];
      c.age += dt;
      if (c.age >= c.dur) { this.clouds.splice(i, 1); continue; }
      let rate = c.age < 0.8 ? 60 : 12;
      if (c.age > c.dur - 2.5) rate = 0;
      c.acc += rate * dt * Math.max(0.5, sc);
      const spread = c.age < 0.8 ? 0.35 + 0.65 * (c.age / 0.8) : 1;
      while (c.acc >= 1) { c.acc -= 1; this._puffAt(c, spread); }
    }
  }

  // ================================================================== in-flight ticks

  /** Trail / beacon sparks for a special grenade in flight. */
  flightTick(g, dt) {
    const fx = this.fx;
    if (!fx || !fx._ready) return;
    g.fxAcc = (g.fxAcc || 0) + dt;
    const p = g.position;
    switch (g.type) {
      case 'vortex':
        if (g.fxAcc > 0.03) {
          g.fxAcc = 0;
          fx._spark(p.x + rr(-0.05, 0.05), p.y + rr(-0.05, 0.05), p.z + rr(-0.05, 0.05), rr(-0.6, 0.6), rr(-0.6, 0.6), rr(-0.6, 0.6),
            0.35, 0.08, 2.0, 0.5, { rgb0: COL.violetHot, rgb1: COL.violetDeep, grav: 0, drag: 2, stretch: 0.02 });
        }
        break;
      case 'static':
        if (g.fxAcc > 0.28) {
          g.fxAcc = 0;
          fx._zap(p.x + rr(-0.06, 0.06), p.y + rr(-0.04, 0.1), p.z + rr(-0.06, 0.06), rr(0.15, 0.3), 0.09);
          fx._spark(p.x, p.y, p.z, rr(-1.5, 1.5), rr(0.3, 2), rr(-1.5, 1.5), 0.2, 0.05, 2.2, 0.6,
            { rgb0: COL.cyanHot, rgb1: COL.cyanDeep, grav: 8, drag: 1, stretch: 0.03 });
        }
        break;
      case 'kinetic':
        if (g.fxAcc > 0.05) {
          g.fxAcc = 0;
          fx._flash(p.x, p.y, p.z, 0.22, 0.28, COL.mint, 0.5);
        }
        break;
      default:
        break;
    }
  }

  // ================================================================== screen overlay

  _buildOverlay() {
    const ui = this.game.uiRoot;
    if (!ui || typeof document === 'undefined') return;
    const root = document.createElement('div');
    root.className = 'k-gfx';
    root.style.cssText = 'position:absolute;inset:0;pointer-events:none;overflow:hidden;';
    const layer = (bg, extra = '') => {
      const d = document.createElement('div');
      d.style.cssText = 'position:absolute;inset:0;opacity:0;will-change:opacity;' + extra + 'background:' + bg + ';';
      root.appendChild(d);
      return d;
    };
    this._overlay = {
      root,
      smoke: layer('radial-gradient(ellipse at center, rgba(146,156,168,0.94) 0%, rgba(118,128,140,0.98) 100%)'),
      vortex: layer('radial-gradient(ellipse at center, rgba(120,60,255,0) 38%, rgba(96,34,230,0.5) 100%)'),
      shock: layer('radial-gradient(ellipse at center, rgba(92,242,255,0) 30%, rgba(92,242,255,0.5) 100%)'),
    };
    // behind the HUD: first child of the UI root
    ui.insertBefore(root, ui.firstChild);
  }

  /** Tint the smoke veil to the map's ambient light so it matches the 3D puffs. */
  _syncOverlayTint() {
    const o = this._overlay, fx = this.fx, w = this.game.world;
    if (!o || !fx || !fx.smokeMat || !w || w.mapId === this._lightMap) return;
    this._lightMap = w.mapId;
    const L = fx.smokeMat.uniforms.uLight.value;
    const ch = v => Math.round(Math.min(1, Math.max(0.12, v * 0.86)) * 190);
    const r = ch(L.x), g = ch(L.y), b = ch(L.z);
    o.smoke.style.background = `radial-gradient(ellipse at center, rgba(${r},${g},${b},0.94) 0%, rgba(${Math.round(r * 0.85)},${Math.round(g * 0.85)},${Math.round(b * 0.85)},0.98) 100%)`;
  }

  /** How deep the camera sits inside live smoke (0 outside .. 1 deep inside). */
  _smokeDepth() {
    const smokes = this.game.combat && this.game.combat.smokes;
    if (!smokes || smokes.length === 0) return 0;
    const cam = this.game.camera.position, t = this.game.time;
    let best = 0;
    for (const s of smokes) {
      const r = s.r * Math.min(1, Math.max(0.35, (s.until - t) / 2));
      const d = Math.hypot(cam.x - s.pos.x, cam.y - s.pos.y, cam.z - s.pos.z);
      if (d >= r) continue;
      const v = Math.min(1, (r - d) / (r * 0.5));
      if (v > best) best = v;
    }
    return best;
  }

  _updateScreen(dt) {
    const o = this._overlay;
    if (!o) return;
    const game = this.game;
    const p = game.player;
    const playing = game.state === 'playing';
    this._syncOverlayTint();
    const sc = this.screen;
    let smoke = playing ? this._smokeDepth() : 0;
    smoke = smoke * smoke * (3 - 2 * smoke) * 0.96;
    const shocked = playing && p && p.alive && p.isShocked && p.isShocked();
    const shockTarget = shocked ? 0.55 + 0.35 * Math.sin(this.time * 38) * Math.sin(this.time * 23) : 0;
    sc.smoke += (smoke - sc.smoke) * Math.min(1, dt * 7);
    sc.shock += (shockTarget - sc.shock) * Math.min(1, dt * 18);
    const vt = playing ? this._vortexNear : 0;
    sc.vortex += (vt - sc.vortex) * Math.min(1, dt * 6);
    const sh = this._shown;
    if (Math.abs(sc.smoke - sh.smoke) > 0.008) { sh.smoke = sc.smoke; o.smoke.style.opacity = sc.smoke.toFixed(3); }
    if (Math.abs(sc.shock - sh.shock) > 0.008) { sh.shock = sc.shock; o.shock.style.opacity = Math.max(0, sc.shock).toFixed(3); }
    if (Math.abs(sc.vortex - sh.vortex) > 0.008) { sh.vortex = sc.vortex; o.vortex.style.opacity = sc.vortex.toFixed(3); }
  }

  /** Called by GrenadeSystem each frame: strength (0..1) of the vortex vignette for the camera. */
  setVortexProximity(v) {
    this._vortexNear = v;
  }

  // ================================================================== frame / lifecycle

  update(dt) {
    if (!this._ready) return;
    this.time += dt;
    this._updateBolts(dt);
    this._updateClouds(dt);
    this._updateScreen(dt);
  }

  /** Match start / restart: drop every effect. */
  clear() {
    for (const b of this.bolts) b.on = false;
    if (this._boltMesh) { this._boltMesh.count = 0; this._boltMesh.visible = false; }
    for (const r of this.rigs) { r.used = false; r.group.visible = false; }
    this.clouds.length = 0;
    this._vortexNear = 0;
    this.screen.smoke = this.screen.shock = this.screen.vortex = 0;
    if (this._overlay) {
      this._shown.smoke = this._shown.shock = this._shown.vortex = -1;
      this._overlay.smoke.style.opacity = '0';
      this._overlay.shock.style.opacity = '0';
      this._overlay.vortex.style.opacity = '0';
    }
  }

  // ================================================================== helpers

  /** Distance-scaled camera shake (same maths as Effects.explosion). */
  _shake(x, y, z, R, gain) {
    const g = this.game;
    const pl = g.player;
    if (!pl || typeof pl.addShake !== 'function' || pl.alive === false) return;
    const cp = g.camera.position;
    const dist = Math.hypot(cp.x - x, cp.y - y, cp.z - z);
    const f = Math.max(0, 1 - dist / (R * 6));
    const amount = Math.min(1, f * f * gain * (0.5 + 0.09 * R));
    if (amount > 0.01) pl.addShake(amount);
  }
}
