import * as THREE from 'three';

export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const invLerp = (a, b, v) => (a === b ? 0 : (v - a) / (b - a));
export const saturate = v => (v < 0 ? 0 : v > 1 ? 1 : v);
export const smoothstep = (a, b, v) => { const t = saturate((v - a) / (b - a)); return t * t * (3 - 2 * t); };

/** Frame-rate independent exponential smoothing factor: value = lerp(value, target, damp(k, dt)). */
export const damp = (k, dt) => 1 - Math.exp(-k * dt);

/** Move `current` towards `target` by at most `maxDelta`. */
export const approach = (current, target, maxDelta) =>
  current < target ? Math.min(current + maxDelta, target) : Math.max(current - maxDelta, target);

export const randRange = (a, b) => a + Math.random() * (b - a);
export const randInt = (a, b) => Math.floor(a + Math.random() * (b - a + 1));
export const pick = arr => arr[Math.floor(Math.random() * arr.length)];
export const chance = p => Math.random() < p;

/** Wrap an angle to [-PI, PI]. */
export function wrapAngle(a) {
  a = (a + Math.PI) % TAU;
  if (a < 0) a += TAU;
  return a - Math.PI;
}

/** Shortest signed difference b - a between two angles, in [-PI, PI]. */
export const angleDiff = (a, b) => wrapAngle(b - a);

/**
 * Yaw convention: yaw = 0 looks down -Z; positive yaw turns left (counter-clockwise seen from above).
 * forward = (-sin(yaw), 0, -cos(yaw)), right = (cos(yaw), 0, -sin(yaw)).
 */
export const yawFromDirection = (dx, dz) => Math.atan2(-dx, -dz);

/** Unit view direction from yaw/pitch (pitch > 0 looks up). */
export function directionFromYawPitch(yaw, pitch, out = new THREE.Vector3()) {
  const cp = Math.cos(pitch);
  return out.set(-Math.sin(yaw) * cp, Math.sin(pitch), -Math.cos(yaw) * cp);
}

export function forwardFromYaw(yaw, out = new THREE.Vector3()) {
  return out.set(-Math.sin(yaw), 0, -Math.cos(yaw));
}

export function rightFromYaw(yaw, out = new THREE.Vector3()) {
  return out.set(Math.cos(yaw), 0, -Math.sin(yaw));
}

const _coneA = new THREE.Vector3();
const _coneB = new THREE.Vector3();
/**
 * Random direction inside a cone of half-angle `angle` (radians) around unit vector `dir`.
 * Uniform over the cone's solid angle, biased slightly to the center (nicer spread).
 */
export function randomInCone(dir, angle, out = new THREE.Vector3()) {
  if (angle <= 0) return out.copy(dir);
  // orthonormal basis around dir
  const up = Math.abs(dir.y) < 0.99 ? _coneA.set(0, 1, 0) : _coneA.set(1, 0, 0);
  const u = _coneB.crossVectors(dir, up).normalize();
  const v = up.crossVectors(u, dir).normalize();
  const r = Math.tan(angle) * Math.sqrt(Math.random()) * (0.6 + 0.4 * Math.random());
  const a = Math.random() * TAU;
  out.copy(dir).addScaledVector(u, Math.cos(a) * r).addScaledVector(v, Math.sin(a) * r);
  return out.normalize();
}

/** Seeded PRNG (mulberry32). Returns a function producing floats in [0, 1). */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Parse '#rrggbb' / 0xrrggbb / THREE.Color into a THREE.Color. */
export function toColor(c, out = new THREE.Color()) {
  if (c instanceof THREE.Color) return out.copy(c);
  return out.set(c);
}

/** Array [x,y,z] or Vector3 -> new Vector3. */
export function vec3(a) {
  if (!a) return new THREE.Vector3();
  if (a.isVector3) return a.clone();
  return new THREE.Vector3(a[0] || 0, a[1] || 0, a[2] || 0);
}

/**
 * Dispose geometries (and optionally materials/textures) of an object tree.
 * Shared/cached materials must NOT be disposed - pass disposeMaterials=false for those trees.
 */
export function disposeObject(root, disposeMaterials = false) {
  root.traverse(obj => {
    if (obj.geometry) obj.geometry.dispose();
    if (disposeMaterials && obj.material) {
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      for (const m of mats) {
        for (const key of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'alphaMap', 'aoMap']) {
          if (m[key]) m[key].dispose();
        }
        m.dispose();
      }
    }
  });
}

/** Simple object pool. factory() creates, reset(obj) is called on release. */
export class Pool {
  constructor(factory, reset = null) {
    this.factory = factory;
    this.reset = reset;
    this.free = [];
  }
  get() { return this.free.length ? this.free.pop() : this.factory(); }
  release(obj) { if (this.reset) this.reset(obj); this.free.push(obj); }
}

/** Resolves on the next animation frame (lets the browser paint loading screens). */
export const nextFrame = () => new Promise(r => requestAnimationFrame(() => r()));
