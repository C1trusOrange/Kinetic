/**
 * Low-poly modelling kit for the weapon models: chamfered boxes, side-profile extrusions, tapered
 * cylinders, lathes, limbs and beams, all authored in ROOT space (meters, origin at the right-hand
 * grip, bore along -Z, +Y up, +X right) and merged per (part, material) at build time.
 *
 * Pipeline per primitive: create local geometry (non-indexed, flat/smooth normals) -> transform into root
 * space -> project UVs (box projection scaled per material, or the primitive's own cylindrical UVs) ->
 * bake an "edge" vertex colour (bevel faces read brighter = worn bare metal) -> bucket by (part, material).
 * `build()` merges every bucket, re-centres each part on its pivot and returns a cacheable template.
 */
import * as THREE from 'three';
import { ExtrudeGeometry } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { getMaterials, UV_SCALE, DEFAULT_UV_SCALE } from './WeaponMaterials.js';

const V0 = new THREE.Vector3();
const V1 = new THREE.Vector3();
const V2 = new THREE.Vector3();
const MAT = new THREE.Matrix4();
const QUAT = new THREE.Quaternion();
const EUL = new THREE.Euler();
const ONE = new THREE.Vector3(1, 1, 1);
const UP = new THREE.Vector3(0, 1, 0);

/** Brightness of flat (non-bevel) faces relative to bevel edges in the baked vertex colour. */
const FACE_SHADE = 0.74;
const CURVED_SHADE = 0.82;

// ------------------------------------------------------------------ raw geometry generators

/** Chamfered box, 44 triangles (12 without chamfer). Attributes: position, normal, edge. */
export function chamferBoxGeometry(w, h, d, t) {
  const a = w / 2, b = h / 2, c = d / 2;
  t = Math.max(0, Math.min(t, a * 0.95, b * 0.95, c * 0.95));
  const pos = [], nor = [], edge = [];
  const tri = (p, q, r, e) => {
    const ux = q[0] - p[0], uy = q[1] - p[1], uz = q[2] - p[2];
    const vx = r[0] - p[0], vy = r[1] - p[1], vz = r[2] - p[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const cx = p[0] + q[0] + r[0], cy = p[1] + q[1] + r[1], cz = p[2] + q[2] + r[2];
    if (nx * cx + ny * cy + nz * cz < 0) { const s = q; q = r; r = s; nx = -nx; ny = -ny; nz = -nz; }
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l; ny /= l; nz /= l;
    for (const P of [p, q, r]) { pos.push(P[0], P[1], P[2]); nor.push(nx, ny, nz); edge.push(e); }
  };
  const quad = (p, q, r, s, e) => { tri(p, q, r, e); tri(p, r, s, e); };
  const H = [a, b, c];
  const sgn = [-1, 1];
  // main faces
  for (let ax = 0; ax < 3; ax++) {
    const i = (ax + 1) % 3, j = (ax + 2) % 3;
    for (const s of sgn) {
      const mk = (si, sj) => { const p = [0, 0, 0]; p[ax] = s * H[ax]; p[i] = si * (H[i] - t); p[j] = sj * (H[j] - t); return p; };
      quad(mk(-1, -1), mk(1, -1), mk(1, 1), mk(-1, 1), 0);
    }
  }
  if (t > 1e-6) {
    // edge strips
    for (let ai = 0; ai < 3; ai++) {
      for (let aj = ai + 1; aj < 3; aj++) {
        const ak = 3 - ai - aj;
        for (const si of sgn) for (const sj of sgn) {
          const p1 = (sk) => { const p = [0, 0, 0]; p[ai] = si * H[ai]; p[aj] = sj * (H[aj] - t); p[ak] = sk * (H[ak] - t); return p; };
          const p2 = (sk) => { const p = [0, 0, 0]; p[ai] = si * (H[ai] - t); p[aj] = sj * H[aj]; p[ak] = sk * (H[ak] - t); return p; };
          quad(p1(-1), p1(1), p2(1), p2(-1), 1);
        }
      }
    }
    // corners
    for (const sx of sgn) for (const sy of sgn) for (const sz of sgn) {
      tri([sx * a, sy * (b - t), sz * (c - t)], [sx * (a - t), sy * b, sz * (c - t)], [sx * (a - t), sy * (b - t), sz * c], 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('edge', new THREE.Float32BufferAttribute(edge, 1));
  return g;
}

/** Chops the corners of a closed 2D polygon (array of [x,y]) by distance c (number or per-vertex array). */
export function chamferPoly(pts, c, keep = []) {
  const out = [];
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const p = pts[i], a = pts[(i + n - 1) % n], b = pts[(i + 1) % n];
    const ci = Array.isArray(c) ? c[i] : c;
    if (!ci || keep.includes(i)) { out.push(p); continue; }
    const la = Math.hypot(a[0] - p[0], a[1] - p[1]), lb = Math.hypot(b[0] - p[0], b[1] - p[1]);
    const ca = Math.min(ci, la * 0.45), cb = Math.min(ci, lb * 0.45);
    out.push([p[0] + (a[0] - p[0]) / la * ca, p[1] + (a[1] - p[1]) / la * ca]);
    out.push([p[0] + (b[0] - p[0]) / lb * cb, p[1] + (b[1] - p[1]) / lb * cb]);
  }
  return out;
}

/** Regular polygon profile (n sides, radius r) - handy for octagonal barrels and receivers. */
export function ngon(n, r, rot = Math.PI / n, sx = 1, sy = 1) {
  const pts = [];
  for (let i = 0; i < n; i++) pts.push([Math.cos(rot + i / n * Math.PI * 2) * r * sx, Math.sin(rot + i / n * Math.PI * 2) * r * sy]);
  return pts;
}

/** Rectangle profile with chamfered corners. */
export function rectProfile(w, h, c, cx = 0, cy = 0) {
  const a = w / 2, b = h / 2;
  return chamferPoly([[cx - a, cy - b], [cx + a, cy - b], [cx + a, cy + b], [cx - a, cy + b]], c);
}

function edgeFromExtrude(geo) {
  const nor = geo.attributes.normal;
  const e = new Float32Array(nor.count);
  for (let i = 0; i < nor.count; i++) {
    const z = Math.abs(nor.getZ(i));
    e[i] = z > 0.2 && z < 0.96 ? 1 : 0;
  }
  geo.setAttribute('edge', new THREE.BufferAttribute(e, 1));
}

function constEdge(geo, v) {
  geo.setAttribute('edge', new THREE.BufferAttribute(new Float32Array(geo.attributes.position.count).fill(v), 1));
}

// ------------------------------------------------------------------ builder

class PartData {
  constructor(name, pivot, parent) {
    this.name = name;
    this.pivot = pivot;
    this.parent = parent;
    this.buckets = new Map();
  }
}

/**
 * Collects primitives into named parts and materials. All positions are in root space.
 */
export class ModelBuilder {
  /**
   * @param {{hi?: boolean, lod?: number}} [o] hi = high level of detail (view models, lod 2); world models use
   *   lod 1 (bevels kept, tiny details dropped) or lod 0 (plain boxes, 8-sided cylinders) when over budget.
   */
  constructor({ hi = false, lod = 0 } = {}) {
    this.hi = hi;
    this.lod = hi ? 2 : lod;
    this.parts = new Map();
    this.markers = {};
    this.part('body', [0, 0, 0], null);
    this.cur = 'body';
    this.flat = !hi; // world models collapse every part into 'body'
  }

  /** Declares (or selects) a part. Pivot is a root-space point; `parent` a previously declared part name. */
  part(name, pivot = [0, 0, 0], parent = null) {
    if (this.flat) { this.cur = 'body'; return this; } // world models: no animated parts, one mesh per material
    if (!this.parts.has(name)) this.parts.set(name, new PartData(name, pivot.slice(), parent));
    this.cur = name;
    return this;
  }

  /** Selects the part that following primitives are added to. */
  use(name) {
    if (this.flat) { this.cur = 'body'; return this; }
    if (!this.parts.has(name)) throw new Error('unknown part ' + name);
    this.cur = name;
    return this;
  }

  /** Registers a named marker (muzzle, sight, ejectPort, ...). */
  marker(name, p) { this.markers[name] = p.slice(); return this; }

  // -------------------------------------------------------------- core push

  _push(mat, geo, uvMode = 'box', shade = FACE_SHADE) {
    const part = this.parts.get(this.cur);
    if (geo.index) geo = geo.toNonIndexed();
    geo.clearGroups();
    if (this.lod < 2) {
      // low LOD: skip tiny details entirely
      geo.computeBoundingBox();
      const bb = geo.boundingBox;
      const dx = bb.max.x - bb.min.x, dy = bb.max.y - bb.min.y, dz = bb.max.z - bb.min.z;
      if (Math.max(dx, dy, dz) < (this.lod === 1 ? 0.01 : 0.016) && !mat.startsWith('reticle') && mat !== 'lens') return this;
    }
    for (const k of Object.keys(geo.attributes)) if (!['position', 'normal', 'uv', 'edge'].includes(k)) geo.deleteAttribute(k);
    if (!geo.attributes.edge) constEdge(geo, 0);
    const s = UV_SCALE[mat] || DEFAULT_UV_SCALE;
    if (uvMode === 'box' || !geo.attributes.uv) boxUV(geo, s);
    // vertex colour from edge weight
    const pos = geo.attributes.position, edge = geo.attributes.edge;
    const col = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const e = edge.getX(i);
      const c = shade + (1 - shade) * e;
      col[i * 3] = c; col[i * 3 + 1] = c * 1.0; col[i * 3 + 2] = c * 1.02;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.deleteAttribute('edge');
    let list = part.buckets.get(mat);
    if (!list) { list = []; part.buckets.set(mat, list); }
    list.push(geo);
    return this;
  }

  _xf(geo, pos, rot = null, scl = null) {
    if (rot) EUL.set(rot[0], rot[1], rot[2], rot[3] || 'XYZ'); else EUL.set(0, 0, 0);
    QUAT.setFromEuler(EUL);
    V0.set(pos[0], pos[1], pos[2]);
    if (scl) V1.set(scl[0], scl[1], scl[2]); else V1.copy(ONE);
    MAT.compose(V0, QUAT, V1);
    geo.applyMatrix4(MAT);
    return geo;
  }

  // -------------------------------------------------------------- primitives

  /**
   * Chamfered box centred on `pos`.
   * @param {string} mat material key
   * @param {number[]} size [w,h,d]
   * @param {number[]} pos [x,y,z]
   * @param {{bevel?:number, rot?:number[]}} [o]
   */
  box(mat, size, pos, o = {}) {
    let bevel = o.bevel ?? Math.min(0.004, Math.min(size[0], size[1], size[2]) * 0.22);
    if (this.lod < 2 && Math.min(size[0], size[1], size[2]) < (this.lod === 1 ? 0.014 : 0.034)) bevel = 0; // low LOD: plain boxes for small parts
    const g = chamferBoxGeometry(size[0], size[1], size[2], bevel);
    this._xf(g, pos, o.rot);
    return this._push(mat, g, 'box', o.shade ?? FACE_SHADE);
  }

  /** Plain 12-triangle box (for tiny details). */
  cube(mat, size, pos, o = {}) {
    return this.box(mat, size, pos, { ...o, bevel: 0 });
  }

  /**
   * Chamfered box between two points: local Z runs from -> to, local Y approximates `up`.
   * @param {number[]} from
   * @param {number[]} to
   * @param {{w?:number,h?:number,up?:number[],bevel?:number,ext0?:number,ext1?:number}} o
   */
  beam(mat, from, to, o = {}) {
    V0.set(to[0] - from[0], to[1] - from[1], to[2] - from[2]);
    const len = V0.length() + (o.ext0 || 0) + (o.ext1 || 0);
    if (len < 1e-6) return this;
    V0.normalize();
    const up = o.up ? V1.set(o.up[0], o.up[1], o.up[2]) : V1.copy(UP);
    if (Math.abs(up.dot(V0)) > 0.98) up.set(1, 0, 0);
    up.addScaledVector(V0, -up.dot(V0)).normalize();
    V2.crossVectors(up, V0).normalize();
    // basis: x = up x z, y = up, z = dir  (right handed)
    MAT.makeBasis(V2, up, V0);
    const cx = (from[0] + to[0]) / 2 + V0.x * ((o.ext1 || 0) - (o.ext0 || 0)) / 2;
    const cy = (from[1] + to[1]) / 2 + V0.y * ((o.ext1 || 0) - (o.ext0 || 0)) / 2;
    const cz = (from[2] + to[2]) / 2 + V0.z * ((o.ext1 || 0) - (o.ext0 || 0)) / 2;
    MAT.setPosition(cx, cy, cz);
    const w = o.w ?? 0.02, h = o.h ?? 0.02;
    const g = chamferBoxGeometry(w, h, len, o.bevel ?? Math.min(0.003, Math.min(w, h) * 0.22));
    g.applyMatrix4(MAT);
    return this._push(mat, g, 'box', o.shade ?? FACE_SHADE);
  }

  /**
   * Extruded profile. axis 'x': profile is [forward, up] pairs (side view, forward = -Z) extruded along X with
   * total `width` centred at `cx`. axis 'z': profile is [x, y] pairs extruded along Z from z0 to z1.
   * @param {string} mat
   * @param {number[][]} profile
   * @param {{axis?:string,width?:number,cx?:number,z0?:number,z1?:number,bevel?:number,holes?:number[][][]}} o
   */
  ext(mat, profile, o = {}) {
    const bevel = this.lod >= 1 ? (o.bevel ?? 0.0022) : 0;
    const axis = o.axis || 'x';
    const shape = new THREE.Shape(profile.map(p => new THREE.Vector2(p[0], p[1])));
    for (const h of o.holes || []) shape.holes.push(new THREE.Path(h.map(p => new THREE.Vector2(p[0], p[1]))));
    const total = axis === 'x' ? (o.width ?? 0.03) : (o.z1 - o.z0);
    const depth = Math.max(0.0005, total - 2 * bevel);
    const g = new ExtrudeGeometry(shape, {
      depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 1, steps: 1, curveSegments: 1,
    });
    edgeFromExtrude(g);
    if (axis === 'x') {
      g.translate(0, 0, -depth / 2);
      g.rotateY(Math.PI / 2); // (sx, sy, sz) -> (sz, sy, -sx): forward = +sx becomes -Z
      g.translate(o.cx || 0, 0, 0);
    } else {
      g.translate(0, 0, o.z0 + bevel);
    }
    if (o.rot || o.pos) this._xf(g, o.pos || [0, 0, 0], o.rot);
    return this._push(mat, g, 'box', o.shade ?? FACE_SHADE);
  }

  /**
   * Cylinder / cone along an axis. r = base (rear / bottom) radius, r2 = front / top radius.
   * axis 'z': front (r2) at -Z. axis 'y': r2 at +Y. axis 'x': r2 at +X.
   */
  cyl(mat, o) {
    const r = o.r, r2 = o.r2 ?? o.r, len = o.len;
    const seg = this.lod === 2 ? (o.seg ?? 10) : Math.min(o.seg ?? 10, this.lod === 1 ? 10 : 8);
    const g = new THREE.CylinderGeometry(r2, r, len, seg, 1, o.cap === false);
    const su = UV_SCALE[mat] || DEFAULT_UV_SCALE;
    const uv = g.attributes.uv, pos = g.attributes.position, nor = g.attributes.normal;
    const rep = Math.max(1, Math.round(Math.PI * 2 * Math.max(r, r2) / su));
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      if (Math.abs(nor.getY(i)) > 0.98) uv.setXY(i, x / su, z / su);
      else uv.setXY(i, (y + len / 2) / su, Math.atan2(z, x) / (Math.PI * 2) * rep);
    }
    constEdge(g, 0.3);
    const ax = o.axis || 'z';
    if (ax === 'z') g.rotateX(-Math.PI / 2); else if (ax === 'x') g.rotateZ(-Math.PI / 2);
    if (o.scaleXY) g.scale(o.scaleXY[0], o.scaleXY[1], 1);
    this._xf(g, o.pos || [0, 0, 0], o.rot);
    return this._push(mat, g, 'keep', CURVED_SHADE);
  }

  /**
   * Tapered prism between two points (finger segments, sleeves, struts).
   * @param {number[]} from
   * @param {number[]} to
   * @param {number} r0 radius at from
   * @param {number} r1 radius at to
   * @param {{seg?:number, capFrom?:boolean, capTo?:boolean}} [o]
   */
  limb(mat, from, to, r0, r1, o = {}) {
    V0.set(to[0] - from[0], to[1] - from[1], to[2] - from[2]);
    let len = V0.length();
    if (len < 1e-6) return this;
    V0.normalize();
    if (o.ext0 || o.ext1) {
      const e0 = o.ext0 || 0, e1 = o.ext1 || 0;
      from = [from[0] - V0.x * e0, from[1] - V0.y * e0, from[2] - V0.z * e0];
      to = [to[0] + V0.x * e1, to[1] + V0.y * e1, to[2] + V0.z * e1];
      len += e0 + e1;
    }
    const seg = o.seg ?? 6;
    const rmax = Math.max(r0, r1);
    const g = new THREE.CylinderGeometry(r1, r0, len, seg, 1, false);
    if (o.capFrom === false || o.capTo === false) {
      // drop cap triangles: rebuild as open-ended and add the wanted caps back
      const open = new THREE.CylinderGeometry(r1, r0, len, seg, 1, true);
      const parts = [open];
      if (o.capTo !== false) parts.push(new THREE.CircleGeometry(r1, seg).rotateX(-Math.PI / 2).translate(0, len / 2, 0));
      if (o.capFrom !== false) parts.push(new THREE.CircleGeometry(r0, seg).rotateX(Math.PI / 2).translate(0, -len / 2, 0));
      const m = mergeGeometries(parts.map(p => p.index ? p.toNonIndexed() : p), false);
      g.dispose();
      return this._limbFinish(mat, m, from, to, len, rmax);
    }
    return this._limbFinish(mat, g, from, to, len, rmax);
  }

  _limbFinish(mat, g, from, to, len, rmax) {
    const su = UV_SCALE[mat] || DEFAULT_UV_SCALE;
    const uv = g.attributes.uv, pos = g.attributes.position, nor = g.attributes.normal;
    const rep = Math.max(1, Math.round(Math.PI * 2 * rmax / su));
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      if (Math.abs(nor.getY(i)) > 0.98) uv.setXY(i, x / su, z / su);
      else uv.setXY(i, (y + len / 2) / su, Math.atan2(z, x) / (Math.PI * 2) * rep);
    }
    constEdge(g, 0.35);
    V0.set(to[0] - from[0], to[1] - from[1], to[2] - from[2]).normalize();
    QUAT.setFromUnitVectors(UP, V0);
    MAT.compose(V1.set((from[0] + to[0]) / 2, (from[1] + to[1]) / 2, (from[2] + to[2]) / 2), QUAT, ONE);
    g.applyMatrix4(MAT);
    return this._push(mat, g, 'keep', CURVED_SHADE);
  }

  /** Lathe (surface of revolution). profile = [radius, along] pairs with `along` measured on the axis. */
  lathe(mat, profile, o = {}) {
    const seg = o.seg ?? 10;
    const g = new THREE.LatheGeometry(profile.map(p => new THREE.Vector2(p[0], p[1])), seg);
    const su = UV_SCALE[mat] || DEFAULT_UV_SCALE;
    const uv = g.attributes.uv, pos = g.attributes.position;
    let rmax = 0.001;
    for (let i = 0; i < pos.count; i++) rmax = Math.max(rmax, Math.hypot(pos.getX(i), pos.getZ(i)));
    const rep = Math.max(1, Math.round(Math.PI * 2 * rmax / su));
    for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getY(i) / su, Math.atan2(pos.getZ(i), pos.getX(i)) / (Math.PI * 2) * rep);
    constEdge(g, 0.35);
    const ax = o.axis || 'y';
    if (ax === 'z') g.rotateX(-Math.PI / 2); else if (ax === 'x') g.rotateZ(-Math.PI / 2);
    this._xf(g, o.pos || [0, 0, 0], o.rot);
    return this._push(mat, g, 'keep', CURVED_SHADE);
  }

  /** UV sphere (optionally squashed via `scl`). */
  sphere(mat, r, pos, o = {}) {
    const g = this.lod >= 1 ? new THREE.SphereGeometry(r, o.ws ?? 8, o.hs ?? 6) : new THREE.SphereGeometry(r, Math.min(o.ws ?? 8, 6), Math.min(o.hs ?? 6, 4));
    const su = UV_SCALE[mat] || DEFAULT_UV_SCALE;
    const k = Math.PI * 2 * r / su;
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * k, uv.getY(i) * k * 0.5);
    constEdge(g, 0.4);
    this._xf(g, pos, o.rot, o.scl);
    return this._push(mat, g, 'keep', CURVED_SHADE);
  }

  /** Torus ring. */
  torus(mat, r, tube, pos, o = {}) {
    const g = this.lod >= 1 ? new THREE.TorusGeometry(r, tube, o.ts ?? 5, o.rs ?? 12) : new THREE.TorusGeometry(r, tube, 3, Math.min(o.rs ?? 12, 8));
    const su = UV_SCALE[mat] || DEFAULT_UV_SCALE;
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * r * 6.28 / su, uv.getY(i) * tube * 6.28 / su);
    constEdge(g, 0.4);
    this._xf(g, pos, o.rot);
    return this._push(mat, g, 'keep', CURVED_SHADE);
  }

  /**
   * Flat decal / plane facing the given side of the gun.
   * @param {string} mat material key or a THREE.Material (label materials)
   * @param {number[]} size [w,h]
   * @param {number[]} pos
   * @param {{face?:string, rot?:number}} [o] face: 'left' (-X, default), 'right' (+X), 'top' (+Y), 'back' (+Z), 'front' (-Z)
   */
  decal(material, size, pos, o = {}) {
    const g = new THREE.PlaneGeometry(size[0], size[1]);
    const face = o.face || 'left';
    if (o.rot) g.rotateZ(o.rot);
    if (face === 'left') g.rotateY(-Math.PI / 2);
    else if (face === 'right') g.rotateY(Math.PI / 2);
    else if (face === 'top') g.rotateX(-Math.PI / 2);
    else if (face === 'front') g.rotateY(Math.PI);
    g.translate(pos[0], pos[1], pos[2]);
    constEdge(g, 1);
    const key = typeof material === 'string' ? material : this._customMat(material);
    return this._push(key, g, 'keep', 1);
  }

  _customMat(m) {
    if (!this._custom) this._custom = new Map();
    let k = m.uuid;
    this._custom.set(k, m);
    return 'custom:' + k;
  }

  /**
   * Adds a geometry that already carries position/normal/uv/color attributes (e.g. the rocket flame) as is.
   * @param {string} mat material key
   * @param {THREE.BufferGeometry} geometry non-indexed geometry
   */
  raw(mat, geometry) {
    const part = this.parts.get(this.cur);
    let list = part.buckets.get(mat);
    if (!list) { list = []; part.buckets.set(mat, list); }
    list.push(geometry);
    return this;
  }

  /** Adds an arbitrary geometry (any attributes) transformed into root space. */
  geo(mat, geometry, pos = [0, 0, 0], rot = null, o = {}) {
    const g = geometry.clone();
    this._xf(g, pos, rot);
    if (!g.attributes.uv) boxUV(g, UV_SCALE[mat] || DEFAULT_UV_SCALE);
    return this._push(mat, g, o.uv || 'box', o.shade ?? FACE_SHADE);
  }

  // -------------------------------------------------------------- output

  /** Merges buckets and returns the cacheable template. */
  build() {
    const parts = {};
    let tris = 0;
    for (const [name, p] of this.parts) {
      const meshes = [];
      for (const [mat, list] of p.buckets) {
        const g = list.length === 1 ? list[0] : mergeGeometries(list, false);
        g.translate(-p.pivot[0], -p.pivot[1], -p.pivot[2]);
        g.computeBoundingSphere();
        g.computeBoundingBox();
        tris += g.attributes.position.count / 3;
        meshes.push({ geometry: g, mat });
      }
      parts[name] = { pivot: p.pivot, parent: p.parent, meshes };
    }
    return { parts, markers: this.markers, tris: Math.round(tris), custom: this._custom || null };
  }
}

/** Box-projected UVs in the geometry's current space (u runs along the gun's length). */
export function boxUV(geo, s) {
  const pos = geo.attributes.position, nor = geo.attributes.normal;
  let uv = geo.attributes.uv;
  if (!uv) { uv = new THREE.BufferAttribute(new Float32Array(pos.count * 2), 2); geo.setAttribute('uv', uv); }
  for (let i = 0; i < pos.count; i += 3) {
    const nx = Math.abs(nor.getX(i)), ny = Math.abs(nor.getY(i)), nz = Math.abs(nor.getZ(i));
    for (let k = 0; k < 3; k++) {
      const x = pos.getX(i + k), y = pos.getY(i + k), z = pos.getZ(i + k);
      if (nx >= ny && nx >= nz) uv.setXY(i + k, -z / s, y / s);
      else if (ny >= nz) uv.setXY(i + k, -z / s, x / s);
      else uv.setXY(i + k, x / s, y / s);
    }
  }
  uv.needsUpdate = true;
}

/**
 * Creates a fresh object tree (Groups + Meshes sharing geometry/materials) from a template.
 * @param {ReturnType<ModelBuilder['build']>} tpl
 * @param {{view:boolean}} o
 * @returns {{root: THREE.Group, parts: Object<string, THREE.Group>, markers: Object<string, THREE.Object3D>}}
 */
export function instantiate(tpl, { view = false } = {}) {
  const M = getMaterials();
  const root = new THREE.Group();
  const parts = {};
  const order = Object.keys(tpl.parts);
  const groups = {};
  // parents first
  const done = new Set();
  const make = (name) => {
    if (done.has(name)) return;
    const p = tpl.parts[name];
    if (p.parent && !done.has(p.parent)) make(p.parent);
    let holder;
    if (name === 'body') holder = root;
    else {
      holder = new THREE.Group();
      holder.name = name;
      const par = p.parent ? tpl.parts[p.parent] : null;
      holder.position.set(p.pivot[0] - (par ? par.pivot[0] : 0), p.pivot[1] - (par ? par.pivot[1] : 0), p.pivot[2] - (par ? par.pivot[2] : 0));
      (p.parent ? groups[p.parent] : root).add(holder);
      parts[name] = holder;
      holder.userData.rest = { position: holder.position.clone(), quaternion: holder.quaternion.clone() };
    }
    groups[name] = holder;
    for (const m of p.meshes) {
      const material = m.mat.startsWith('custom:') ? tpl.custom.get(m.mat.slice(7)) : M[m.mat];
      if (!material) throw new Error('WeaponModels: unknown material ' + m.mat);
      const mesh = new THREE.Mesh(m.geometry, material);
      mesh.matrixAutoUpdate = false;
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      if (view) mesh.frustumCulled = false;
      mesh.name = name + ':' + m.mat;
      holder.add(mesh);
    }
    done.add(name);
  };
  for (const name of order) make(name);
  const markers = {};
  for (const [k, p] of Object.entries(tpl.markers)) {
    const o = new THREE.Object3D();
    o.name = k;
    o.position.fromArray(p);
    root.add(o);
    markers[k] = o;
  }
  return { root, parts, markers };
}
