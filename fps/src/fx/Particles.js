import * as THREE from 'three';

/**
 * GPU-friendly effect primitives: instanced billboard particle layers (one draw call each),
 * an instanced tracer-ribbon layer and an instanced decal layer. All state lives in typed arrays.
 */

// ------------------------------------------------------------------ shaders

const PARTICLE_VS = /* glsl */`
attribute vec3 iPos;
attribute vec3 iVel;
attribute vec4 iColor;
attribute vec4 iParams; // size, rotation, frame, stretch (<0 = flat disc facing iVel)
uniform vec2 uAtlas;
uniform float uPx; // world size of one pixel at unit view distance
uniform vec2 uNear; // camera-inside-sprite fade range (in sprite radii)
uniform float uCover; // sprite radius (fraction of the half screen height) above which the sprite is attenuated
varying vec2 vUv;
varying vec4 vColor;
#include <fog_pars_vertex>
void main() {
  vec2 c = position.xy;
  float size = iParams.x;
  float rot = iParams.y;
  float frame = iParams.z;
  float stretch = iParams.w;
  vec4 mvPosition;
  if (stretch < -0.5) {
    vec3 n = normalize(iVel);
    vec3 refv = abs(n.y) < 0.95 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
    vec3 t = normalize(cross(refv, n));
    vec3 b = cross(n, t);
    float cs = cos(rot), sn = sin(rot);
    vec2 r = vec2(c.x * cs - c.y * sn, c.x * sn + c.y * cs);
    mvPosition = viewMatrix * vec4(iPos + (t * r.x + b * r.y) * size * 0.5, 1.0);
  } else {
    mvPosition = viewMatrix * vec4(iPos, 1.0);
    vec2 off;
    if (stretch > 0.0) {
      vec3 vv = (viewMatrix * vec4(iVel, 0.0)).xyz;
      float sp = length(vv);
      float l2 = length(vv.xy);
      vec2 dir = l2 > 1e-4 ? vv.xy / l2 : vec2(0.0, 1.0);
      float proj = sp > 1e-4 ? l2 / sp : 0.0;
      float w = max(size, -mvPosition.z * uPx * 2.4);
      float len = w + sp * stretch;
      float lenP = max(w, len * proj);
      vec2 perp = vec2(-dir.y, dir.x);
      off = perp * c.x * w * 0.5 + dir * (c.y - 1.0) * 0.5 * lenP;
    } else {
      float cs = cos(rot), sn = sin(rot);
      off = vec2(c.x * cs - c.y * sn, c.x * sn + c.y * cs) * size * 0.5;
    }
    mvPosition.xy += off;
  }
  vec2 cell = vec2(mod(frame, uAtlas.x), floor(frame / uAtlas.x));
  vUv = (cell + 0.5 + c * 0.49) / uAtlas;
  // fade sprites out when the camera is inside / very close to them (no screen-filling blobs)
  float nf = smoothstep(uNear.x, uNear.y, -mvPosition.z / max(size * 0.5, 0.15));
  // glare limiter: a big bright additive sprite close to the camera (explosion fireball, muzzle flash against a
  // wall) would otherwise white out the whole screen - the more of the screen it covers, the fainter it gets
  float cover = size * 0.5 * projectionMatrix[1][1] / max(-mvPosition.z, 0.05);
  float lim = 1.0 / (1.0 + 3.0 * max(cover - uCover, 0.0));
  // velocity-stretched sparks / streaks: no near-camera fade above, so fade them by distance instead (a spark
  // burst right in front of the eye is a wall of long bright streaks)
  float sf = smoothstep(0.15, 1.8, -mvPosition.z);
  vColor = vec4(iColor.rgb, iColor.a * (stretch > 0.0 ? sf : nf * lim));
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

const PARTICLE_FS = /* glsl */`
uniform sampler2D uMap;
uniform vec3 uLight;
varying vec2 vUv;
varying vec4 vColor;
#include <fog_pars_fragment>
void main() {
  vec4 tex = texture2D(uMap, vUv);
  float a = tex.a * vColor.a;
  if (a < 0.004) discard;
  vec3 rgb = tex.rgb * vColor.rgb;
  #ifdef LIT
  rgb *= uLight;
  #endif
  gl_FragColor = vec4(rgb, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

const TRACER_VS = /* glsl */`
attribute vec3 iA;
attribute vec3 iB;
attribute vec4 iColor;
attribute vec2 iParams; // width, unused
varying vec2 vUv;
varying vec4 vColor;
void main() {
  vec3 p = mix(iA, iB, position.y);
  vec3 dir = iB - iA;
  vec3 toCam = cameraPosition - p;
  vec3 s = cross(dir, toCam);
  float sl = length(s);
  vec3 side = sl > 1e-5 ? s / sl : vec3(1.0, 0.0, 0.0);
  p += side * position.x * iParams.x * 0.5;
  float dc = length(cameraPosition - p);
  float nearFade = smoothstep(0.7, 4.0, dc);
  vColor = vec4(iColor.rgb, iColor.a * nearFade);
  vUv = vec2(position.x * 0.5 + 0.5, position.y);
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}`;

const TRACER_FS = /* glsl */`
varying vec2 vUv;
varying vec4 vColor;
void main() {
  // clamp: interpolated varyings can undershoot slightly and pow() of a negative base is NaN (poisons bloom)
  float across = clamp(1.0 - abs(vUv.x * 2.0 - 1.0), 0.0, 1.0);
  float core = pow(across, 1.4);
  float head = pow(clamp(vUv.y, 0.0, 1.0), 1.7);
  float a = core * head * vColor.a;
  if (a < 0.003) discard;
  float hot = core * core * head;
  vec3 col = vColor.rgb * (0.7 + 2.0 * hot) + vec3(hot * 0.9);
  gl_FragColor = vec4(col, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const DECAL_VS = /* glsl */`
attribute vec4 iColor;
attribute float iFrame;
uniform vec2 uAtlas;
varying vec2 vUv;
varying vec4 vColor;
#include <fog_pars_vertex>
void main() {
  vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
  vec4 mvPosition = viewMatrix * wp;
  gl_Position = projectionMatrix * mvPosition;
  vec2 c = position.xy * 2.0;
  vec2 cell = vec2(mod(iFrame, uAtlas.x), floor(iFrame / uAtlas.x));
  vUv = (cell + 0.5 + c * 0.49) / uAtlas;
  vColor = iColor;
  #include <fog_vertex>
}`;

const DECAL_FS = /* glsl */`
uniform sampler2D uMap;
uniform vec3 uLight;
varying vec2 vUv;
varying vec4 vColor;
#include <fog_pars_fragment>
void main() {
  vec4 tex = texture2D(uMap, vUv);
  float a = tex.a * vColor.a;
  if (a < 0.004) discard;
  gl_FragColor = vec4(tex.rgb * vColor.rgb * uLight, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

// ------------------------------------------------------------------ materials

/**
 * @param {THREE.Texture} atlas
 * @param {{additive:boolean, lit:boolean, cols:number, rows:number}} o
 */
export function createParticleMaterial(atlas, { additive, lit, cols = 4, rows = 4 }) {
  const near = additive ? [0.2, 1.1] : [0.3, 1.1];
  const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
    uMap: { value: atlas },
    uAtlas: { value: new THREE.Vector2(cols, rows) },
    uLight: { value: new THREE.Vector3(1, 1, 1) },
    uPx: { value: 0.002 },
    uNear: { value: new THREE.Vector2(near[0], near[1]) },
    uCover: { value: additive ? 0.3 : 1e4 },
  }]);
  return new THREE.ShaderMaterial({
    uniforms,
    defines: lit ? { LIT: '' } : {},
    vertexShader: PARTICLE_VS,
    fragmentShader: PARTICLE_FS,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    side: THREE.DoubleSide, // stretched / disc quads can be mirrored relative to the camera
    fog: !additive,
  });
}

export function createTracerMaterial() {
  return new THREE.ShaderMaterial({
    vertexShader: TRACER_VS,
    fragmentShader: TRACER_FS,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
}

export function createDecalMaterial(atlas, cols = 4, rows = 2) {
  const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
    uMap: { value: atlas },
    uAtlas: { value: new THREE.Vector2(cols, rows) },
    uLight: { value: new THREE.Vector3(1, 1, 1) },
  }]);
  return new THREE.ShaderMaterial({
    uniforms,
    vertexShader: DECAL_VS,
    fragmentShader: DECAL_FS,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
    side: THREE.DoubleSide,
    fog: true,
  });
}

// ------------------------------------------------------------------ particle layer

// per-particle simulation fields (interleaved in one Float32Array)
const X = 0, Y = 1, Z = 2, VX = 3, VY = 4, VZ = 5, AGE = 6, LIFE = 7, DRAG = 8, GRAV = 9, FLOOR = 10, BOUNCE = 11;
const S0 = 12, S1 = 13, ROT = 14, SPIN = 15, FRAME = 16, STRETCH = 17;
const R0 = 18, G0 = 19, B0 = 20, A0 = 21, R1 = 22, G1 = 23, B1 = 24, FADEIN = 25, FADEPOW = 26, SIZEPOW = 27;
const STRIDE = 28;
const GPU = 14; // iPos(3) iVel(3) iColor(4) iParams(4)

/** Reusable emission description (see ParticleLayer.begin). */
class Spec {
  constructor() {
    this.reset();
  }

  reset() {
    this.x = 0; this.y = 0; this.z = 0;
    this.vx = 0; this.vy = 0; this.vz = 0;
    this.life = 1; this.drag = 0; this.grav = 0;
    /** world Y of the ground below (particles bounce / lift); -1e9 = none */
    this.floor = -1e9;
    /** > 0: bounce restitution; < 0: soft floor (sprite is kept above the floor) */
    this.bounce = 0;
    this.s0 = 0.2; this.s1 = 0.2;
    this.rot = 0; this.spin = 0;
    this.frame = 0;
    /** > 0: velocity-stretched streak (length per m/s); -1: flat disc with normal (vx,vy,vz) */
    this.stretch = 0;
    this.r0 = 1; this.g0 = 1; this.b0 = 1; this.a0 = 1;
    this.r1 = 1; this.g1 = 1; this.b1 = 1;
    this.fadeIn = 0.04;
    this.fadePow = 1;
    this.sizePow = 1;
    return this;
  }

  /** Start colour (linear rgb triple scaled by k). */
  c0(rgb, k = 1, a = 1) {
    this.r0 = rgb[0] * k; this.g0 = rgb[1] * k; this.b0 = rgb[2] * k; this.a0 = a;
    return this;
  }

  /** End colour. */
  c1(rgb, k = 1) {
    this.r1 = rgb[0] * k; this.g1 = rgb[1] * k; this.b1 = rgb[2] * k;
    return this;
  }
}

/**
 * Pooled instanced-billboard particle system (one draw call). Particles are swap-removed so the
 * live set is always dense. Optionally depth-sorted back to front (for alpha-blended layers).
 */
export class ParticleLayer {
  /**
   * @param {number} capacity max live particles
   * @param {THREE.Material} material
   * @param {{sorted?:boolean, renderOrder?:number, gain?:number}} [o] gain: global multiplier on the emitted rgb
   *        (the additive glow layer runs below 1 so flashes / sparks / fire read as glow instead of searing white)
   */
  constructor(capacity, material, { sorted = false, renderOrder = 0, gain = 1 } = {}) {
    this.capacity = capacity;
    this.gain = gain;
    this.count = 0;
    this.sorted = sorted;
    this.data = new Float32Array(capacity * STRIDE);
    this.spec = new Spec();
    this.dropped = 0;
    /** age given to new particles: cancels the dt of the frame they were spawned in (so they render at least once) */
    this.spawnAge = 0;

    const base = new THREE.InstancedBufferGeometry();
    base.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, -1, 1, 0, 1, 1, 0], 3));
    base.setIndex([0, 1, 2, 2, 1, 3]);
    this.gpu = new Float32Array(capacity * GPU);
    this.buffer = new THREE.InstancedInterleavedBuffer(this.gpu, GPU, 1);
    this.buffer.setUsage(THREE.DynamicDrawUsage);
    base.setAttribute('iPos', new THREE.InterleavedBufferAttribute(this.buffer, 3, 0));
    base.setAttribute('iVel', new THREE.InterleavedBufferAttribute(this.buffer, 3, 3));
    base.setAttribute('iColor', new THREE.InterleavedBufferAttribute(this.buffer, 4, 6));
    base.setAttribute('iParams', new THREE.InterleavedBufferAttribute(this.buffer, 4, 10));
    base.instanceCount = 0;
    this.geometry = base;
    if (sorted) {
      this.stage = new Float32Array(capacity * GPU);
      this.keys = new Float32Array(capacity);
      this.order = new Uint16Array(capacity);
    }
    this.mesh = new THREE.Mesh(base, material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = renderOrder;
    // stays visible with instanceCount 0 when idle: the shader program is compiled with the first frame of a
    // scene instead of stuttering at the first explosion
    this.mesh.matrixAutoUpdate = false;
  }

  /** Reset and return the shared spec, or null when the layer is full. Call commit() afterwards. */
  begin() {
    if (this.count >= this.capacity) { this.dropped++; return null; }
    return this.spec.reset();
  }

  /** Write the spec returned by begin() into the pool. */
  commit() {
    const s = this.spec, d = this.data, o = this.count++ * STRIDE;
    d[o + X] = s.x; d[o + Y] = s.y; d[o + Z] = s.z;
    d[o + VX] = s.vx; d[o + VY] = s.vy; d[o + VZ] = s.vz;
    d[o + AGE] = this.spawnAge; d[o + LIFE] = Math.max(0.02, s.life);
    d[o + DRAG] = s.drag; d[o + GRAV] = s.grav; d[o + FLOOR] = s.floor; d[o + BOUNCE] = s.bounce;
    d[o + S0] = s.s0; d[o + S1] = s.s1; d[o + ROT] = s.rot; d[o + SPIN] = s.spin;
    d[o + FRAME] = s.frame; d[o + STRETCH] = s.stretch;
    d[o + R0] = s.r0; d[o + G0] = s.g0; d[o + B0] = s.b0; d[o + A0] = s.a0;
    d[o + R1] = s.r1; d[o + G1] = s.g1; d[o + B1] = s.b1;
    d[o + FADEIN] = Math.max(0.001, s.fadeIn); d[o + FADEPOW] = s.fadePow; d[o + SIZEPOW] = s.sizePow;
  }

  clear() {
    this.count = 0;
    this.geometry.instanceCount = 0;
  }

  /**
   * Advance the simulation and upload instance data.
   * @param {number} dt
   * @param {THREE.Vector3} cam camera position
   * @param {THREE.Vector3} fwd camera forward (unit)
   */
  update(dt, cam, fwd) {
    this.spawnAge = -Math.min(dt, 0.05);
    let n = this.count;
    if (n === 0) return;
    const d = this.data;
    const out = this.sorted ? this.stage : this.gpu;
    const sorted = this.sorted;
    const keys = this.keys;
    const gain = this.gain;
    for (let i = 0; i < n;) {
      const o = i * STRIDE;
      const age = d[o + AGE] + dt;
      const life = d[o + LIFE];
      if (age >= life) {
        n--;
        if (i !== n) d.copyWithin(o, n * STRIDE, n * STRIDE + STRIDE);
        continue;
      }
      d[o + AGE] = age;
      const t = age > 0 ? age / life : 0;
      const stretch = d[o + STRETCH];
      let x = d[o + X], y = d[o + Y], z = d[o + Z];
      let vx = d[o + VX], vy = d[o + VY], vz = d[o + VZ];
      const s0 = d[o + S0];
      const sp = d[o + SIZEPOW];
      const size = s0 + (d[o + S1] - s0) * (sp === 1 ? t : Math.pow(t, sp));
      if (stretch > -0.5) {
        const k = Math.max(0, 1 - d[o + DRAG] * dt);
        vx *= k; vy = vy * k - d[o + GRAV] * dt; vz *= k;
        x += vx * dt; y += vy * dt; z += vz * dt;
        const fl = d[o + FLOOR];
        if (y < fl + (d[o + BOUNCE] < 0 ? size * 0.3 : 0)) {
          const b = d[o + BOUNCE];
          if (b > 0) {
            y = fl;
            if (vy < 0) {
              vy = -vy * b; vx *= 0.7; vz *= 0.7;
              if (vy < 0.8) vy = 0;
            }
          } else if (b < 0) {
            y = fl + size * 0.3;
            if (vy < 0) vy *= 0.2;
          }
        }
        d[o + X] = x; d[o + Y] = y; d[o + Z] = z;
        d[o + VX] = vx; d[o + VY] = vy; d[o + VZ] = vz;
      }
      const fp = d[o + FADEPOW];
      let a = d[o + A0] * (fp === 1 ? 1 - t : fp === 2 ? (1 - t) * (1 - t) : Math.pow(1 - t, fp));
      const fi = d[o + FADEIN];
      if (t < fi) a *= 0.3 + 0.7 * (t / fi);
      const g = i * GPU;
      out[g] = x; out[g + 1] = y; out[g + 2] = z;
      out[g + 3] = vx; out[g + 4] = vy; out[g + 5] = vz;
      out[g + 6] = (d[o + R0] + (d[o + R1] - d[o + R0]) * t) * gain;
      out[g + 7] = (d[o + G0] + (d[o + G1] - d[o + G0]) * t) * gain;
      out[g + 8] = (d[o + B0] + (d[o + B1] - d[o + B0]) * t) * gain;
      out[g + 9] = a;
      out[g + 10] = size;
      out[g + 11] = d[o + ROT] + d[o + SPIN] * age;
      out[g + 12] = d[o + FRAME];
      out[g + 13] = stretch;
      if (sorted) keys[i] = (x - cam.x) * fwd.x + (y - cam.y) * fwd.y + (z - cam.z) * fwd.z;
      i++;
    }
    this.count = n;
    if (n === 0) {
      this.geometry.instanceCount = 0;
      return;
    }
    if (sorted) this._sortAndCopy(n);
    this.geometry.instanceCount = n;
    this.buffer.clearUpdateRanges();
    this.buffer.addUpdateRange(0, n * GPU);
    this.buffer.needsUpdate = true;
  }

  /** Shell-sort indices far-to-near, then copy staged instances into the GPU buffer in that order. */
  _sortAndCopy(n) {
    const order = this.order, keys = this.keys;
    for (let i = 0; i < n; i++) order[i] = i;
    let gap = 1;
    while (gap < n / 3) gap = gap * 3 + 1;
    for (; gap > 0; gap = (gap - 1) / 3) {
      for (let i = gap; i < n; i++) {
        const idx = order[i], key = keys[idx];
        let j = i;
        while (j >= gap && keys[order[j - gap]] < key) {
          order[j] = order[j - gap];
          j -= gap;
        }
        order[j] = idx;
      }
    }
    const stage = this.stage, gpu = this.gpu;
    for (let j = 0; j < n; j++) {
      const s = order[j] * GPU, g = j * GPU;
      for (let k = 0; k < GPU; k++) gpu[g + k] = stage[s + k];
    }
  }
}

// ------------------------------------------------------------------ tracers

const TR = 12; // iA(3) iB(3) iColor(4) iParams(2)

/** Pooled bullet tracers: bright streaks that fly from the muzzle to the impact point. */
export class TracerLayer {
  constructor(capacity, material, renderOrder = 6) {
    this.capacity = capacity;
    this.count = 0;
    this.next = 0;
    // sim (17 floats): origin(3) dir(3) total, -, speed, len, life, age, width, rgb(3), alpha
    this.sim = new Float32Array(capacity * 17);
    this.alive = new Uint8Array(capacity);
    const geo = new THREE.InstancedBufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute([-1, 0, 0, 1, 0, 0, -1, 1, 0, 1, 1, 0], 3));
    geo.setIndex([0, 1, 2, 2, 1, 3]);
    this.gpu = new Float32Array(capacity * TR);
    this.buffer = new THREE.InstancedInterleavedBuffer(this.gpu, TR, 1);
    this.buffer.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('iA', new THREE.InterleavedBufferAttribute(this.buffer, 3, 0));
    geo.setAttribute('iB', new THREE.InterleavedBufferAttribute(this.buffer, 3, 3));
    geo.setAttribute('iColor', new THREE.InterleavedBufferAttribute(this.buffer, 4, 6));
    geo.setAttribute('iParams', new THREE.InterleavedBufferAttribute(this.buffer, 2, 10));
    geo.instanceCount = 0;
    this.geometry = geo;
    this.mesh = new THREE.Mesh(geo, material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = renderOrder;
    this.mesh.matrixAutoUpdate = false;
  }

  /**
   * Add a tracer from (x0,y0,z0) to (x1,y1,z1). Linear rgb colour (HDR allowed).
   */
  add(x0, y0, z0, x1, y1, z1, r, g, b, width, alpha = 1) {
    let dx = x1 - x0, dy = y1 - y0, dz = z1 - z0;
    const total = Math.hypot(dx, dy, dz);
    if (total < 0.05) return;
    dx /= total; dy /= total; dz /= total;
    const len = Math.max(1.5, Math.min(9, total * 0.5));
    const speed = Math.min(380, (total + len) / 0.07);
    const life = (total + len) / speed;
    const i = this.next;
    this.next = (this.next + 1) % this.capacity;
    const o = i * 17, s = this.sim;
    s[o] = x0; s[o + 1] = y0; s[o + 2] = z0;
    s[o + 3] = dx; s[o + 4] = dy; s[o + 5] = dz;
    s[o + 6] = total; s[o + 7] = life; s[o + 8] = speed; s[o + 9] = len;
    s[o + 10] = life; s[o + 11] = 0; s[o + 12] = width;
    s[o + 13] = r; s[o + 14] = g; s[o + 15] = b; s[o + 16] = alpha;
    this.alive[i] = 1;
  }

  clear() {
    this.alive.fill(0);
    this.count = 0;
    this.geometry.instanceCount = 0;
  }

  update(dt) {
    const s = this.sim, g = this.gpu, cap = this.capacity;
    let live = 0;
    for (let i = 0; i < cap; i++) {
      if (!this.alive[i]) continue;
      const o = i * 17;
      const age = s[o + 11] + dt;
      s[o + 11] = age;
      const head = age * s[o + 8];
      const total = s[o + 6], len = s[o + 9];
      const tail = head - len;
      if (tail >= total) { this.alive[i] = 0; continue; }
      const h = Math.min(total, head), t = Math.max(0, tail);
      const w = live * TR;
      // compact: write into slot `live` (instances are rebuilt every frame)
      g[w] = s[o] + s[o + 3] * t; g[w + 1] = s[o + 1] + s[o + 4] * t; g[w + 2] = s[o + 2] + s[o + 5] * t;
      g[w + 3] = s[o] + s[o + 3] * h; g[w + 4] = s[o + 1] + s[o + 4] * h; g[w + 5] = s[o + 2] + s[o + 5] * h;
      const fade = 1 - Math.max(0, (tail / total) - 0.6) / 0.4 * 0.6;
      g[w + 6] = s[o + 13]; g[w + 7] = s[o + 14]; g[w + 8] = s[o + 15];
      g[w + 9] = fade * s[o + 16];
      g[w + 10] = s[o + 12]; g[w + 11] = 0;
      live++;
    }
    this.count = live;
    this.geometry.instanceCount = live;
    if (live > 0) {
      this.buffer.clearUpdateRanges();
      this.buffer.addUpdateRange(0, live * TR);
      this.buffer.needsUpdate = true;
    }
  }
}

// ------------------------------------------------------------------ decals

/**
 * Pooled decals: one InstancedMesh, two ring buffers (bullet marks and big scorch marks) so a
 * firefight cannot erase the explosion scorches. Decals fade out at the end of their life.
 */
export class DecalLayer {
  /**
   * @param {THREE.Material} material
   * @param {number} bulletCap capacity of the bullet-mark ring
   * @param {number} scorchCap capacity of the scorch ring
   */
  constructor(material, bulletCap, scorchCap) {
    this.bulletCap = bulletCap;
    this.scorchCap = scorchCap;
    this.total = bulletCap + scorchCap;
    const geo = new THREE.PlaneGeometry(1, 1);
    this.colors = new Float32Array(this.total * 4);
    this.frames = new Float32Array(this.total);
    geo.setAttribute('iColor', new THREE.InstancedBufferAttribute(this.colors, 4).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('iFrame', new THREE.InstancedBufferAttribute(this.frames, 1).setUsage(THREE.DynamicDrawUsage));
    this.mesh = new THREE.InstancedMesh(geo, material, this.total);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    this.mesh.count = 0;
    this.birth = new Float32Array(this.total);
    this.life = new Float32Array(this.total);
    this.alpha0 = new Float32Array(this.total);
    this.live = new Uint8Array(this.total);
    this.nextBullet = 0;
    this.nextScorch = 0;
    this.liveCount = 0;
    this._m = new THREE.Matrix4();
    this._zero = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < this.total; i++) this.mesh.setMatrixAt(i, this._zero);
    this.mesh.instanceMatrix.needsUpdate = true;
    this._t = new THREE.Vector3();
    this._b = new THREE.Vector3();
    this._n = new THREE.Vector3();
    this.dirtyColors = false;
  }

  /**
   * Place a decal. `scorch` selects the scorch ring; `maxBullets` (quality) limits the bullet ring.
   */
  add(frame, px, py, pz, nx, ny, nz, size, r, g, b, a, now, life, scorch, maxBullets) {
    let idx;
    if (scorch) {
      idx = this.bulletCap + this.nextScorch;
      this.nextScorch = (this.nextScorch + 1) % this.scorchCap;
    } else {
      const cap = Math.max(1, Math.min(this.bulletCap, maxBullets));
      // if the quality was lowered, retire marks beyond the new cap
      if (this.nextBullet >= cap) this.nextBullet = 0;
      idx = this.nextBullet;
      this.nextBullet = (this.nextBullet + 1) % cap;
    }
    const n = this._n.set(nx, ny, nz);
    if (n.lengthSq() < 1e-8) return;
    n.normalize();
    const ref = Math.abs(n.y) < 0.9 ? Y_AXIS : X_AXIS;
    const t = this._t.crossVectors(ref, n).normalize();
    const b2 = this._b.crossVectors(n, t);
    const ang = Math.random() * Math.PI * 2;
    const cs = Math.cos(ang) * size, sn = Math.sin(ang) * size;
    // basis columns: X = t*cs + b*sn, Y = -t*sn + b*cs, Z = n
    const m = this._m;
    m.set(
      t.x * cs + b2.x * sn, -t.x * sn + b2.x * cs, n.x, px + n.x * 0.006,
      t.y * cs + b2.y * sn, -t.y * sn + b2.y * cs, n.y, py + n.y * 0.006,
      t.z * cs + b2.z * sn, -t.z * sn + b2.z * cs, n.z, pz + n.z * 0.006,
      0, 0, 0, 1,
    );
    this.mesh.setMatrixAt(idx, m);
    this.mesh.instanceMatrix.needsUpdate = true;
    const c = idx * 4;
    this.colors[c] = r; this.colors[c + 1] = g; this.colors[c + 2] = b; this.colors[c + 3] = a;
    this.frames[idx] = frame;
    this.birth[idx] = now;
    this.life[idx] = life;
    this.alpha0[idx] = a;
    if (!this.live[idx]) this.liveCount++;
    this.live[idx] = 1;
    const geo = this.mesh.geometry;
    geo.attributes.iColor.needsUpdate = true;
    geo.attributes.iFrame.needsUpdate = true;
    this.mesh.count = this.total;
  }

  clear() {
    for (let i = 0; i < this.total; i++) {
      this.mesh.setMatrixAt(i, this._zero);
      this.colors[i * 4 + 3] = 0;
      this.live[i] = 0;
    }
    this.liveCount = 0;
    this.nextBullet = 0;
    this.nextScorch = 0;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.geometry.attributes.iColor.needsUpdate = true;
    this.mesh.count = 0;
  }

  /** Fade and retire decals. */
  update(now) {
    if (this.liveCount === 0) return;
    let changed = false;
    for (let i = 0; i < this.total; i++) {
      if (!this.live[i]) continue;
      const rem = this.birth[i] + this.life[i] - now;
      if (rem <= 0) {
        this.live[i] = 0;
        this.liveCount--;
        this.colors[i * 4 + 3] = 0;
        this.mesh.setMatrixAt(i, this._zero);
        this.mesh.instanceMatrix.needsUpdate = true;
        changed = true;
      } else if (rem < 4) {
        this.colors[i * 4 + 3] = this.alpha0[i] * (rem / 4);
        changed = true;
      }
    }
    if (changed) this.mesh.geometry.attributes.iColor.needsUpdate = true;
    if (this.liveCount === 0) this.mesh.count = 0;
  }
}

const Y_AXIS = new THREE.Vector3(0, 1, 0);
const X_AXIS = new THREE.Vector3(1, 0, 0);
