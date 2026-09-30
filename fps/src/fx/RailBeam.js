// Javelin (rail) beam renderer: a pooled set of camera-facing ribbons (white core + cyan sheath) that fade with alpha^2
// decay, driven entirely by a time uniform (no per-frame CPU work). Also spawns the helical shock rings along the beam
// and the bright impact at the far end. One instance per game (`getRailBeams(game)`), shared by the player and bots.
import * as THREE from 'three';

const CAPACITY = 32;          // instances (2 per shot: core + sheath)
const LIFE = 0.55;            // seconds the beam stays visible
const RING_SPACING = 4.2;     // metres between shock rings
const RING_MAX = 22;          // rings per shot (keeps long shots cheap)
const RING_SKIP = 6;          // no ring closer than this to the camera (a big disc in your face is blinding)

const VS = /* glsl */`
attribute vec3 iA;
attribute vec3 iB;
attribute vec4 iColor;
attribute vec4 iParams;   // width, birth, life, unused
uniform float uTime;
varying vec2 vUv;
varying vec4 vColor;
void main() {
  float age = uTime - iParams.y;
  float life = iParams.z;
  if (age < 0.0 || age > life) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vUv = vec2(0.0); vColor = vec4(0.0); return; }
  float t = age / life;
  float fade = (1.0 - t) * (1.0 - t);
  vec3 dir = iB - iA;
  float len = length(dir);
  vec3 p = mix(iA, iB, position.y);
  vec3 toCam = cameraPosition - p;
  vec3 s = cross(dir, toCam);
  float sl = length(s);
  vec3 side = sl > 1e-5 ? s / sl : vec3(1.0, 0.0, 0.0);
  float dist = position.y * len;
  float taper = 0.12 + 0.88 * smoothstep(0.0, 7.0, dist);          // thin at the muzzle so it never fills the view
  float w = iParams.x * taper * (1.0 + t * 0.7);
  p += side * position.x * w * 0.5;
  float dc = length(cameraPosition - p);
  float nearFade = smoothstep(0.6, 3.5, dc);
  vColor = vec4(iColor.rgb, iColor.a * fade * nearFade);
  vUv = vec2(position.x * 0.5 + 0.5, position.y);
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}`;

const FS = /* glsl */`
varying vec2 vUv;
varying vec4 vColor;
void main() {
  float across = clamp(1.0 - abs(vUv.x * 2.0 - 1.0), 0.0, 1.0);
  float core = pow(across, 1.6);
  float a = core * vColor.a;
  if (a < 0.004) discard;
  gl_FragColor = vec4(vColor.rgb, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const _n = new THREE.Vector3();
const _ringA = [0.55, 0.9, 1.0];
const _ringB = [0.2, 0.55, 1.0];
const STRIDE = 14;            // iA(3) iB(3) iColor(4) iParams(4: width, birth, life, unused)

/** Pooled beam ribbons + rings for the rail weapon. */
export class RailBeams {
  /** @param {object} game */
  constructor(game) {
    this.game = game;
    this.next = 0;
    const geo = new THREE.InstancedBufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute([-1, 0, 0, 1, 0, 0, -1, 1, 0, 1, 1, 0], 3));
    geo.setIndex([0, 1, 2, 2, 1, 3]);
    this.data = new Float32Array(CAPACITY * STRIDE);
    this.buffer = new THREE.InstancedInterleavedBuffer(this.data, STRIDE, 1);
    this.buffer.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('iA', new THREE.InterleavedBufferAttribute(this.buffer, 3, 0));
    geo.setAttribute('iB', new THREE.InterleavedBufferAttribute(this.buffer, 3, 3));
    geo.setAttribute('iColor', new THREE.InterleavedBufferAttribute(this.buffer, 4, 6));
    geo.setAttribute('iParams', new THREE.InterleavedBufferAttribute(this.buffer, 4, 10));
    geo.instanceCount = CAPACITY;
    this.geometry = geo;
    for (let i = 0; i < CAPACITY; i++) { this.data[i * STRIDE + 11] = -1e9; this.data[i * STRIDE + 12] = 1; } // free slots
    this.uTime = { value: 0 };
    this.material = new THREE.ShaderMaterial({
      vertexShader: VS, fragmentShader: FS, uniforms: { uTime: this.uTime },
      transparent: true, depthWrite: false, depthTest: true, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 7;
    this.mesh.matrixAutoUpdate = false;
    this.mesh.name = 'rail-beams';
    /** Test / screenshot hook: a number pins the beam clock (seconds, same base as performance.now() / 1000). */
    this.freeze = null;
    this.mesh.onBeforeRender = () => { this.uTime.value = this.freeze != null ? this.freeze : performance.now() * 0.001; };
    game.scene.add(this.mesh);
  }

  _put(from, to, r, g, b, a, width, life) {
    const o = this.next * STRIDE, d = this.data;
    this.next = (this.next + 1) % CAPACITY;
    d[o] = from.x; d[o + 1] = from.y; d[o + 2] = from.z;
    d[o + 3] = to.x; d[o + 4] = to.y; d[o + 5] = to.z;
    d[o + 6] = r; d[o + 7] = g; d[o + 8] = b; d[o + 9] = a;
    d[o + 10] = width; d[o + 11] = performance.now() * 0.001; d[o + 12] = life;
  }

  /**
   * Add one beam. `power` 0..1 scales brightness and width (a minimum-charge shot is thinner and dimmer).
   * @param {THREE.Vector3} from muzzle
   * @param {THREE.Vector3} to end point
   * @param {{power?:number}} [o]
   */
  add(from, to, { power = 1 } = {}) {
    const k = 0.55 + 0.45 * Math.min(1, Math.max(0, power));
    this._put(from, to, 0.22, 0.7, 1.0, 0.48 * k, 0.8 * k, LIFE);           // cyan sheath
    this._put(from, to, 1.2, 1.25, 1.3, 0.85 * k, 0.14 * k, LIFE * 0.8);    // white core
    this.buffer.needsUpdate = true;
  }

  /**
   * Shock rings along the beam and the terminal flash (called once per shot by fireRail).
   * @param {THREE.Vector3} from
   * @param {THREE.Vector3} dirUnit
   * @param {number} length metres from `from` to the end point
   * @param {number} power 0..1
   */
  rings(from, dirUnit, length, power) {
    const fx = this.game.effects;
    if (!fx || typeof fx._ring !== 'function') return;
    const cam = this.game.camera.position;
    const k = 0.5 + 0.5 * power;
    let n = 0;
    for (let s = RING_SPACING; s < length - 1 && n < RING_MAX; s += RING_SPACING) {
      const x = from.x + dirUnit.x * s, y = from.y + dirUnit.y * s, z = from.z + dirUnit.z * s;
      const dx = x - cam.x, dy = y - cam.y, dz = z - cam.z;
      if (dx * dx + dy * dy + dz * dz < RING_SKIP * RING_SKIP) continue;
      fx._ring(x, y, z, dirUnit.x, dirUnit.y, dirUnit.z, 0.5, 2.7 * (0.7 + 0.3 * k), 0.45, _ringA, 1.1 * k, _ringB, 0.5 * k, 0.55 * k);
      n++;
    }
  }

  /** Bright energy impact at the end of the beam (16 sparks, zaps, scorch, light). */
  impact(point, normal, power) {
    const fx = this.game.effects;
    if (!fx) return;
    const n = normal && normal.lengthSq() > 0.25 ? normal : _n.set(0, 1, 0);
    if (typeof fx.impact === 'function') fx.impact(point, n, 'energy');
    if (typeof fx.flashLight === 'function') fx.flashLight(point, 0xbfeaff, 60 + 60 * power, 14, 0.3);
  }
}

/** The shared RailBeams instance of a game (created on first use). @param {object} game */
export function getRailBeams(game) {
  if (!game.railBeams) game.railBeams = new RailBeams(game);
  return game.railBeams;
}

