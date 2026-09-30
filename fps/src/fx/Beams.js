/**
 * Energy beams and blasts: instanced camera-facing lightning ribbons (Tempest's continuous chain beam, chain arcs,
 * generic one-shot bolts), plus the impact / cone-blast emitters that sit on top of the Effects particle layers.
 *
 * BeamLayer  - pooled bolts. A "channel" (effects.channel(key, ...)) is a bolt kept alive by re-calling it every tick
 *              (0.08 s grace); its fractal polyline is re-rolled at 30 Hz. A one-shot bolt (effects.lightning) fades
 *              out by itself. Every bolt is drawn as a soft coloured sheath plus a thin bright core, additive.
 * arcHitFx   - Tempest impact: zap sprite, spark streaks, energy scorch decal (throttled) and a robot hit flash.
 * galeBlastFx- Gale blast: three expanding cone rings, wind streaks / dust down the cone and a pooled light.
 *
 * Brightness is deliberately moderate (HDR multipliers ~1.2-1.6): the bloom pass scales with the player's Glow setting.
 */
import * as THREE from 'three';
import { TAU } from '../core/utils.js';
import { F, D } from './Atlas.js';

// ------------------------------------------------------------------ shaders

const BEAM_VS = /* glsl */`
attribute vec3 iA;
attribute vec3 iB;
attribute vec4 iColor;
attribute vec2 iParams; // width, softness (sheath 1.6 / core 0.9)
varying vec2 vUv;
varying vec4 vColor;
varying float vSoft;
void main() {
  vec3 dir = iB - iA;
  float len = length(dir);
  vec3 d = len > 1e-5 ? dir / len : vec3(0.0, 0.0, -1.0);
  float w = iParams.x;
  vec3 p = mix(iA - d * w * 0.45, iB + d * w * 0.45, position.y);
  vec3 toCam = cameraPosition - p;
  vec3 s = cross(d, toCam);
  float sl = length(s);
  vec3 side = sl > 1e-5 ? s / sl : vec3(1.0, 0.0, 0.0);
  p += side * position.x * w * 0.5;
  float dc = length(cameraPosition - p);
  float nearFade = smoothstep(0.75, 3.0, dc);   // the first metres of a first-person beam must not fill the screen
  vColor = vec4(iColor.rgb, iColor.a * nearFade);
  vSoft = iParams.y;
  vUv = vec2(position.x * 0.5 + 0.5, position.y);
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}`;

const BEAM_FS = /* glsl */`
varying vec2 vUv;
varying vec4 vColor;
varying float vSoft;
void main() {
  float across = clamp(1.0 - abs(vUv.x * 2.0 - 1.0), 0.0, 1.0);
  float a = pow(across, vSoft) * vColor.a;
  if (a < 0.004) discard;
  gl_FragColor = vec4(vColor.rgb, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

function createBeamMaterial() {
  return new THREE.ShaderMaterial({
    vertexShader: BEAM_VS,
    fragmentShader: BEAM_FS,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
}

// ------------------------------------------------------------------ helpers

const _c = new THREE.Color();
const rr = (a, b) => a + Math.random() * (b - a);
/** sRGB hex -> linear rgb (written into out[0..2]). */
function lin(hex, out, k = 1) {
  _c.set(hex);
  out[0] = _c.r * k; out[1] = _c.g * k; out[2] = _c.b * k;
  return out;
}

const MAX_PTS = 33;          // 2^5 + 1 polyline points
const STRIDE = 12;           // iA(3) iB(3) iColor(4) iParams(2)
const ROLL_HZ = 30;
const _offP = new Float32Array(MAX_PTS);
const _offQ = new Float32Array(MAX_PTS);
const _adj = new Float32Array(MAX_PTS * 3);
const _adjF = new Float32Array(4 * 3);
const SHEATH_GAIN = 1.35;    // HDR multiplier of the coloured sheath
const CORE_GAIN = 1.0;

/** Midpoint-displacement bolt from (ax,ay,az) to (bx,by,bz) into `pts` (3 floats per point). Returns the point count. */
function rollBolt(pts, ax, ay, az, bx, by, bz, jitter, maxSeg) {
  const dx = bx - ax, dy = by - ay, dz = bz - az;
  const len = Math.hypot(dx, dy, dz);
  let levels = Math.ceil(Math.log2(Math.max(1, len / maxSeg)));
  levels = Math.max(2, Math.min(5, levels));
  const n = (1 << levels) + 1;
  // any two unit vectors perpendicular to the bolt
  let ux = 0, uy = 1, uz = 0;
  if (len > 1e-5 && Math.abs(dy / len) > 0.95) { ux = 1; uy = 0; }
  const ix = dx / (len || 1), iy = dy / (len || 1), iz = dz / (len || 1);
  let px = iy * uz - iz * uy, py = iz * ux - ix * uz, pz = ix * uy - iy * ux;
  const pl = Math.hypot(px, py, pz) || 1; px /= pl; py /= pl; pz /= pl;
  const qx = iy * pz - iz * py, qy = iz * px - ix * pz, qz = ix * py - iy * px;
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    pts[i * 3] = ax + dx * t; pts[i * 3 + 1] = ay + dy * t; pts[i * 3 + 2] = az + dz * t;
  }
  // recursive displacement of the midpoints (offset held in the (p, q) plane)
  const offP = _offP, offQ = _offQ;
  offP.fill(0, 0, n); offQ.fill(0, 0, n);
  let amp = len * jitter * 0.5;
  for (let step = (n - 1) >> 1; step >= 1; step >>= 1) {
    for (let i = step; i < n - 1; i += step * 2) {
      const a0 = i - step, a1 = i + step;
      offP[i] = (offP[a0] + offP[a1]) * 0.5 + (Math.random() * 2 - 1) * amp;
      offQ[i] = (offQ[a0] + offQ[a1]) * 0.5 + (Math.random() * 2 - 1) * amp;
    }
    amp *= 0.55;
  }
  for (let i = 1; i < n - 1; i++) {
    pts[i * 3] += px * offP[i] + qx * offQ[i];
    pts[i * 3 + 1] += py * offP[i] + qy * offQ[i];
    pts[i * 3 + 2] += pz * offP[i] + qz * offQ[i];
  }
  return n;
}

// ------------------------------------------------------------------ BeamLayer

class Bolt {
  constructor() {
    this.active = false;
    this.key = null;
    this.a = new Float32Array(3);
    this.b = new Float32Array(3);
    this.pts = new Float32Array(MAX_PTS * 3);
    this.n = 0;
    this.fork = new Float32Array(4 * 3);
    this.forkN = 0;
    this.forkT = 0.5;
    this.ra = new Float32Array(3);      // endpoints at the time the polyline was rolled
    this.rb = new Float32Array(3);
    this.since = 0;
    this.k = 1;
    this.lastStrike = -1;
    this.sheath = [0.2, 0.75, 1.0];
    this.core = [1, 1, 1];
    this.width = 0.08;
    this.jitter = 0.2;
    this.forks = 0;
    this.life = 0.08;
    this.age = 0;
    this.rollAt = 0;
    this.persistent = false;
    this.restrike = null;
    this.fade = 1;
    this.maxSeg = 1.2;
  }
}

/** Pooled instanced lightning ribbons. */
export class BeamLayer {
  /** @param {number} [capacity] instanced ribbon quads (each bolt segment costs two: sheath + core) */
  constructor(capacity = 768) {
    this.capacity = capacity;
    this.count = 0;
    this.bolts = [];
    for (let i = 0; i < 48; i++) this.bolts.push(new Bolt());
    this.channels = new Map();
    const geo = new THREE.InstancedBufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute([-1, 0, 0, 1, 0, 0, -1, 1, 0, 1, 1, 0], 3));
    geo.setIndex([0, 1, 2, 2, 1, 3]);
    this.gpu = new Float32Array(capacity * STRIDE);
    this.buffer = new THREE.InstancedInterleavedBuffer(this.gpu, STRIDE, 1);
    this.buffer.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('iA', new THREE.InterleavedBufferAttribute(this.buffer, 3, 0));
    geo.setAttribute('iB', new THREE.InterleavedBufferAttribute(this.buffer, 3, 3));
    geo.setAttribute('iColor', new THREE.InterleavedBufferAttribute(this.buffer, 4, 6));
    geo.setAttribute('iParams', new THREE.InterleavedBufferAttribute(this.buffer, 2, 10));
    geo.instanceCount = 0;
    this.geometry = geo;
    this.material = createBeamMaterial();
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 6;
    this.mesh.matrixAutoUpdate = false;
    this.mesh.name = 'beams';
  }

  _take() {
    for (const b of this.bolts) if (!b.active) return b;
    // pool exhausted: recycle the oldest one-shot (never a live channel)
    let best = null;
    for (const b of this.bolts) if (!b.persistent && (!best || b.age > best.age)) best = b;
    return best || this.bolts[0];
  }

  _setup(b, from, to, o) {
    b.active = true;
    b.a[0] = from.x; b.a[1] = from.y; b.a[2] = from.z;
    b.b[0] = to.x; b.b[1] = to.y; b.b[2] = to.z;
    lin(o.color ?? 0x7fe3ff, b.sheath, SHEATH_GAIN);
    lin(o.core ?? 0xffffff, b.core, CORE_GAIN);
    b.width = o.width ?? 0.085;
    b.jitter = o.jitter ?? 0.2;
    b.forks = o.forks ?? 0;
    b.maxSeg = o.segLen ?? 1.2;
    b.k = o.k ?? 1;
  }

  /**
   * Continuous beam: re-call every tick / frame with the same key; it disappears `life` seconds (default 0.08) after
   * the last call.
   * @param {string} key
   * @param {THREE.Vector3} from
   * @param {THREE.Vector3} to
   * @param {{color?:number, core?:number, width?:number, jitter?:number, forks?:number, life?:number, k?:number}} [o]
   */
  channel(key, from, to, o = {}) {
    let b = this.channels.get(key);
    if (!b || !b.active || b.key !== key) {
      b = this._take();
      b.key = key;
      b.persistent = true;
      b.age = 0;
      b.rollAt = -1;
      b.restrike = null;
      b.fade = 1;
      this.channels.set(key, b);
    }
    this._setup(b, from, to, o);
    b.life = o.life ?? 0.08;
    b.since = 0;                 // seconds since the last refresh
    return b;
  }

  /**
   * One-shot bolt that fades out (chain arcs, strikes, static bursts).
   * @param {THREE.Vector3} from
   * @param {THREE.Vector3} to
   * @param {{color?:number, core?:number, width?:number, life?:number, jitter?:number, forks?:number, restrike?:number[], k?:number}} [o]
   */
  bolt(from, to, o = {}) {
    const b = this._take();
    if (b.key && this.channels.get(b.key) === b) this.channels.delete(b.key);
    b.key = null;
    b.persistent = false;
    b.age = 0;
    b.rollAt = -1;
    b.fade = 1;
    b.restrike = o.restrike || null;
    this._setup(b, from, to, o);
    b.life = o.life ?? 0.1;
    b.since = 0;
    return b;
  }

  clear() {
    for (const b of this.bolts) { b.active = false; b.key = null; }
    this.channels.clear();
    this.count = 0;
    this.geometry.instanceCount = 0;
  }

  _roll(b) {
    b.ra[0] = b.a[0]; b.ra[1] = b.a[1]; b.ra[2] = b.a[2];
    b.rb[0] = b.b[0]; b.rb[1] = b.b[1]; b.rb[2] = b.b[2];
    b.n = rollBolt(b.pts, b.a[0], b.a[1], b.a[2], b.b[0], b.b[1], b.b[2], b.jitter, b.maxSeg);
    b.forkN = 0;
    if (b.forks > 0 && b.n > 4) {
      // one short fork leaving a random interior point at an angle
      const i = 1 + Math.floor(Math.random() * (b.n - 3));
      b.forkT = i / (b.n - 1);
      const sx = b.pts[i * 3], sy = b.pts[i * 3 + 1], sz = b.pts[i * 3 + 2];
      const ex = b.b[0] - b.a[0], ey = b.b[1] - b.a[1], ez = b.b[2] - b.a[2];
      const len = Math.hypot(ex, ey, ez) || 1;
      const fl = Math.min(2.2, len * 0.22) * rr(0.6, 1.1);
      const ox = (Math.random() * 2 - 1), oy = (Math.random() * 2 - 1), oz = (Math.random() * 2 - 1);
      let fx = ex / len + ox * 1.1, fy = ey / len + oy * 1.1, fz = ez / len + oz * 1.1;
      const fn = Math.hypot(fx, fy, fz) || 1;
      fx /= fn; fy /= fn; fz /= fn;
      b.fork[0] = sx; b.fork[1] = sy; b.fork[2] = sz;
      b.fork[3] = sx + fx * fl * 0.5 + (Math.random() - 0.5) * 0.2; b.fork[4] = sy + fy * fl * 0.5 + (Math.random() - 0.5) * 0.2; b.fork[5] = sz + fz * fl * 0.5 + (Math.random() - 0.5) * 0.2;
      b.fork[6] = sx + fx * fl; b.fork[7] = sy + fy * fl; b.fork[8] = sz + fz * fl;
      b.forkN = 3;
    }
  }

  _emit(ax, ay, az, bx, by, bz, rgb, alpha, width, soft) {
    if (this.count >= this.capacity) return;
    const g = this.gpu;
    const o = this.count * STRIDE;
    g[o] = ax; g[o + 1] = ay; g[o + 2] = az;
    g[o + 3] = bx; g[o + 4] = by; g[o + 5] = bz;
    g[o + 6] = rgb[0]; g[o + 7] = rgb[1]; g[o + 8] = rgb[2]; g[o + 9] = alpha;
    g[o + 10] = width; g[o + 11] = soft;
    this.count++;
  }

  /** Advance the bolts (dt seconds) and rebuild the instance buffer. */
  update(dt) {
    this.count = 0;
    const interval = 1 / ROLL_HZ;
    for (const b of this.bolts) {
      if (!b.active) continue;
      b.age += dt;
      b.since += dt;
      let alpha = 1;
      if (b.persistent) {
        if (b.since > b.life) {
          b.active = false;
          if (b.key && this.channels.get(b.key) === b) this.channels.delete(b.key);
          b.key = null;
          continue;
        }
        // soften the last frames so the beam dies out instead of popping
        alpha = b.since > b.life * 0.6 ? 1 - (b.since - b.life * 0.6) / (b.life * 0.4) : 1;
      } else {
        let t = b.age;
        if (b.restrike) {
          // several flashes: t is measured from the latest restrike start
          let start = 0, alive = false;
          for (const r of b.restrike) if (b.age >= r) { start = r; alive = b.age - r <= b.life; }
          if (!alive) { if (b.age > b.restrike[b.restrike.length - 1] + b.life) b.active = false; continue; }
          t = b.age - start;
          if (start !== b.lastStrike) { b.lastStrike = start; b.rollAt = -1; }
        } else if (t > b.life) {
          b.active = false;
          continue;
        }
        alpha = Math.pow(Math.max(0, 1 - t / b.life), 1.3);
      }
      if (b.rollAt < 0 || b.age >= b.rollAt) {
        this._roll(b);
        b.rollAt = b.age + interval;
      }
      const k = alpha * b.k;
      // keep the rolled polyline glued to the CURRENT endpoints (a channel's endpoints move every frame)
      const n1 = b.n - 1;
      const dax = b.a[0] - b.ra[0], day = b.a[1] - b.ra[1], daz = b.a[2] - b.ra[2];
      const dbx = b.b[0] - b.rb[0], dby = b.b[1] - b.rb[1], dbz = b.b[2] - b.rb[2];
      const pts = _adj;
      for (let i = 0; i <= n1; i++) {
        const t = i / n1, s = 1 - t;
        pts[i * 3] = b.pts[i * 3] + dax * s + dbx * t;
        pts[i * 3 + 1] = b.pts[i * 3 + 1] + day * s + dby * t;
        pts[i * 3 + 2] = b.pts[i * 3 + 2] + daz * s + dbz * t;
      }
      for (let i = 0; i < b.n - 1; i++) {
        const a = i * 3, c = a + 3;
        this._emit(pts[a], pts[a + 1], pts[a + 2], pts[c], pts[c + 1], pts[c + 2], b.sheath, k * 0.68, b.width, 1.6);
        this._emit(pts[a], pts[a + 1], pts[a + 2], pts[c], pts[c + 1], pts[c + 2], b.core, k * 0.95, b.width * 0.4, 0.9);
      }
      if (b.forkN) {
        const ft = b.forkT, fs = 1 - ft;
        const f = _adjF;
        for (let i = 0; i < b.forkN; i++) {
          f[i * 3] = b.fork[i * 3] + dax * fs + dbx * ft;
          f[i * 3 + 1] = b.fork[i * 3 + 1] + day * fs + dby * ft;
          f[i * 3 + 2] = b.fork[i * 3 + 2] + daz * fs + dbz * ft;
        }
        for (let i = 0; i < b.forkN - 1; i++) {
          const a = i * 3, c = a + 3;
          this._emit(f[a], f[a + 1], f[a + 2], f[c], f[c + 1], f[c + 2], b.sheath, k * 0.4, b.width * 0.6, 1.6);
          this._emit(f[a], f[a + 1], f[a + 2], f[c], f[c + 1], f[c + 2], b.core, k * 0.7, b.width * 0.22, 0.9);
        }
      }
    }
    this.geometry.instanceCount = this.count;
    if (this.count > 0) {
      this.buffer.clearUpdateRanges();
      this.buffer.addUpdateRange(0, this.count * STRIDE);
      this.buffer.needsUpdate = true;
    }
  }
}

// ------------------------------------------------------------------ Tempest impact

const ELEC = [0, 0, 0];
const ELEC_DEEP = [0, 0, 0];
const WHITE = [1, 1, 1];
const _t1 = new THREE.Vector3();
const _t2 = new THREE.Vector3();
const _t3 = new THREE.Vector3();
const _t4 = new THREE.Vector3();
const _n = new THREE.Vector3(0, 1, 0);
const _d = new THREE.Vector3();
let _colInit = false;
function initCols() {
  if (_colInit) return;
  _colInit = true;
  lin(0x7ad8ff, ELEC);
  lin(0x1a50ff, ELEC_DEEP);
}

/** Orthonormal tangent basis around a unit normal into _t1/_t2. */
function basis(n) {
  const ref = Math.abs(n.y) < 0.9 ? _n.set(0, 1, 0) : _n.set(1, 0, 0);
  _t1.crossVectors(ref, n).normalize();
  _t2.crossVectors(n, _t1);
}

/**
 * Tempest impact: one zap sprite, three spark streaks, an energy scorch decal (throttled to 1 per 0.25 s) and a
 * hit flash on robots. Cheap: it is called for every beam tick (24 Hz) so it emits very little.
 * @param {import('./Effects.js').Effects} fx
 * @param {THREE.Vector3} point
 * @param {THREE.Vector3|null} normal
 * @param {object|null} entity
 */
export function arcHitFx(fx, point, normal, entity) {
  if (entity && entity.model && typeof entity.model.flashHit === 'function') entity.model.flashHit();
  if (!fx._ready) return;
  initCols();
  const n = normal && normal.lengthSq() > 0.25 ? normal : _d.set(0, 1, 0);
  const x = point.x + n.x * 0.05, y = point.y + n.y * 0.05, z = point.z + n.z * 0.05;
  fx._zap(x, y, z, rr(0.35, 0.6), rr(0.05, 0.09));
  fx._basis(n);
  const ns = fx._cnt(3);
  for (let i = 0; i < ns; i++) {
    const d = fx._cone(n, 0.05);
    const sp = rr(4, 11);
    fx._spark(x, y, z, d.x * sp, d.y * sp, d.z * sp, rr(0.12, 0.26), 0.035, 2.6, 1.3,
      { grav: 4, drag: 3, stretch: 0.03, rgb0: ELEC, rgb1: ELEC_DEEP });
  }
  fx._flash(x, y, z, 0.45, 0.06, ELEC, 1.8);
  if (!entity) {
    const last = fx._arcScorchAt ?? -1;
    if (fx.time - last > 0.25) {
      fx._arcScorchAt = fx.time;
      fx._decal(D.SCORCH_ENERGY, point.x, point.y, point.z, n, rr(0.34, 0.5), WHITE, 0.9, 18, false);
    }
    const audio = fx.game.audio;
    if (audio && fx.time - (fx._arcZapT ?? -1) > 0.16) {
      fx._arcZapT = fx.time;
      audio.play('arc_zap', { position: point });
    }
  }
}

// ------------------------------------------------------------------ Gale blast

const GALE_COL = [0, 0, 0];
const GALE_HOT = [0, 0, 0];
let _galeInit = false;

/**
 * Gale blast visuals: three expanding cone rings (2, 5 and 9 m along the aim), a spray of wind streaks and dust down
 * the cone and one pooled cyan light. `dir` is the unit aim direction, `origin` the muzzle.
 * @param {import('./Effects.js').Effects} fx
 * @param {THREE.Vector3} origin
 * @param {THREE.Vector3} dir
 * @param {{range?:number, halfAngle?:number}} [o]
 */
export function galeBlastFx(fx, origin, dir, { range = 12, halfAngle = 0.6 } = {}) {
  if (!fx._ready) return;
  if (!_galeInit) { _galeInit = true; lin(0xbfeaff, GALE_COL); lin(0xffffff, GALE_HOT); }
  basis(dir);
  const t1 = _t3.copy(_t1), t2 = _t4.copy(_t2);
  // rings: flat discs facing the aim, growing to the cone radius at their distance
  const rings = [[2, 0.2], [5, 0.24], [9, 0.28]];
  for (let i = 0; i < rings.length; i++) {
    const dist = Math.min(rings[i][0], range * 0.85);
    const r = Math.tan(halfAngle) * dist;
    const x = origin.x + dir.x * dist, y = origin.y + dir.y * dist, z = origin.z + dir.z * dist;
    fx._ring(x, y, z, dir.x, dir.y, dir.z, r * 0.9, r * 2.0, rrLife(rings[i][1]), GALE_COL, 1.1 - i * 0.2, GALE_COL, 0.4, 0.85);
  }
  // wind streaks + dust blown down the cone
  const n = fx._cnt(26);
  for (let i = 0; i < n; i++) {
    const a = Math.random() * TAU, rad = Math.sqrt(Math.random()) * Math.tan(halfAngle) * 0.7;
    _d.copy(dir).addScaledVector(t1, Math.cos(a) * rad).addScaledVector(t2, Math.sin(a) * rad).normalize();
    const sp = rr(14, 30);
    const s0 = rr(0.4, 2.5);
    fx._spark(origin.x + dir.x * s0, origin.y + dir.y * s0, origin.z + dir.z * s0, _d.x * sp, _d.y * sp, _d.z * sp,
      rr(0.18, 0.4), rr(0.05, 0.1), 1.6, 0.6, { grav: 0, drag: 2.2, stretch: 0.05, rgb0: GALE_HOT, rgb1: GALE_COL });
  }
  const nd = fx._cnt(6);
  for (let i = 0; i < nd; i++) {
    _d.copy(dir).addScaledVector(t1, rr(-0.4, 0.4)).addScaledVector(t2, rr(-0.4, 0.4)).normalize();
    const sp = rr(6, 14);
    const s0 = rr(0.8, 3);
    fx._puff(origin.x + dir.x * s0, origin.y + dir.y * s0, origin.z + dir.z * s0, _d.x * sp, _d.y * sp, _d.z * sp,
      rr(0.35, 0.6), 0.15, rr(0.7, 1.2), GALE_COL, 0.16, { drag: 4, fadeIn: 0.03 });
  }
  const c = _d.copy(origin).addScaledVector(dir, 1.5);
  fx.flashLight(c, 0xbfeaff, 4.5 * 6, 12, 0.14);
}

function rrLife(base) { return base * (0.9 + Math.random() * 0.2); }

/**
 * Short cyan ring at a point (shoved target / reflected projectile / splat shock).
 * @param {import('./Effects.js').Effects} fx
 * @param {THREE.Vector3} p centre
 * @param {THREE.Vector3|null} normal ring facing (default camera-facing up)
 * @param {{size?:number, white?:boolean, life?:number}} [o]
 */
export function galeRingFx(fx, p, normal, { size = 1.4, white = false, life = 0.22 } = {}) {
  if (!fx._ready) return;
  if (!_galeInit) { _galeInit = true; lin(0xbfeaff, GALE_COL); lin(0xffffff, GALE_HOT); }
  const n = normal || _d.set(0, 1, 0);
  const col = white ? GALE_HOT : GALE_COL;
  fx._ring(p.x, p.y, p.z, n.x, n.y, n.z, size * 0.25, size, life, col, 1.4, GALE_COL, 0.5, 0.9);
  fx._flash(p.x, p.y, p.z, size * 0.5, 0.08, col, 1.6);
}
