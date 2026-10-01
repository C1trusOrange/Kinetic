import * as THREE from 'three';
import { GRAVITY, QUALITY_PRESETS } from '../core/constants.js';
import { TAU } from '../core/utils.js';
import { createParticleAtlas, createDecalAtlas, F, D } from './Atlas.js';
import {
  ParticleLayer, TracerLayer, DecalLayer,
  createParticleMaterial, createTracerMaterial, createDecalMaterial,
} from './Particles.js';
import { BeamLayer, arcHitFx, galeBlastFx, galeRingFx } from './Beams.js';

// ------------------------------------------------------------------ constants

const SMOKE_CAP = 1200;
const GLOW_CAP = 1800;
const TRACER_CAP = 96;
const SCORCH_CAP = 24;
const LIGHT_POOL = 4;
/** Global multiplier on every additive glow particle (flashes, sparks, fire, zaps): keeps effects glowing, not searing. */
const GLOW_GAIN = 0.62;
/** Bullet tracer brightness (linear HDR multiplier on the tracer colour). */
const TRACER_GAIN = 1.6;
/** Scale of the pooled world flash lights (muzzle flashes, explosions, robot bursts). */
const FLASH_LIGHT_SCALE = 0.6;
const GIB_LIMIT = 70;

const _c = new THREE.Color();
/** sRGB hex -> linear rgb triple. */
const lin = hex => { _c.set(hex); return [_c.r, _c.g, _c.b]; };

const COL = {
  sparkHot: lin(0xfff2c4), sparkCool: lin(0xff5a12),
  fireHot: lin(0xffeab0), fireMid: lin(0xffa040), fireCool: lin(0xff4a10),
  ember0: lin(0xff9a30), ember1: lin(0x8a1a04),
  smokeWarm: lin(0x6a4a34), smokeGray: lin(0x8a8a8c), smokeDark: lin(0x2c2c30), smokeLight: lin(0xcfcfd2),
  oil: lin(0x1c1c20),
  dustConcrete: lin(0xa9a49c), dustStone: lin(0xc2b8a4), dustDirt: lin(0x6a4c30), dustSand: lin(0xdcc08c),
  dustNeutral: lin(0xa8a196), wood: lin(0xb0783c), woodDark: lin(0x6a4020), sawdust: lin(0xd8b880),
  chipConcrete: lin(0x8c8a86), chipStone: lin(0xa89e8c), chipDirt: lin(0x54381f), chipGrass: lin(0x4a8a2a),
  glass: lin(0xd8f4ff),
  electric: lin(0x7ad8ff), electricDeep: lin(0x1a50ff),
  white: [1, 1, 1],
  gore: lin(0x2a2a30),
  debris: lin(0x9a948c),
};

const UP = new THREE.Vector3(0, 1, 0);
const DOWN = new THREE.Vector3(0, -1, 0);
const _o = new THREE.Vector3();
const _d = new THREE.Vector3();
const _t1 = new THREE.Vector3();
const _t2 = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _ax = new THREE.Vector3();
const _x = new THREE.Vector3(1, 0, 0);
const _rgb = [1, 1, 1];
const TINT_STONE = [1, 0.95, 0.85];
const TINT_SAND = [1.9, 1.6, 1.2];
const SURFACES = new Set(['metal', 'concrete', 'stone', 'wood', 'dirt', 'sand', 'glass', 'grass', 'energy']);

const rr = (a, b) => a + Math.random() * (b - a);
const pickFrame = (base, n) => base + Math.floor(Math.random() * n);

/**
 * Visual effects: pooled GPU particle layers, decals, tracers, light flashes, explosions, gibs.
 * See ARCHITECTURE.md section 6.9. All effect methods are safe no-ops before init().
 */
export class Effects {
  constructor(game) {
    this.game = game;
    this.time = 0;
    this._ready = false;
    this.gibList = [];
    this._heads = [];
    this._impactSound = { t: -1, n: 0 };
    this._surfaceSound = new Map();
    this._lightRef = null;
    this._lightMap = null;
    /** Live counters for tests / debugging. */
    this.stats = { smoke: 0, glow: 0, tracers: 0, decals: 0, gibs: 0, dropped: 0 };
  }

  /** Build atlases, materials, pools and the fixed light pool. */
  init() {
    if (this._ready) return;
    const scene = this.game.scene;
    const atlas = createParticleAtlas();
    const decalAtlas = createDecalAtlas();
    this.atlas = atlas;
    this.smokeMat = createParticleMaterial(atlas, { additive: false, lit: true });
    this.glowMat = createParticleMaterial(atlas, { additive: true, lit: false });
    this.tracerMat = createTracerMaterial();
    this.decalMat = createDecalMaterial(decalAtlas);

    this.decals = new DecalLayer(this.decalMat, Math.max(...Object.values(QUALITY_PRESETS).map(q => q.maxDecals)), SCORCH_CAP);
    this.smoke = new ParticleLayer(SMOKE_CAP, this.smokeMat, { sorted: true, renderOrder: 3 });
    this.glow = new ParticleLayer(GLOW_CAP, this.glowMat, { renderOrder: 4, gain: GLOW_GAIN });
    this.tracers = new TracerLayer(TRACER_CAP, this.tracerMat, 5);
    scene.add(this.decals.mesh, this.smoke.mesh, this.glow.mesh, this.tracers.mesh);
    this.beams = new BeamLayer(768);      // Tempest beam / chain arcs / generic bolts (see fx/Beams.js)
    scene.add(this.beams.mesh);

    // fixed pool of point lights (never added/removed at runtime)
    this.lights = [];
    for (let i = 0; i < LIGHT_POOL; i++) {
      const light = new THREE.PointLight(0xffffff, 0, 10, 2);
      light.castShadow = false;
      light.position.set(0, -500, 0);
      scene.add(light);
      this.lights.push({ light, t: 1, dur: 1, i0: 0 });
    }
    for (let i = 0; i < 8; i++) this._heads.push({ x: 0, y: 0, z: 0, t: -10, type: 0 });
    this._ready = true;
  }

  // ================================================================== frame update

  /** Advance all effects. */
  update(dt) {
    if (!this._ready) return;
    this.time += dt;
    const cam = this.game.camera;
    _fwd.set(0, 0, -1).applyQuaternion(cam.quaternion);
    this._syncLighting();
    const h = this.game.renderer && this.game.renderer.domElement ? this.game.renderer.domElement.height : 720;
    const px = (2 * Math.tan((cam.fov * Math.PI) / 360)) / Math.max(1, h);
    this.glowMat.uniforms.uPx.value = px;
    this.smokeMat.uniforms.uPx.value = px;
    this.smoke.update(dt, cam.position, _fwd);
    this.glow.update(dt, cam.position, _fwd);
    this.tracers.update(dt);
    this.beams.update(dt);
    this.decals.update(this.time);
    this._updateLights(dt);
    if (this.gibList.length) this._updateGibs(dt);
    const st = this.stats;
    st.smoke = this.smoke.count; st.glow = this.glow.count; st.tracers = this.tracers.count;
    st.decals = this.decals.liveCount; st.gibs = this.gibList.length;
    st.dropped = this.smoke.dropped + this.glow.dropped;
  }

  /** Remove every particle, decal, tracer, gib and light flash (new match). */
  clear() {
    if (!this._ready) return;
    this.smoke.clear();
    this.glow.clear();
    this.tracers.clear();
    this.beams.clear();
    this.decals.clear();
    for (const g of this.gibList) this.game.scene.remove(g.mesh);
    this.gibList.length = 0;
    for (const l of this.lights) { l.t = l.dur; l.light.intensity = 0; }
    for (const h of this._heads) h.t = -10;
    this._lightRef = null;
  }

  /** Match the smoke / decal tint to the current map lighting (cheap; runs only when the map changes). */
  _syncLighting() {
    const w = this.game.world;
    const L = w && w.lighting;
    if (!L || (L === this._lightRef && w.mapId === this._lightMap)) return;
    this._lightRef = L;
    this._lightMap = w.mapId;
    const hi = L.hemiIntensity ?? 0.8, si = L.sunIntensity ?? 2;
    const sky = L.hemiSky || { r: 0.6, g: 0.7, b: 1 };
    const gr = L.hemiGround || { r: 0.2, g: 0.15, b: 0.1 };
    const sun = L.sunColor || { r: 1, g: 1, b: 1 };
    const ch = k => Math.min(1.15, Math.max(0.3, sky[k] * hi * 0.55 + gr[k] * hi * 0.2 + sun[k] * si * 0.3));
    const r = ch('r'), g = ch('g'), b = ch('b');
    this.smokeMat.uniforms.uLight.value.set(r, g, b);
    const dk = v => Math.min(1, 0.55 + 0.45 * v);
    this.decalMat.uniforms.uLight.value.set(dk(r), dk(g), dk(b));
  }

  _cnt(n) {
    const q = this.game.quality;
    const sc = q && q.particleScale != null ? q.particleScale : 1;
    return Math.max(1, Math.round(n * sc));
  }

  /** Orthonormal tangents (_t1, _t2) around unit normal n. */
  _basis(n) {
    const ref = Math.abs(n.y) < 0.9 ? UP : _x;
    _t1.crossVectors(ref, n).normalize();
    _t2.crossVectors(n, _t1);
  }

  /** Random unit direction in a cone around n (uses _t1/_t2 from _basis). `minA` = min cos to the normal. */
  _cone(n, minA) {
    const a = minA + Math.random() * (1 - minA);
    const s = Math.sqrt(Math.max(0, 1 - a * a));
    const phi = Math.random() * TAU;
    const c = Math.cos(phi) * s, sn = Math.sin(phi) * s;
    return _d.set(n.x * a + _t1.x * c + _t2.x * sn, n.y * a + _t1.y * c + _t2.y * sn, n.z * a + _t1.z * c + _t2.z * sn);
  }

  /** World Y of the ground below (x, y, z) within `maxDist`, or -1e9. */
  _floorBelow(x, y, z, maxDist) {
    const w = this.game.world;
    if (!w || !w.raycast) return -1e9;
    _o.set(x, y + 0.3, z);
    const h = w.raycast(_o, DOWN, maxDist + 0.3);
    return h ? h.point.y : -1e9;
  }

  // ================================================================== emitters

  _spark(x, y, z, vx, vy, vz, life, size, hot, cool, o = null) {
    const p = this.glow.begin();
    if (!p) return;
    p.x = x; p.y = y; p.z = z; p.vx = vx; p.vy = vy; p.vz = vz;
    p.life = life; p.grav = o && o.grav != null ? o.grav : 14; p.drag = o && o.drag != null ? o.drag : 1.2;
    p.frame = F.STREAK; p.stretch = o && o.stretch != null ? o.stretch : 0.022;
    p.s0 = size; p.s1 = size * 0.5;
    p.c0(o && o.rgb0 ? o.rgb0 : COL.sparkHot, hot).c1(o && o.rgb1 ? o.rgb1 : COL.sparkCool, cool);
    p.fadePow = 0.8; p.fadeIn = 0.01;
    if (o && o.floor != null) { p.floor = o.floor; p.bounce = 0.42; }
    this.glow.commit();
  }

  _flash(x, y, z, size, life, rgb, k, frame = F.GLOW) {
    const p = this.glow.begin();
    if (!p) return;
    p.x = x; p.y = y; p.z = z;
    p.life = life; p.frame = frame;
    p.s0 = size; p.s1 = size * 0.55;
    p.rot = Math.random() * TAU;
    p.c0(rgb, k).c1(rgb, k * 0.4);
    p.fadePow = 1.6; p.fadeIn = 0.02;
    this.glow.commit();
  }

  _puff(x, y, z, vx, vy, vz, life, s0, s1, rgb, alpha, o = null) {
    const p = this.smoke.begin();
    if (!p) return;
    p.x = x; p.y = y; p.z = z; p.vx = vx; p.vy = vy; p.vz = vz;
    p.life = life; p.drag = o && o.drag != null ? o.drag : 2.2; p.grav = o && o.grav != null ? o.grav : 0;
    p.s0 = s0; p.s1 = s1; p.sizePow = o && o.sizePow != null ? o.sizePow : 0.6;
    p.frame = o && o.frame != null ? o.frame : pickFrame(F.SMOKE0, 4);
    p.rot = Math.random() * TAU; p.spin = rr(-0.8, 0.8);
    p.c0(rgb, 1, alpha);
    if (o && o.rgb1) p.c1(o.rgb1, 1); else p.c1(rgb, 0.7);
    p.fadeIn = o && o.fadeIn != null ? o.fadeIn : 0.1;
    p.fadePow = o && o.fadePow != null ? o.fadePow : 1.2;
    if (o && o.floor != null) { p.floor = o.floor; p.bounce = -1; }
    this.smoke.commit();
  }

  /** Solid chip / shard sprite (alpha-blended, tumbles). */
  _chip(x, y, z, vx, vy, vz, life, size, rgb, o = null) {
    const p = this.smoke.begin();
    if (!p) return;
    p.x = x; p.y = y; p.z = z; p.vx = vx; p.vy = vy; p.vz = vz;
    p.life = life; p.drag = o && o.drag != null ? o.drag : 0.3; p.grav = o && o.grav != null ? o.grav : 18;
    p.s0 = size; p.s1 = size * 0.85;
    p.frame = o && o.frame != null ? o.frame : F.DEBRIS0 + (Math.random() < 0.5 ? 0 : 1);
    p.rot = Math.random() * TAU; p.spin = rr(-14, 14);
    p.c0(rgb, rr(0.75, 1.1), 1).c1(rgb, 0.8);
    p.fadeIn = 0.01; p.fadePow = 0.35;
    if (o && o.floor != null) { p.floor = o.floor; p.bounce = 0.35; }
    this.smoke.commit();
  }

  /** Bright electric zap sprite. */
  _zap(x, y, z, size, life) {
    const p = this.glow.begin();
    if (!p) return;
    p.x = x; p.y = y; p.z = z;
    p.life = life; p.frame = F.ZAP;
    p.s0 = size; p.s1 = size * 1.2; p.rot = Math.random() * TAU;
    p.c0(COL.electric, 3.2).c1(COL.electricDeep, 1.5);
    p.fadePow = 0.8; p.fadeIn = 0.01;
    this.glow.commit();
  }

  /** Flat disc facing the normal (shock rings). */
  _ring(x, y, z, nx, ny, nz, s0, s1, life, rgb0, k0, rgb1, k1, alpha, layer = this.glow) {
    const p = layer.begin();
    if (!p) return;
    p.x = x; p.y = y; p.z = z; p.vx = nx; p.vy = ny; p.vz = nz;
    p.life = life; p.frame = F.RING; p.stretch = -1;
    p.s0 = s0; p.s1 = s1; p.sizePow = 0.45;
    p.rot = Math.random() * TAU;
    p.c0(rgb0, k0, alpha).c1(rgb1, k1);
    p.fadePow = 1.4; p.fadeIn = 0.01;
    layer.commit();
  }

  _decal(frame, px, py, pz, n, size, rgb, alpha, life, scorch) {
    const q = this.game.quality;
    this.decals.add(frame, px, py, pz, n.x, n.y, n.z, size, rgb[0], rgb[1], rgb[2], alpha, this.time, life, scorch,
      q && q.maxDecals != null ? q.maxDecals : 100);
  }

  _playImpactSound(surface, point) {
    const audio = this.game.audio;
    if (!audio) return;
    const s = this._impactSound;
    if (this.time - s.t > 0.06) { s.t = this.time; s.n = 0; }
    if (s.n >= 3) return;
    const last = this._surfaceSound.get(surface);
    if (last !== undefined && this.time - last < 0.03) return;
    s.n++;
    this._surfaceSound.set(surface, this.time);
    audio.play('impact_' + surface, { position: point });
  }

  // ================================================================== impacts

  /**
   * World bullet impact: per-surface particles, bullet-hole decal and a throttled positional sound.
   * @param {THREE.Vector3} point
   * @param {THREE.Vector3} normal unit surface normal
   * @param {string} surface metal|concrete|stone|wood|dirt|sand|glass|grass|energy
   */
  impact(point, normal, surface) {
    if (!this._ready) return;
    const px = point.x, py = point.y, pz = point.z;
    const n = normal && normal.lengthSq() > 0.25 ? normal : UP;
    if (!SURFACES.has(surface)) surface = 'concrete';
    this._basis(n);
    const lift = 0.03;
    const x = px + n.x * lift, y = py + n.y * lift, z = pz + n.z * lift;
    let decal = D.HOLE_CONCRETE, tint = COL.white, dsize = rr(0.2, 0.3), dalpha = 0.92;

    switch (surface) {
      case 'metal': {
        decal = D.HOLE_METAL; dsize = rr(0.18, 0.26);
        const ns = this._cnt(9);
        for (let i = 0; i < ns; i++) {
          const d = this._cone(n, 0.12);
          const sp = rr(4, 16);
          this._spark(x, y, z, d.x * sp, d.y * sp, d.z * sp, rr(0.22, 0.55), rr(0.07, 0.1), 3.4, 1.3);
        }
        this._flash(x, y, z, 0.75, 0.06, COL.fireHot, 2.6);
        this._puff(x, y, z, n.x * 0.5, n.y * 0.5 + 0.35, n.z * 0.5, rr(0.4, 0.7), 0.1, 0.42, COL.smokeLight, 0.28);
        break;
      }
      case 'stone': {
        decal = D.HOLE_CONCRETE; tint = TINT_STONE;
        this._dustBurst(x, y, z, n, COL.dustStone, 2, 0.8);
        this._chips(x, y, z, n, COL.chipStone, 6);
        if (Math.random() < 0.6) {
          const d = this._cone(n, 0.3); const sp = rr(3, 9);
          this._spark(x, y, z, d.x * sp, d.y * sp, d.z * sp, rr(0.15, 0.3), 0.035, 2.4, 1);
        }
        break;
      }
      case 'wood': {
        decal = D.HOLE_WOOD; dsize = rr(0.2, 0.28);
        const nsp = this._cnt(6);
        for (let i = 0; i < nsp; i++) {
          const d = this._cone(n, 0.25);
          const sp = rr(2.5, 8);
          const p = this.smoke.begin();
          if (!p) break;
          p.x = x; p.y = y; p.z = z; p.vx = d.x * sp; p.vy = d.y * sp; p.vz = d.z * sp;
          p.life = rr(0.3, 0.6); p.grav = 12; p.drag = 0.8;
          p.frame = F.SPLINTER; p.stretch = 0.02;
          p.s0 = rr(0.03, 0.05); p.s1 = p.s0;
          p.c0(Math.random() < 0.5 ? COL.wood : COL.woodDark, rr(0.85, 1.15), 1).c1(COL.woodDark, 1);
          p.fadeIn = 0.01; p.fadePow = 0.4;
          this.smoke.commit();
        }
        this._puff(x, y, z, n.x * 0.8, n.y * 0.8 + 0.2, n.z * 0.8, rr(0.4, 0.7), 0.08, 0.35, COL.sawdust, 0.32);
        break;
      }
      case 'dirt':
      case 'grass': {
        decal = D.HOLE_DIRT; dsize = rr(0.3, 0.42); dalpha = 0.8;
        this._dustBurst(x, y, z, n, COL.dustDirt, 2, 0.9);
        this._chips(x, y, z, n, surface === 'grass' ? COL.chipGrass : COL.chipDirt, surface === 'grass' ? 4 : 5);
        break;
      }
      case 'sand': {
        decal = D.HOLE_DIRT; dsize = rr(0.3, 0.42); tint = TINT_SAND; dalpha = 0.55;
        this._dustBurst(x, y, z, n, COL.dustSand, 3, 1.1);
        const ng = this._cnt(7);
        for (let i = 0; i < ng; i++) {
          const d = this._cone(n, 0.3); const sp = rr(1.5, 5);
          this._chip(x, y, z, d.x * sp, d.y * sp, d.z * sp, rr(0.3, 0.6), rr(0.02, 0.035), COL.dustSand, { frame: F.DOT, grav: 10 });
        }
        break;
      }
      case 'glass': {
        decal = D.GLASS; dsize = rr(0.42, 0.6); dalpha = 0.85;
        const nsh = this._cnt(8);
        for (let i = 0; i < nsh; i++) {
          const d = this._cone(n, 0.1); const sp = rr(2, 8);
          this._chip(x, y, z, d.x * sp, d.y * sp, d.z * sp, rr(0.4, 0.8), rr(0.03, 0.06), COL.glass, { frame: F.DEBRIS1, grav: 16 });
        }
        for (let i = 0; i < 3; i++) {
          this._flash(x + rr(-0.1, 0.1), y + rr(-0.1, 0.1), z + rr(-0.1, 0.1), rr(0.07, 0.14), rr(0.12, 0.25), COL.white, 3, F.STAR);
        }
        break;
      }
      case 'energy': {
        decal = D.SCORCH_ENERGY; dsize = rr(0.28, 0.4); tint = COL.white;
        const ne = this._cnt(7);
        for (let i = 0; i < ne; i++) {
          const d = this._cone(n, 0.1); const sp = rr(5, 14);
          this._spark(x, y, z, d.x * sp, d.y * sp, d.z * sp, rr(0.14, 0.3), 0.04, 3, 1.5,
            { grav: 3, drag: 3, stretch: 0.03, rgb0: COL.electric, rgb1: COL.electricDeep });
        }
        this._flash(x, y, z, 0.6, 0.09, COL.electric, 2.6);
        this._zap(x + n.x * 0.1, y + n.y * 0.1, z + n.z * 0.1, rr(0.5, 0.9), rr(0.08, 0.14));
        this._zap(x + n.x * 0.1, y + n.y * 0.1, z + n.z * 0.1, rr(0.4, 0.7), rr(0.06, 0.1));
        this._ring(x, y, z, n.x, n.y, n.z, 0.1, 0.55, 0.16, COL.electric, 2.2, COL.electricDeep, 0.8, 0.9);
        break;
      }
      case 'concrete':
      default: {
        this._dustBurst(x, y, z, n, COL.dustConcrete, 2, 0.8);
        this._chips(x, y, z, n, COL.chipConcrete, 5);
        if (Math.random() < 0.35) {
          const d = this._cone(n, 0.3); const sp = rr(3, 8);
          this._spark(x, y, z, d.x * sp, d.y * sp, d.z * sp, rr(0.12, 0.25), 0.03, 2.2, 1);
        }
        break;
      }
    }
    this._decal(decal, px, py, pz, n, dsize, tint, dalpha, 40, false);
    this._playImpactSound(surface, point);
  }

  _dustBurst(x, y, z, n, rgb, count, size) {
    for (let i = 0; i < count; i++) {
      const d = this._cone(n, 0.4);
      const sp = rr(0.6, 1.8);
      this._puff(x, y, z, d.x * sp, d.y * sp + 0.15, d.z * sp, rr(0.55, 0.95), size * 0.3, size * rr(0.8, 1.2), rgb, rr(0.3, 0.45),
        { drag: 3, sizePow: 0.5 });
    }
  }

  _chips(x, y, z, n, rgb, count) {
    const c = this._cnt(count);
    for (let i = 0; i < c; i++) {
      const d = this._cone(n, 0.25);
      const sp = rr(2.5, 8);
      this._chip(x, y, z, d.x * sp, d.y * sp, d.z * sp, rr(0.4, 0.8), rr(0.045, 0.09), rgb);
    }
  }

  /**
   * Bullet hit on a robot: hot sparks, electric zaps, oil smoke and a hit flash on the model.
   * @param {THREE.Vector3} point
   * @param {THREE.Vector3} normal
   * @param {object} entity the entity that was hit (its model flashes)
   */
  hitSpark(point, normal, entity) {
    if (entity && entity.model && typeof entity.model.flashHit === 'function') entity.model.flashHit();
    if (!this._ready) return;
    if (entity && entity === this.game.player) return; // the HUD handles feedback for the local player
    const n = normal && normal.lengthSq() > 0.25 ? normal : UP;
    this._basis(n);
    const x = point.x + n.x * 0.04, y = point.y + n.y * 0.04, z = point.z + n.z * 0.04;
    const ns = this._cnt(8);
    for (let i = 0; i < ns; i++) {
      const d = this._cone(n, 0.0);
      const sp = rr(3, 11);
      this._spark(x, y, z, d.x * sp, d.y * sp, d.z * sp, rr(0.2, 0.5), rr(0.06, 0.09), 3.6, 1.4);
    }
    this._flash(x, y, z, 0.75, 0.055, COL.fireHot, 2.4);
    if (Math.random() < 0.7) this._zap(x, y, z, rr(0.35, 0.6), rr(0.05, 0.1));
    this._puff(x, y, z, n.x * 0.5, n.y * 0.5 + 0.5, n.z * 0.5, rr(0.5, 0.9), 0.1, 0.42, COL.oil, 0.5, { rgb1: COL.smokeDark });
    if (Math.random() < 0.5) {
      const d = this._cone(n, 0.2); const sp = rr(1.5, 4);
      this._chip(x, y, z, d.x * sp, d.y * sp, d.z * sp, rr(0.4, 0.7), rr(0.02, 0.04), COL.oil, { frame: F.DOT, grav: 12 });
    }
    const audio = this.game.audio;
    if (audio && this.time - (this._robotHitT ?? -1) > 0.035) {
      this._robotHitT = this.time;
      audio.play('impact_robot', { position: point });
    }
  }

  // ================================================================== tracers, muzzle flashes, lights

  /**
   * Bright bullet streak from the muzzle to the impact point.
   * @param {THREE.Vector3} from
   * @param {THREE.Vector3} to
   * @param {{color?:number|string, width?:number}} [o]
   */
  tracer(from, to, { color = 0xffd890, width = 0.05 } = {}) {
    if (!this._ready) return;
    _c.set(color);
    const k = TRACER_GAIN;
    this.tracers.add(from.x, from.y, from.z, to.x, to.y, to.z, _c.r * k, _c.g * k, _c.b * k, width, 1);
  }

  // ---- energy beams & blasts (Tempest / Gale; implemented in fx/Beams.js)

  /**
   * Continuous lightning beam: re-call every tick / frame with the same key, it fades 0.08 s after the last call.
   * @param {string} key
   * @param {THREE.Vector3} from
   * @param {THREE.Vector3} to
   * @param {{color?:number, core?:number, width?:number, jitter?:number, forks?:number, life?:number}} [o]
   */
  channel(key, from, to, o) {
    if (this._ready) this.beams.channel(key, from, to, o);
  }

  /**
   * One-shot fading lightning bolt (chain arcs, storm strikes).
   * @param {THREE.Vector3} from
   * @param {THREE.Vector3} to
   * @param {{color?:number, core?:number, width?:number, life?:number, jitter?:number, forks?:number, restrike?:number[]}} [o]
   */
  lightning(from, to, o) {
    if (this._ready) this.beams.bolt(from, to, o);
  }

  /** Tempest impact (world or robot): zap, sparks, energy scorch, robot hit flash. */
  arcHit(point, normal, entity) {
    arcHitFx(this, point, normal, entity);
  }

  /** Gale cone blast visuals (rings, wind streaks, light). */
  galeBlast(origin, dir, o) {
    galeBlastFx(this, origin, dir, o);
  }

  /** Small cyan (or white) shock ring at a point: shoved target, reflected projectile, wall splat. */
  galeRing(point, normal, o) {
    galeRingFx(this, point, normal, o);
  }

  /**
   * World-space muzzle flash (bots): star + streak + glow, a smoke wisp and a pooled light.
   * @param {THREE.Vector3} position muzzle position
   * @param {THREE.Vector3} direction unit aim direction
   * @param {{scale?:number, color?:number|string}} [o]
   */
  muzzleFlash(position, direction, { scale = 1, color = 0xffc070 } = {}) {
    if (!this._ready) return;
    const px = position.x, py = position.y, pz = position.z;
    const dx = direction.x, dy = direction.y, dz = direction.z;
    _c.set(color);
    const rgb = _rgb;
    rgb[0] = _c.r; rgb[1] = _c.g; rgb[2] = _c.b;
    // star
    let p = this.glow.begin();
    if (p) {
      p.x = px + dx * 0.08; p.y = py + dy * 0.08; p.z = pz + dz * 0.08;
      p.life = 0.05; p.frame = F.STAR; p.s0 = 1.3 * scale; p.s1 = 1.7 * scale; p.rot = Math.random() * TAU;
      p.c0(rgb, 3.6).c1(rgb, 1.4); p.fadePow = 1; p.fadeIn = 0.01;
      this.glow.commit();
    }
    // forward streak
    p = this.glow.begin();
    if (p) {
      p.x = px; p.y = py; p.z = pz; p.vx = dx * 30; p.vy = dy * 30; p.vz = dz * 30;
      p.life = 0.045; p.frame = F.STREAK; p.stretch = 0.03; p.s0 = 0.28 * scale; p.s1 = 0.18 * scale;
      p.c0(rgb, 3.2).c1(rgb, 1.2); p.fadePow = 1; p.fadeIn = 0.01;
      this.glow.commit();
    }
    this._flash(px + dx * 0.1, py + dy * 0.1, pz + dz * 0.1, 0.9 * scale, 0.06, rgb, 2.2);
    this._puff(px + dx * 0.15, py + dy * 0.15, pz + dz * 0.15, dx * 1.6, dy * 1.6 + 0.2, dz * 1.6, rr(0.4, 0.7), 0.06 * scale, 0.28 * scale, COL.smokeLight, 0.2);
    this.flashLight(_o.set(px + dx * 0.5, py + dy * 0.5, pz + dz * 0.5), color, 26 * scale * FLASH_LIGHT_SCALE, 9 * scale, 0.06);
  }

  /**
   * Pooled point light flash (fixed pool of 4; the weakest active flash is replaced).
   * @param {THREE.Vector3} position
   * @param {number|string|THREE.Color} color
   * @param {number} intensity candela at peak
   * @param {number} distance cutoff distance
   * @param {number} duration seconds
   */
  flashLight(position, color, intensity, distance, duration) {
    if (!this._ready) return;
    let slot = null, weakest = Infinity;
    for (const l of this.lights) {
      const cur = l.t >= l.dur ? 0 : l.light.intensity;
      if (cur < weakest) { weakest = cur; slot = l; }
    }
    if (!slot || weakest > intensity) return;
    slot.t = 0;
    slot.dur = Math.max(0.02, duration);
    slot.i0 = intensity;
    const light = slot.light;
    light.position.copy(position);
    light.color.set(color);
    light.distance = distance;
    light.intensity = intensity;
  }

  _updateLights(dt) {
    for (const l of this.lights) {
      if (l.t >= l.dur) continue;
      l.t += dt;
      const k = 1 - l.t / l.dur;
      l.light.intensity = k > 0 ? l.i0 * k * k : 0;
      if (k <= 0) l.t = l.dur;
    }
  }

  // ================================================================== explosions

  /**
   * 0.2..1 multiplier for the brightness of a big additive flash at (x, y, z) of radius R: full strength when the
   * camera is more than ~2.4 R away, fading smoothly to 20 % as it closes in, so an explosion (or a robot bursting)
   * right next to the player reads as a bright orange glow instead of a white-out.
   */
  _glareScale(x, y, z, R) {
    const c = this.game.camera.position;
    const t = Math.min(1, Math.hypot(c.x - x, c.y - y, c.z - z) / (R * 2.4));
    return 0.2 + 0.8 * t * t * (3 - 2 * t);
  }

  /**
   * Big explosion: fireball, smoke column, sparks, embers, debris, shock ring, scorch decal, light
   * flash and distance-scaled camera shake. (The sound is played by the caller.)
   * @param {THREE.Vector3} position
   * @param {{radius?:number, normal?:THREE.Vector3}} [o]
   */
  explosion(position, { radius = 5, normal = null } = {}) {
    if (!this._ready) return;
    const R = radius, k = R / 5;
    const x = position.x, y = position.y, z = position.z;
    const floorY = this._floorBelow(x, y, z, R * 2.2 + 1);
    const hasFloor = floorY > -1e8;
    const nx = normal ? normal.x : 0, ny = normal ? normal.y : 1, nz = normal ? normal.z : 0;

    // flash + core glow (brightness scaled down when the camera is close to the blast)
    const gl = this._glareScale(x, y, z, R);
    this._flash(x, y, z, R * 2.0, 0.08, COL.fireHot, 2.6 * gl);
    this._flash(x, y, z, R * 2.8, 0.3, COL.fireMid, 0.55 * gl);
    {
      const p = this.glow.begin();
      if (p) {
        p.x = x; p.y = y + R * 0.1; p.z = z; p.life = 0.5; p.frame = F.FIRE0; p.rot = Math.random() * TAU; p.spin = 0.4;
        p.s0 = R * 0.9; p.s1 = R * 2.0; p.sizePow = 0.5;
        p.c0(COL.fireHot, 1.7 * gl, 0.9).c1(COL.fireCool, 0.7 * gl); p.fadePow = 1.4; p.fadeIn = 0.02;
        if (hasFloor) { p.floor = floorY; p.bounce = -1; }
        this.glow.commit();
      }
    }
    // fireball
    const nf = this._cnt(18);
    for (let i = 0; i < nf; i++) {
      const p = this.glow.begin();
      if (!p) break;
      const a = Math.random() * TAU, e = rr(-0.3, 1.0), ce = Math.sqrt(1 - e * e * 0.5);
      const sp = rr(0.8, 2.8) * R * 0.6;
      p.x = x + Math.cos(a) * R * 0.15; p.y = y + rr(0, R * 0.2); p.z = z + Math.sin(a) * R * 0.15;
      p.vx = Math.cos(a) * ce * sp; p.vy = e * sp + R * 0.5; p.vz = Math.sin(a) * ce * sp;
      p.drag = 2.4; p.grav = -1.5;
      p.life = rr(0.45, 1.0); p.frame = pickFrame(F.FIRE0, 2); p.rot = Math.random() * TAU; p.spin = rr(-1.2, 1.2);
      p.s0 = R * rr(0.35, 0.65); p.s1 = R * rr(1.0, 1.6); p.sizePow = 0.55;
      p.c0(Math.random() < 0.4 ? COL.fireHot : COL.fireMid, rr(1.2, 1.9) * gl, 0.85).c1(COL.fireCool, 0.55 * gl);
      p.fadePow = 1.5; p.fadeIn = 0.03;
      if (hasFloor) { p.floor = floorY; p.bounce = -1; }
      this.glow.commit();
    }
    // smoke column
    const ns = this._cnt(22);
    for (let i = 0; i < ns; i++) {
      const a = Math.random() * TAU, rad = rr(0, R * 0.4);
      const dark = Math.random() < 0.6;
      this._puff(x + Math.cos(a) * rad, y + rr(0, R * 0.35), z + Math.sin(a) * rad,
        Math.cos(a) * rr(0.2, 1.8) * k, rr(1.6, 5.2) * Math.sqrt(k), Math.sin(a) * rr(0.2, 1.8) * k,
        rr(2.0, 3.8), R * rr(0.35, 0.6), R * rr(1.2, 2.1), dark ? COL.smokeWarm : COL.smokeGray, rr(0.5, 0.8),
        { rgb1: dark ? COL.smokeDark : COL.smokeGray, drag: 1.3, sizePow: 0.55, fadeIn: 0.12, fadePow: 1.3, floor: hasFloor ? floorY : undefined });
    }
    // sparks + embers
    const nsp = this._cnt(40);
    const sk = Math.sqrt(k);
    for (let i = 0; i < nsp; i++) {
      const a = Math.random() * TAU, e = rr(-0.05, 1.0), ce = Math.sqrt(1 - e * e);
      const sp = rr(6, 26) * sk;
      this._spark(x, y, z, Math.cos(a) * ce * sp, e * sp + 2, Math.sin(a) * ce * sp, rr(0.7, 1.7), rr(0.12, 0.2), 4.2, 1.3,
        { grav: 14, drag: 0.5, stretch: 0.05, floor: hasFloor ? floorY : undefined });
    }
    const ne = this._cnt(12);
    for (let i = 0; i < ne; i++) {
      const p = this.glow.begin();
      if (!p) break;
      const a = Math.random() * TAU, sp = rr(1, 5) * sk;
      p.x = x + rr(-0.5, 0.5); p.y = y + rr(0, 0.6); p.z = z + rr(-0.5, 0.5);
      p.vx = Math.cos(a) * sp; p.vy = rr(1.5, 5); p.vz = Math.sin(a) * sp;
      p.drag = 1.2; p.grav = -0.8; p.life = rr(1.5, 3);
      p.frame = F.DOT; p.s0 = rr(0.07, 0.13); p.s1 = 0.03;
      p.c0(COL.ember0, 2.8).c1(COL.ember1, 0.4); p.fadePow = 0.9; p.fadeIn = 0.02;
      this.glow.commit();
    }
    // debris chunks
    const nd = this._cnt(18);
    for (let i = 0; i < nd; i++) {
      const a = Math.random() * TAU, e = rr(0.1, 1.0), ce = Math.sqrt(1 - e * e);
      const sp = rr(5, 17) * sk;
      this._chip(x, y, z, Math.cos(a) * ce * sp, e * sp + 3, Math.sin(a) * ce * sp, rr(1.0, 2.2), rr(0.22, 0.55) * Math.sqrt(k), COL.debris,
        { grav: 20, drag: 0.15, floor: hasFloor ? floorY : undefined });
    }
    // shock ring (surface aligned) + ground dust ring
    this._ring(x, y, z, nx, ny, nz, 0.6, R * 3.0, 0.3, COL.fireHot, 1.4 * gl, COL.electric, 0.7 * gl, 0.7);
    if (hasFloor && y - floorY < R * 1.5) {
      this._ring(x, floorY + 0.06, z, 0, 1, 0, 0.8, R * 4.2, 0.7, COL.dustNeutral, 1, COL.dustNeutral, 0.8, 0.28, this.smoke);
      const nr = this._cnt(9);
      for (let i = 0; i < nr; i++) {
        const a = (i / nr) * TAU + rr(-0.2, 0.2), sp = rr(4, 9) * sk;
        this._puff(x + Math.cos(a) * R * 0.3, floorY + 0.3, z + Math.sin(a) * R * 0.3,
          Math.cos(a) * sp, rr(0.2, 0.8), Math.sin(a) * sp, rr(0.9, 1.6), R * 0.25, R * rr(0.7, 1.1), COL.dustNeutral, rr(0.3, 0.4),
          { drag: 2.8, sizePow: 0.5, floor: floorY });
      }
    }
    // scorch decal: only on a surface a short ray confirms behind the burst (the caller's normal can be an entity
    // hit or a stale grenade contact normal with nothing behind it); otherwise fall back to the floor below
    const w = this.game.world;
    let scorched = false;
    if (normal && w && w.raycast) {
      _d.set(-nx, -ny, -nz);
      const sh = w.raycast(position, _d, 0.45);
      if (sh) {
        this._decal(pickFrame(D.SCORCH_BLAST, 2), sh.point.x, sh.point.y, sh.point.z, sh.normal, R * rr(1.3, 1.7), COL.white, 0.95, 90, true);
        scorched = true;
      }
    }
    if (!scorched && hasFloor && y - floorY < R * 0.9) {
      this._decal(pickFrame(D.SCORCH_BLAST, 2), x, floorY, z, UP, R * rr(1.3, 1.7), COL.white, 0.95, 90, true);
    }
    // light + camera shake
    this.flashLight(_o.set(x + nx * 0.9, y + ny * 0.9, z + nz * 0.9), 0xffa050, 220 * FLASH_LIGHT_SCALE * Math.max(0.5, k) * (0.3 + 0.7 * gl), R * 8, 0.45);
    const g = this.game;
    const pl = g.player;
    if (pl && typeof pl.addShake === 'function' && pl.alive !== false) {
      const cp = g.camera.position;
      const dist = Math.hypot(cp.x - x, cp.y - y, cp.z - z);
      const f = Math.max(0, 1 - dist / (R * 6));
      const amount = Math.min(1, f * f * (0.5 + 0.09 * R));
      if (amount > 0.01) pl.addShake(amount);
    }
  }

  // ================================================================== trails

  /**
   * Trail emitter, called every frame while a projectile is alive.
   * @param {THREE.Vector3} position current projectile position
   * @param {{type?:'rocket'|'grenade'}} [o]
   */
  trail(position, { type = 'rocket' } = {}) {
    if (!this._ready) return;
    const tcode = type === 'grenade' ? 2 : 1;
    let head = null, best = 36;
    for (const h of this._heads) {
      if (h.type !== tcode || this.time - h.t > 0.2) continue;
      const d2 = (h.x - position.x) ** 2 + (h.y - position.y) ** 2 + (h.z - position.z) ** 2;
      if (d2 < best) { best = d2; head = h; }
    }
    let fresh = false;
    if (!head) {
      fresh = true;
      let oldest = this._heads[0];
      for (const h of this._heads) if (h.t < oldest.t) oldest = h;
      head = oldest;
      head.x = position.x; head.y = position.y; head.z = position.z;
    }
    const sx = head.x, sy = head.y, sz = head.z;
    const dx = position.x - sx, dy = position.y - sy, dz = position.z - sz;
    const dist = Math.hypot(dx, dy, dz);
    const sc = this.game.quality && this.game.quality.particleScale != null ? this.game.quality.particleScale : 1;
    const spacing = (type === 'grenade' ? 0.28 : 0.2) / Math.max(0.4, sc);
    const steps = fresh ? 1 : Math.max(1, Math.min(12, Math.ceil(dist / spacing)));
    for (let i = 1; i <= steps; i++) {
      const u = i / steps;
      const x = sx + dx * u, y = sy + dy * u, z = sz + dz * u;
      if (type === 'grenade') {
        this._puff(x, y, z, rr(-0.15, 0.15), rr(0.05, 0.25), rr(-0.15, 0.15), rr(0.45, 0.75), 0.06, 0.24, COL.smokeLight, 0.2,
          { drag: 1.5, fadePow: 1.3, fadeIn: 0.15 });
        if (Math.random() < 0.08) this._spark(x, y, z, rr(-1, 1), rr(0.5, 2), rr(-1, 1), rr(0.15, 0.3), 0.03, 2, 0.8, { grav: 8 });
      } else {
        this._puff(x + rr(-0.05, 0.05), y + rr(-0.05, 0.05), z + rr(-0.05, 0.05), rr(-0.35, 0.35), rr(0.05, 0.4), rr(-0.35, 0.35),
          rr(0.9, 1.5), 0.2, rr(0.7, 1.05), COL.smokeLight, rr(0.4, 0.55),
          { drag: 1.2, fadePow: 1.4, fadeIn: 0.08, rgb1: COL.smokeGray });
        const p = this.glow.begin();
        if (p) {
          p.x = x; p.y = y; p.z = z; p.vx = rr(-0.3, 0.3); p.vy = rr(-0.3, 0.3); p.vz = rr(-0.3, 0.3);
          p.life = rr(0.1, 0.18); p.frame = F.GLOW; p.s0 = rr(0.34, 0.5); p.s1 = 0.06;
          p.c0(COL.fireMid, 3).c1(COL.fireCool, 0.8); p.fadePow = 1.2; p.fadeIn = 0.02;
          this.glow.commit();
        }
        if (Math.random() < 0.35) {
          this._spark(x, y, z, rr(-2.5, 2.5), rr(-1.5, 2.5), rr(-2.5, 2.5), rr(0.2, 0.45), 0.035, 3, 1, { grav: 10, stretch: 0.03 });
        }
      }
    }
    if (type !== 'grenade') this._flash(position.x, position.y, position.z, 0.7, 0.05, COL.fireMid, 2.4);
    head.x = position.x; head.y = position.y; head.z = position.z;
    head.t = this.time; head.type = tcode;
  }

  // ================================================================== gibs

  /**
   * Robot death: burst of sparks/smoke plus physically simulated body pieces.
   * @param {THREE.Mesh[]} meshes world-transformed clones (shared geometry/material - never disposed)
   * @param {{velocity?:THREE.Vector3, direction?:THREE.Vector3, point?:THREE.Vector3}} [o]
   */
  gibs(meshes, { velocity = null, direction = null, point = null } = {}) {
    if (!this._ready) return;
    const list = meshes || [];
    let cx = 0, cy = 0, cz = 0;
    if (point) { cx = point.x; cy = point.y; cz = point.z; }
    else if (list.length) {
      for (const m of list) { cx += m.position.x; cy += m.position.y; cz += m.position.z; }
      cx /= list.length; cy /= list.length; cz /= list.length;
    }
    this._robotBurst(cx, cy, cz);
    const scene = this.game.scene;
    while (this.gibList.length + list.length > GIB_LIMIT && this.gibList.length) {
      scene.remove(this.gibList.shift().mesh);
    }
    for (const mesh of list) {
      if (!mesh.matrixAutoUpdate) {
        // the caller supplied a baked world matrix: convert it so the mesh can be simulated
        mesh.matrix.decompose(mesh.position, mesh.quaternion, mesh.scale);
        mesh.matrixAutoUpdate = true;
      }
      mesh.visible = true;
      mesh.castShadow = false;   // ~12 short-lived pieces per death: a shadow draw call each is not worth it
      const geo = mesh.geometry;
      if (geo && !geo.boundingSphere) geo.computeBoundingSphere();
      const sc = Math.max(mesh.scale.x, mesh.scale.y, mesh.scale.z);
      const radius = Math.min(0.4, Math.max(0.05, (geo && geo.boundingSphere ? geo.boundingSphere.radius : 0.15) * sc));
      _d.set(mesh.position.x - cx, mesh.position.y - cy, mesh.position.z - cz);
      if (_d.lengthSq() < 1e-4) _d.set(rr(-1, 1), rr(0, 1), rr(-1, 1));
      _d.normalize();
      const heavy = Math.min(1.3, Math.max(0.55, 0.32 / radius));
      const sp = rr(3, 8) * heavy;
      const push = direction ? rr(2, 6) : 0;
      const vel = velocity ? 0.7 : 0;
      const g = {
        mesh, radius, age: 0, life: rr(3.4, 4.4), rest: false,
        vx: _d.x * sp + (direction ? direction.x * push : 0) + (velocity ? velocity.x * vel : 0),
        vy: _d.y * sp + rr(2, 5.5) + (direction ? direction.y * push : 0) + (velocity ? velocity.y * vel : 0),
        vz: _d.z * sp + (direction ? direction.z * push : 0) + (velocity ? velocity.z * vel : 0),
        ax: rr(-1, 1), ay: rr(-1, 1), az: rr(-1, 1), w: rr(5, 14),
        scale0: mesh.scale.clone(), smoke: rr(2, 5), lastSound: -1,
      };
      const al = Math.hypot(g.ax, g.ay, g.az) || 1;
      g.ax /= al; g.ay /= al; g.az /= al;
      scene.add(mesh);
      this.gibList.push(g);
    }
  }

  _robotBurst(x, y, z) {
    const floorY = this._floorBelow(x, y, z, 6);
    const hasFloor = floorY > -1e8;
    const gl = this._glareScale(x, y, z, 1.6);
    this._flash(x, y, z, 1.6, 0.12, COL.fireHot, 3.6 * gl);
    this._flash(x, y, z, 2.6, 0.22, COL.fireMid, 1.2 * gl);
    const ns = this._cnt(20);
    for (let i = 0; i < ns; i++) {
      const a = Math.random() * TAU, e = rr(-0.3, 1), ce = Math.sqrt(1 - e * e);
      const sp = rr(4, 14);
      this._spark(x, y, z, Math.cos(a) * ce * sp, e * sp + 1.5, Math.sin(a) * ce * sp, rr(0.4, 1.0), rr(0.045, 0.07), 3.4, 1.2,
        { grav: 14, drag: 0.6, floor: hasFloor ? floorY : undefined });
    }
    const nz = this._cnt(3);
    for (let i = 0; i < nz; i++) this._zap(x + rr(-0.3, 0.3), y + rr(-0.4, 0.4), z + rr(-0.3, 0.3), rr(0.8, 1.5), rr(0.1, 0.2));
    const np = this._cnt(6);
    for (let i = 0; i < np; i++) {
      const a = Math.random() * TAU;
      this._puff(x + rr(-0.2, 0.2), y + rr(-0.2, 0.3), z + rr(-0.2, 0.2), Math.cos(a) * rr(0.3, 1.4), rr(0.8, 2.2), Math.sin(a) * rr(0.3, 1.4),
        rr(1.0, 1.7), 0.3, rr(0.9, 1.4), COL.smokeDark, rr(0.5, 0.7), { rgb1: COL.oil, drag: 1.5, floor: hasFloor ? floorY : undefined });
    }
    const ne = this._cnt(6);
    for (let i = 0; i < ne; i++) {
      const p = this.glow.begin();
      if (!p) break;
      p.x = x + rr(-0.3, 0.3); p.y = y + rr(-0.3, 0.3); p.z = z + rr(-0.3, 0.3);
      p.vx = rr(-2, 2); p.vy = rr(1, 4); p.vz = rr(-2, 2);
      p.drag = 1.2; p.grav = -0.5; p.life = rr(1, 2); p.frame = F.DOT; p.s0 = rr(0.04, 0.08); p.s1 = 0.02;
      p.c0(COL.ember0, 2.6).c1(COL.ember1, 0.4); p.fadePow = 0.9; p.fadeIn = 0.02;
      this.glow.commit();
    }
    this.flashLight(_o.set(x, y + 0.3, z), 0xffb060, 70 * FLASH_LIGHT_SCALE, 12, 0.3);
  }

  _updateGibs(dt) {
    const world = this.game.world;
    const list = this.gibList;
    const scene = this.game.scene;
    const audio = this.game.audio;
    for (let i = list.length - 1; i >= 0; i--) {
      const g = list[i];
      g.age += dt;
      const mesh = g.mesh;
      if (g.age >= g.life) {
        scene.remove(mesh);
        list[i] = list[list.length - 1];
        list.pop();
        continue;
      }
      const remain = g.life - g.age;
      if (remain < 0.6) mesh.scale.copy(g.scale0).multiplyScalar(Math.max(0.001, remain / 0.6));
      const pos = mesh.position;
      if (!g.rest) {
        g.vy -= GRAVITY * 0.9 * dt;
        const speed = Math.hypot(g.vx, g.vy, g.vz);
        let hit = null;
        if (speed * dt > 1e-5 && world && world.raycast) {
          _d.set(g.vx / speed, g.vy / speed, g.vz / speed);
          hit = world.raycast(pos, _d, speed * dt + g.radius);
        }
        if (hit) {
          const nrm = hit.normal;
          const vn = g.vx * nrm.x + g.vy * nrm.y + g.vz * nrm.z;
          if (vn < 0) {
            const e = 0.38;
            g.vx -= (1 + e) * vn * nrm.x; g.vy -= (1 + e) * vn * nrm.y; g.vz -= (1 + e) * vn * nrm.z;
            const tf = 0.74;
            const nvn = g.vx * nrm.x + g.vy * nrm.y + g.vz * nrm.z;
            g.vx = (g.vx - nvn * nrm.x) * tf + nvn * nrm.x;
            g.vy = (g.vy - nvn * nrm.y) * tf + nvn * nrm.y;
            g.vz = (g.vz - nvn * nrm.z) * tf + nvn * nrm.z;
            g.w *= 0.72;
            g.ax = rr(-1, 1); g.ay = rr(-1, 1); g.az = rr(-1, 1);
            const al = Math.hypot(g.ax, g.ay, g.az) || 1;
            g.ax /= al; g.ay /= al; g.az /= al;
            if (-vn > 3.2) {
              const px = hit.point.x, py = hit.point.y, pz = hit.point.z;
              const sp = Math.min(6, -vn * 0.5);
              for (let s = 0; s < 3; s++) {
                this._spark(px, py + 0.03, pz, nrm.x * sp + rr(-2, 2), nrm.y * sp + rr(0, 2), nrm.z * sp + rr(-2, 2), rr(0.15, 0.35), 0.04, 3, 1);
              }
              if (audio && this.time - g.lastSound > 0.12 && this.time - (this._gibSound ?? -1) > 0.05) {
                g.lastSound = this._gibSound = this.time;
                audio.play('impact_robot', { position: hit.point, volume: 0.6 });
              }
            }
          }
          pos.set(hit.point.x + nrm.x * g.radius * 1.02, hit.point.y + nrm.y * g.radius * 1.02, hit.point.z + nrm.z * g.radius * 1.02);
          if (nrm.y > 0.6 && Math.hypot(g.vx, g.vy, g.vz) < 1.7) {
            g.rest = true; g.vx = g.vy = g.vz = 0;
          }
        } else {
          pos.x += g.vx * dt; pos.y += g.vy * dt; pos.z += g.vz * dt;
        }
        if (g.w > 0.01) {
          _ax.set(g.ax, g.ay, g.az);
          _q.setFromAxisAngle(_ax, g.w * dt);
          mesh.quaternion.premultiply(_q);
        }
      }
      // smoke / sparks while young
      if (g.age < 1.8 && Math.random() < dt * g.smoke * (1.2 - g.age / 1.8)) {
        this._puff(pos.x, pos.y, pos.z, rr(-0.2, 0.2), rr(0.4, 1.2), rr(-0.2, 0.2), rr(0.7, 1.2), 0.1, rr(0.35, 0.6), COL.smokeDark, 0.45,
          { rgb1: COL.oil, drag: 1.2 });
      }
      if (g.age < 1.2 && Math.random() < dt * 4) {
        this._spark(pos.x, pos.y, pos.z, rr(-2, 2), rr(0.5, 3), rr(-2, 2), rr(0.15, 0.3), 0.035, 3, 1, { grav: 12 });
      }
    }
  }

  // ================================================================== dust

  /**
   * Landing / slide dust puffs.
   * @param {THREE.Vector3} position feet position
   * @param {{amount?:number}} [o] 0.3 = light slide dust, 1 = normal landing, 2+ = hard landing
   */
  dust(position, { amount = 1 } = {}) {
    if (!this._ready || amount <= 0) return;
    const n = this._cnt(Math.max(1, Math.round(4 * amount)));
    const sq = Math.sqrt(amount);
    const alpha = 0.3 + 0.2 * Math.min(1, amount);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU, sp = rr(1.2, 3.2) * sq;
      this._puff(position.x + Math.cos(a) * 0.25, position.y + 0.06, position.z + Math.sin(a) * 0.25,
        Math.cos(a) * sp, rr(0.3, 1.0) * sq, Math.sin(a) * sp, rr(0.45, 0.85),
        0.22, rr(0.9, 1.4) * (0.6 + 0.4 * sq), COL.dustNeutral, alpha, { drag: 3, sizePow: 0.5, fadeIn: 0.12 });
    }
  }
}

