import * as THREE from 'three';
import { getMaterial, getMaterialInfo, MATERIAL_NAMES } from './Textures.js';

/**
 * MapBuilder: turns `def.solids` (see ARCHITECTURE.md 6.3) into
 *   - render meshes merged per material (world-space, tangent-plane projected UVs scaled by
 *     getMaterialInfo(mat).scale, so textures are continuous across neighbouring pieces),
 *   - collision triangles (added to a CollisionWorld) tagged with the material's surface type,
 *   - a flat triangle list used by the NavGraph.
 *
 * Two phases so the World can generate exactly the textures the map needs:
 *   const b = new MapBuilder(def, collision);  b.buildGeometry();  -> b.materialNames
 *   await preloadMaterials(b.materialNames);   b.createMeshes();
 *
 * Designer notes
 *   - Default materials: crate 'crate' . container 'container_<color>' . railing 'metal_painted_yellow' .
 *     catwalk deck 'metal_grate' (steel structure 'metal_dark', rails 'metal_painted_yellow') .
 *     panel 'light_panel' (no collision, no shadow) . everything else 'concrete'.
 *   - `top` / `bottom` are the +Y / -Y face materials of box, wall, container, cylinder caps and pillar;
 *     for ramp and stairs `top` is the walking surface (slope / treads).
 *   - Every solid is a closed piece (the NavGraph and collision rely on that). Overlapping solids are fine,
 *     but coplanar overlapping faces of DIFFERENT materials will z-fight - keep them 1-2 cm apart.
 *   - Collision uses simplified geometry (plain boxes for bevelled / detailed pieces, a smooth ramp for
 *     stairs); details (container ribs, railing posts, catwalk beams, panels) never collide.
 *   - `visible:false` solids collide but never render and never count as walkable floor for bots.
 *   - Emissive materials (neon, light panels) never cast or receive shadows.
 *
 * Extras beyond the documented format (all optional, safe to ignore):
 *   any solid: nav:false (bots never treat its top as floor) . surface (override collision surface)
 *   box/wall: bevel (chamfer size in metres) . cylinder: axis 'x'|'y'|'z' (lay pipes down), flat (facet shading)
 *   catwalk: railMat, railHeight . railing: mat, height
 */

const UP = new THREE.Vector3(0, 1, 0);
const TAU = Math.PI * 2;
const MAX_SLOPE_DEG = 33;

// six box faces: outward normal n, in-plane axes u,v (u x v = n), indices into half-extents
const FACES = [
  { n: [1, 0, 0], u: [0, 0, -1], v: [0, 1, 0], hn: 0, hu: 2, hv: 1 },
  { n: [-1, 0, 0], u: [0, 0, 1], v: [0, 1, 0], hn: 0, hu: 2, hv: 1 },
  { n: [0, 1, 0], u: [1, 0, 0], v: [0, 0, -1], hn: 1, hu: 0, hv: 2 },   // top
  { n: [0, -1, 0], u: [1, 0, 0], v: [0, 0, 1], hn: 1, hu: 0, hv: 2 },   // bottom
  { n: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0], hn: 2, hu: 0, hv: 1 },
  { n: [0, 0, -1], u: [-1, 0, 0], v: [0, 1, 0], hn: 2, hu: 0, hv: 1 },
];
const F_TOP = 2;
const F_BOTTOM = 3;
const CORNER_SIGNS = [[-1, -1], [1, -1], [1, 1], [-1, 1]];

const CONTAINER_COLORS = ['red', 'blue', 'green', 'yellow', 'white', 'orange'];
const SOLID_TYPES = ['box', 'wall', 'ramp', 'stairs', 'cylinder', 'pillar', 'arch', 'container', 'crate', 'railing', 'catwalk', 'panel'];

// scratch
const W = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
const _n = new THREE.Vector3();
const _e1 = new THREE.Vector3();
const _e2 = new THREE.Vector3();
const _hint = new THREE.Vector3();
const _cen = new THREE.Vector3();
const _t = new THREE.Vector3();
const _b = new THREE.Vector3();
const _axis = new THREE.Vector3();

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const isNum = v => typeof v === 'number' && Number.isFinite(v);
const isVec = (a, n = 3) => Array.isArray(a) && a.length >= n && a.slice(0, n).every(isNum);

class Bucket {
  constructor(mat, cast) {
    this.mat = mat;
    this.cast = cast;
    this.pos = [];
    this.nor = [];
    this.uv = [];
    this.idx = [];
    this.vc = 0;
    this.tris = 0;
  }
}

export class MapBuilder {
  /**
   * @param {object} def map definition
   * @param {import('./Collision.js').CollisionWorld} collision receives collision triangles
   * @param {(msg:string)=>void} warn validation message sink
   */
  constructor(def, collision, warn = () => {}) {
    this.def = def;
    this.collision = collision;
    this.warn = warn;
    this.buckets = new Map();
    this.infoCache = new Map();
    this.navTris = [];
    this.navFlags = [];
    this._curNoFloor = false;
    this.collisionTriCount = 0;
    this.visualTriCount = 0;
    this.geoBounds = new THREE.Box3();
    this.materialNames = [];
    this.group = null;
    this.meshes = [];
    this._warnedMats = new Set();
    this._solidIndex = -1;
    this._slopeWarned = false;
  }

  // ------------------------------------------------------------------ phase 1: geometry

  /** Build all geometry + collision. Fills materialNames, navTris, geoBounds. */
  buildGeometry() {
    const solids = this.def.solids || [];
    if (!Array.isArray(solids)) {
      this.warn('def.solids must be an array');
      return this;
    }
    for (let i = 0; i < solids.length; i++) {
      const s = solids[i];
      this._solidIndex = i;
      if (!s || typeof s !== 'object') { this.warn(`solid #${i}: not an object`); continue; }
      try {
        this._solid(s, i);
      } catch (err) {
        this.warn(`solid #${i} (${s.type}) failed: ${err.message}`);
        console.error('[MapBuilder]', `solid #${i}`, s, err);
      }
    }
    this.materialNames = Array.from(new Set(Array.from(this.buckets.values()).map(b => b.mat)));
    return this;
  }

  _info(name) {
    let info = this.infoCache.get(name);
    if (!info) {
      info = getMaterialInfo(name) || { surface: 'concrete', scale: 2, emissive: false };
      if (!isNum(info.scale) || info.scale <= 0) info = { ...info, scale: 2 };
      this.infoCache.set(name, info);
      if (MATERIAL_NAMES && MATERIAL_NAMES.length >= 30 && !MATERIAL_NAMES.includes(name) && !this._warnedMats.has(name)) {
        this._warnedMats.add(name);
        this.warn(`unknown material '${name}' (falls back to dev_grid)`);
      }
    }
    return info;
  }

  _bucket(mat, cast) {
    const key = mat + (cast ? '|c' : '|n');
    let b = this.buckets.get(key);
    if (!b) { b = new Bucket(mat, cast); this.buckets.set(key, b); }
    return b;
  }

  /** Per-solid state: transform + defaults. */
  _ctx(s, pos, rotY, d = {}) {
    const M = new THREE.Matrix4().makeRotationY(rotY);
    M.setPosition(pos.x, pos.y, pos.z);
    // invisible collision (boundary extensions) and `nav:false` solids never become bot floors
    this._curNoFloor = s.visible === false || s.nav === false;
    const collideDefault = d.collide ?? true;
    return {
      M,
      mat: s.mat ?? d.mat ?? 'concrete',
      top: s.top,
      bottom: s.bottom,
      cast: (s.shadow ?? d.shadow ?? true) !== false,
      visible: s.visible !== false,
      collide: (s.collide ?? collideDefault) !== false,
      surface: s.surface || null,
    };
  }

  _withMatrix(S, M) {
    return { ...S, M };
  }

  /**
   * Emit one planar polygon (3 or 4 local-space points). Winding is fixed automatically so the
   * normal points away from `o.centroid` (local, default = solid origin) - all pieces are convex.
   */
  _face(S, pts, o = {}) {
    const cnt = pts.length;
    const visual = S.visible && o.visual !== false;
    const collide = S.collide && o.collide !== false;
    if (!visual && !collide) return;
    for (let i = 0; i < cnt; i++) W[i].copy(pts[i]).applyMatrix4(S.M);

    // Newell normal
    _n.set(0, 0, 0);
    for (let i = 0; i < cnt; i++) {
      const a = W[i], b = W[(i + 1) % cnt];
      _n.x += (a.y - b.y) * (a.z + b.z);
      _n.y += (a.z - b.z) * (a.x + b.x);
      _n.z += (a.x - b.x) * (a.y + b.y);
    }
    const len = _n.length();
    if (len < 1e-6) return; // degenerate
    _n.multiplyScalar(1 / len);

    // outward hint
    _cen.set(0, 0, 0);
    for (let i = 0; i < cnt; i++) _cen.add(W[i]);
    _cen.multiplyScalar(1 / cnt);
    if (o.centroid) _hint.copy(o.centroid).applyMatrix4(S.M); else _hint.setFromMatrixPosition(S.M);
    _hint.subVectors(_cen, _hint);
    if (_n.dot(_hint) < 0) {
      _n.negate();
      if (cnt === 4) { const t = W[1]; W[1] = W[3]; W[3] = t; } else { const t = W[1]; W[1] = W[2]; W[2] = t; }
    }

    const matName = o.mat ?? S.mat;
    const info = this._info(matName);
    if (visual) this._emitVisual(matName, info, cnt);
    if (collide) this._emitCollision(o.surface ?? S.surface ?? info.surface, cnt);
  }

  _emitVisual(matName, info, cnt) {
    const bucket = this._bucket(matName, this._castFlag(info));
    const scale = info.scale;
    this._basis(_n);
    const base = bucket.vc;
    for (let i = 0; i < cnt; i++) {
      const p = W[i];
      bucket.pos.push(p.x, p.y, p.z);
      bucket.nor.push(_n.x, _n.y, _n.z);
      bucket.uv.push(p.dot(_t) / scale, p.dot(_b) / scale);
      this.geoBounds.expandByPoint(p);
    }
    if (cnt === 4) bucket.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    else bucket.idx.push(base, base + 1, base + 2);
    bucket.vc += cnt;
    const tris = cnt === 4 ? 2 : 1;
    bucket.tris += tris;
    this.visualTriCount += tris;
  }

  _castFlag(info) {
    return this._curCast !== false && !info.emissive;
  }

  /** Tangent-plane basis (t, b) for a normal: continuous for all faces sharing that normal. */
  _basis(n) {
    if (Math.abs(n.y) < 0.7) {
      const l = Math.hypot(n.x, n.z) || 1;
      _t.set(n.z / l, 0, -n.x / l);
    } else {
      _t.set(1 - n.x * n.x, -n.x * n.y, -n.x * n.z).normalize();
    }
    _b.crossVectors(n, _t);
  }

  _emitCollision(surface, cnt) {
    this._tri(W[0], W[1], W[2], surface);
    if (cnt === 4) this._tri(W[0], W[2], W[3], surface);
  }

  _tri(a, b, c, surface) {
    _e1.subVectors(b, a);
    _e2.subVectors(c, a);
    if (_e1.cross(_e2).lengthSq() < 1e-12) return;
    this.collision.addTriangle(a, b, c, surface);
    this.collisionTriCount++;
    this.navTris.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
    this.navFlags.push(this._curNoFloor ? 1 : 0);
  }

  /** Smooth-shaded visual polygon with explicit normals/uvs (local space) + faceted collision. */
  _smooth(S, pts, normals, uvs, o = {}) {
    const cnt = pts.length;
    if (!S.visible) return;
    const matName = o.mat ?? S.mat;
    const info = this._info(matName);
    const bucket = this._bucket(matName, this._castFlag(info));
    for (let i = 0; i < cnt; i++) W[i].copy(pts[i]).applyMatrix4(S.M);
    // orientation check against the average normal
    _e1.subVectors(W[1], W[0]);
    _e2.subVectors(W[cnt - 1], W[0]);
    _n.crossVectors(_e1, _e2);
    _hint.set(0, 0, 0);
    for (let i = 0; i < cnt; i++) _hint.add(_cen.copy(normals[i]).transformDirection(S.M));
    const flip = _n.dot(_hint) < 0;
    const order = flip ? (cnt === 4 ? [0, 3, 2, 1] : [0, 2, 1]) : (cnt === 4 ? [0, 1, 2, 3] : [0, 1, 2]);
    const base = bucket.vc;
    for (let k = 0; k < cnt; k++) {
      const i = order[k];
      const p = W[i];
      _cen.copy(normals[i]).transformDirection(S.M);
      bucket.pos.push(p.x, p.y, p.z);
      bucket.nor.push(_cen.x, _cen.y, _cen.z);
      bucket.uv.push(uvs[i][0], uvs[i][1]);
      this.geoBounds.expandByPoint(p);
    }
    if (cnt === 4) bucket.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    else bucket.idx.push(base, base + 1, base + 2);
    bucket.vc += cnt;
    const tris = cnt === 4 ? 2 : 1;
    bucket.tris += tris;
    this.visualTriCount += tris;
  }

  // ------------------------------------------------------------------ primitives

  /**
   * Axis-aligned (in solid-local space) box. o: { mat, top, bottom, bevel, visual, collide, skip:[faceIdx] }
   * Hidden-face skipping and bevels are visual only; collision always uses the plain box.
   */
  _box(S, cx, cy, cz, sx, sy, sz, o = {}) {
    const H = [sx / 2, sy / 2, sz / 2];
    const side = o.mat ?? S.mat;
    const top = o.top ?? (o.mat ? o.mat : (S.top ?? side));
    const bottom = o.bottom ?? (o.mat ? o.mat : (S.bottom ?? side));
    const bev = Math.max(0, Math.min(o.bevel || 0, H[0] * 0.49, H[1] * 0.49, H[2] * 0.49));
    const visual = o.visual !== false;
    const collide = o.collide !== false;
    const centroid = V(cx, cy, cz);
    const skip = o.skip || null;

    for (let f = 0; f < 6; f++) {
      if (skip && skip.includes(f)) continue;
      const F = FACES[f];
      const mat = f === F_TOP ? top : f === F_BOTTOM ? bottom : side;
      const hn = H[F.hn], hu = H[F.hu] - bev, hv = H[F.hv] - bev;
      const pts = CORNER_SIGNS.map(([su, sv]) => V(
        cx + F.n[0] * hn + F.u[0] * su * hu + F.v[0] * sv * hv,
        cy + F.n[1] * hn + F.u[1] * su * hu + F.v[1] * sv * hv,
        cz + F.n[2] * hn + F.u[2] * su * hu + F.v[2] * sv * hv));
      this._face(S, pts, { mat, centroid, visual, collide: bev > 0 ? false : collide });
    }
    if (bev > 0) {
      if (collide && S.collide) {
        for (let f = 0; f < 6; f++) {
          if (skip && skip.includes(f)) continue;
          const F = FACES[f];
          const hn = H[F.hn], hu = H[F.hu], hv = H[F.hv];
          const pts = CORNER_SIGNS.map(([su, sv]) => V(
            cx + F.n[0] * hn + F.u[0] * su * hu + F.v[0] * sv * hv,
            cy + F.n[1] * hn + F.u[1] * su * hu + F.v[1] * sv * hv,
            cz + F.n[2] * hn + F.u[2] * su * hu + F.v[2] * sv * hv));
          this._face(S, pts, { mat: side, centroid, visual: false, collide: true });
        }
      }
      if (visual) this._bevelEdges(S, cx, cy, cz, H, bev, side, top, bottom, centroid, skip);
    }
  }

  _bevelEdges(S, cx, cy, cz, H, b, side, top, bottom, centroid, skip) {
    const axes = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
    const at = (n1, h1, n2, h2, e, he, s) => V(
      cx + n1[0] * h1 + n2[0] * h2 + e[0] * he * s,
      cy + n1[1] * h1 + n2[1] * h2 + e[1] * he * s,
      cz + n1[2] * h1 + n2[2] * h2 + e[2] * he * s);
    // edges: pairs of face normals on different axes
    for (let a = 0; a < 3; a++) {
      for (let c = a + 1; c < 3; c++) {
        const e = 3 - a - c;
        for (const sa of [-1, 1]) {
          for (const sc of [-1, 1]) {
            const na = axes[a].map(v => v * sa), nc = axes[c].map(v => v * sc);
            const fa = a * 2 + (sa > 0 ? 0 : 1), fc = c * 2 + (sc > 0 ? 0 : 1);
            if (skip && (skip.includes(fa) || skip.includes(fc))) continue;
            const mat = (fa === F_TOP || fc === F_TOP) ? top : (fa === F_BOTTOM || fc === F_BOTTOM) ? bottom : side;
            const pts = [
              at(na, H[a], nc, H[c] - b, axes[e], H[e] - b, -1),
              at(na, H[a], nc, H[c] - b, axes[e], H[e] - b, 1),
              at(nc, H[c], na, H[a] - b, axes[e], H[e] - b, 1),
              at(nc, H[c], na, H[a] - b, axes[e], H[e] - b, -1),
            ];
            this._face(S, pts, { mat, centroid, collide: false });
          }
        }
      }
    }
    // corners
    for (const sx of [-1, 1]) {
      for (const sy of [-1, 1]) {
        for (const sz of [-1, 1]) {
          const P = (ax, ay, az) => V(cx + sx * ax, cy + sy * ay, cz + sz * az);
          const pts = [
            P(H[0], H[1] - b, H[2] - b),
            P(H[0] - b, H[1], H[2] - b),
            P(H[0] - b, H[1] - b, H[2]),
          ];
          this._face(S, pts, { mat: sy > 0 ? top : sy < 0 ? bottom : side, centroid, collide: false });
        }
      }
    }
  }

  /** Oriented box along the segment p0->p1 (world space). width/depth are the cross-section. */
  _beam(S, p0, p1, width, depth, o = {}) {
    const len = p0.distanceTo(p1);
    if (len < 1e-4) return;
    const dir = _axis.subVectors(p1, p0).multiplyScalar(1 / len).clone();
    const ref = Math.abs(dir.y) > 0.98 ? V(1, 0, 0) : UP;
    const side = new THREE.Vector3().crossVectors(dir, ref).normalize();
    const up = new THREE.Vector3().crossVectors(side, dir).normalize();
    const M = new THREE.Matrix4().makeBasis(dir, up, side);
    M.setPosition((p0.x + p1.x) / 2, (p0.y + p1.y) / 2, (p0.z + p1.z) / 2);
    this._box(this._withMatrix(S, M), 0, 0, 0, len, depth, width, o);
  }

  /**
   * Vertical-axis cylinder / cone frustum in solid-local space (before the solid matrix).
   * o: { mat, top, bottom, flat, visual, collide, capTop, capBottom }
   */
  _cylinder(S, cx, cy, cz, r, rt, h, sides, o = {}) {
    const n = Math.max(3, Math.floor(sides));
    const hy = h / 2;
    const side = o.mat ?? S.mat;
    const topMat = o.top ?? (o.mat ? o.mat : (S.top ?? side));
    const botMat = o.bottom ?? (o.mat ? o.mat : (S.bottom ?? side));
    const visual = o.visual !== false;
    const collide = o.collide !== false;
    const flat = o.flat ?? n <= 8;
    const info = this._info(side);
    const rAvg = (r + rt) / 2;
    const repeats = Math.max(1, Math.round((TAU * rAvg) / info.scale));
    const slope = h > 1e-6 ? (r - rt) / h : 0;
    const ring = (rad, y, i) => {
      const a = (i / n) * TAU;
      return V(cx + Math.cos(a) * rad, cy + y, cz + Math.sin(a) * rad);
    };
    const centroid = V(cx, cy, cz);
    const axisW = _axis.set(0, 1, 0).transformDirection(S.M).clone();
    const centerW = V(cx, cy, cz).applyMatrix4(S.M);
    const cone = rt < 1e-3;
    const vOf = ly => (centerW.dot(axisW) + ly) / info.scale;

    for (let i = 0; i < n; i++) {
      const a0 = (i / n) * TAU, a1 = ((i + 1) / n) * TAU;
      const b0 = ring(r, -hy, i), b1 = ring(r, -hy, i + 1);
      const t0 = ring(rt, hy, i), t1 = ring(rt, hy, i + 1);
      if (collide) {
        if (cone) this._face(S, [b0, b1, V(cx, cy + hy, cz)], { mat: side, centroid, visual: false, collide: true });
        else this._face(S, [b0, b1, t1, t0], { mat: side, centroid, visual: false, collide: true });
      }
      if (!visual) continue;
      const u0 = (i / n) * repeats, u1 = ((i + 1) / n) * repeats;
      let n0, n1;
      if (flat) {
        const am = (a0 + a1) / 2;
        n0 = n1 = V(Math.cos(am), slope, Math.sin(am)).normalize();
      } else {
        n0 = V(Math.cos(a0), slope, Math.sin(a0)).normalize();
        n1 = V(Math.cos(a1), slope, Math.sin(a1)).normalize();
      }
      if (cone) {
        this._smooth(S, [b0, b1, V(cx, cy + hy, cz)], [n0, n1, n0.clone().add(n1).normalize()],
          [[u0, vOf(-hy)], [u1, vOf(-hy)], [(u0 + u1) / 2, vOf(hy)]], { mat: side });
      } else {
        this._smooth(S, [b0, b1, t1, t0], [n0, n1, n1, n0],
          [[u0, vOf(-hy)], [u1, vOf(-hy)], [u1, vOf(hy)], [u0, vOf(hy)]], { mat: side });
      }
    }
    // caps
    if (o.capBottom !== false) {
      const c = V(cx, cy - hy, cz);
      for (let i = 0; i < n; i++) this._face(S, [c, ring(r, -hy, i), ring(r, -hy, i + 1)], { mat: botMat, centroid, visual, collide });
    }
    if (o.capTop !== false && !cone) {
      const c = V(cx, cy + hy, cz);
      for (let i = 0; i < n; i++) this._face(S, [c, ring(rt, hy, i), ring(rt, hy, i + 1)], { mat: topMat, centroid, visual, collide });
    }
  }

  // ------------------------------------------------------------------ solid dispatch

  _solid(s, i) {
    if (!SOLID_TYPES.includes(s.type)) {
      this.warn(`solid #${i}: unknown type '${s.type}' (valid: ${SOLID_TYPES.join(', ')})`);
      return;
    }
    switch (s.type) {
      case 'box': return this._sBox(s, i);
      case 'wall': return this._sWall(s, i);
      case 'ramp': return this._sRamp(s, i, false);
      case 'stairs': return this._sRamp(s, i, true);
      case 'cylinder': return this._sCylinder(s, i);
      case 'pillar': return this._sPillar(s, i);
      case 'arch': return this._sArch(s, i);
      case 'container': return this._sContainer(s, i);
      case 'crate': return this._sCrate(s, i);
      case 'railing': return this._sRailing(s, i);
      case 'catwalk': return this._sCatwalk(s, i);
      case 'panel': return this._sPanel(s, i);
      default: return undefined;
    }
  }

  _pos(s, i, key = 'pos') {
    const p = s[key];
    if (!isVec(p)) { this.warn(`solid #${i} (${s.type}): '${key}' must be [x,y,z]`); return null; }
    return V(p[0], p[1], p[2]);
  }

  _size3(s, i, def = null) {
    let z = s.size;
    if (isNum(z)) z = [z, z, z];
    if (!isVec(z) && def) z = def;
    if (!isVec(z)) { this.warn(`solid #${i} (${s.type}): 'size' must be [w,h,d]`); return null; }
    if (z.some(v => v <= 0)) { this.warn(`solid #${i} (${s.type}): non-positive size ${JSON.stringify(z)}`); return null; }
    return z;
  }

  _rot(s) {
    return isNum(s.rot) ? s.rot : 0;
  }

  _sBox(s, i) {
    let pos, size;
    if (isVec(s.min) && isVec(s.max)) {
      size = [s.max[0] - s.min[0], s.max[1] - s.min[1], s.max[2] - s.min[2]];
      if (size.some(v => v <= 0)) { this.warn(`solid #${i} (box): min/max are inverted or empty`); return; }
      pos = V((s.min[0] + s.max[0]) / 2, (s.min[1] + s.max[1]) / 2, (s.min[2] + s.max[2]) / 2);
    } else {
      pos = this._pos(s, i);
      size = this._size3(s, i);
      if (!pos || !size) return;
    }
    const S = this._ctx(s, pos, this._rot(s));
    this._curCast = S.cast;
    this._box(S, 0, 0, 0, size[0], size[1], size[2], { bevel: s.bevel });
  }

  _sWall(s, i) {
    if (!isVec(s.from, 2) || !isVec(s.to, 2)) { this.warn(`solid #${i} (wall): 'from'/'to' must be [x,z]`); return; }
    const dx = s.to[0] - s.from[0], dz = s.to[1] - s.from[1];
    const len = Math.hypot(dx, dz);
    if (len < 1e-3) { this.warn(`solid #${i} (wall): zero length`); return; }
    const h = isNum(s.height) ? s.height : 3;
    const t = isNum(s.thickness) ? s.thickness : 0.5;
    const y0 = isNum(s.y0) ? s.y0 : 0;
    const pos = V((s.from[0] + s.to[0]) / 2, y0 + h / 2, (s.from[1] + s.to[1]) / 2);
    const S = this._ctx(s, pos, Math.atan2(-dz, dx));
    this._curCast = S.cast;
    this._box(S, 0, 0, 0, len, h, t, { bevel: s.bevel });
  }

  _sRamp(s, i, stairs) {
    const pos = this._pos(s, i);
    const size = this._size3(s, i);
    if (!pos || !size) return;
    const dirs = { '+x': 0, '-x': Math.PI, '+z': -Math.PI / 2, '-z': Math.PI / 2 };
    let dir = s.dir ?? '+x';
    if (!(dir in dirs)) { this.warn(`solid #${i} (${s.type}): dir must be '+x'|'-x'|'+z'|'-z' (got '${dir}')`); dir = '+x'; }
    const alongX = dir === '+x' || dir === '-x';
    const run = alongX ? size[0] : size[2];
    const wid = alongX ? size[2] : size[0];
    const h = size[1];
    const slopeDeg = Math.atan2(h, run) * 180 / Math.PI;
    if (slopeDeg > MAX_SLOPE_DEG && s.collide !== false) {
      this.warn(`solid #${i} (${s.type}): slope ${slopeDeg.toFixed(0)} deg is steeper than ${MAX_SLOPE_DEG} (players cannot walk it)`);
    }
    if (wid < 2.4 && stairs) this.warn(`solid #${i} (stairs): narrower than 2.5 m`);
    const S = this._ctx(s, pos, this._rot(s) + dirs[dir], { collide: true });
    this._curCast = S.cast;
    const hx = run / 2, hy = h / 2, hz = wid / 2;
    const surfMat = s.top ?? S.mat;

    if (!stairs) {
      const A0 = V(-hx, -hy, -hz), A1 = V(-hx, -hy, hz), B0 = V(hx, -hy, -hz), B1 = V(hx, -hy, hz);
      const C0 = V(hx, hy, -hz), C1 = V(hx, hy, hz);
      const centroid = V(hx / 3, -hy / 3, 0);
      this._face(S, [A0, B0, B1, A1], { centroid, mat: S.bottom ?? S.mat });
      this._face(S, [B0, C0, C1, B1], { centroid });
      this._face(S, [A0, A1, C1, C0], { centroid, mat: surfMat });
      this._face(S, [A0, B0, C0], { centroid });
      this._face(S, [A1, C1, B1], { centroid });
      return;
    }

    const n = Math.max(2, Math.round(s.steps ?? h / 0.22));
    const d = run / n;
    const stepH = h / n;
    const bottomMat = S.bottom ?? S.mat;
    // visuals: treads, risers, side walls, back, bottom
    for (let k = 0; k < n; k++) {
      const x0 = -hx + k * d, x1 = x0 + d;
      const yTop = -hy + stepH * (k + 1);
      const yPrev = -hy + stepH * k;
      const centroid = V((x0 + x1) / 2, (-hy + yTop) / 2, 0);
      this._face(S, [V(x0, yTop, -hz), V(x1, yTop, -hz), V(x1, yTop, hz), V(x0, yTop, hz)], { centroid, mat: surfMat, collide: false });
      this._face(S, [V(x0, yPrev, -hz), V(x0, yPrev, hz), V(x0, yTop, hz), V(x0, yTop, -hz)], { centroid, collide: false });
      this._face(S, [V(x0, -hy, -hz), V(x1, -hy, -hz), V(x1, yTop, -hz), V(x0, yTop, -hz)], { centroid, collide: false });
      this._face(S, [V(x0, -hy, hz), V(x1, -hy, hz), V(x1, yTop, hz), V(x0, yTop, hz)], { centroid, collide: false });
    }
    const wc = V(0, 0, 0);
    this._face(S, [V(hx, -hy, -hz), V(hx, hy, -hz), V(hx, hy, hz), V(hx, -hy, hz)], { centroid: wc, collide: false });
    this._face(S, [V(-hx, -hy, -hz), V(hx, -hy, -hz), V(hx, -hy, hz), V(-hx, -hy, hz)], { centroid: wc, mat: bottomMat, collide: false });
    // collision: smooth ramp through the tread midpoints, flush with the top tread
    const lowY = -hy + stepH * 0.5;
    const P = [
      V(-hx, -hy, -hz), V(hx, -hy, -hz), V(hx, hy, -hz), V(-hx, lowY, -hz),
      V(-hx, -hy, hz), V(hx, -hy, hz), V(hx, hy, hz), V(-hx, lowY, hz),
    ];
    const cc = V(0, -hy / 3, 0);
    const cf = { centroid: cc, visual: false, collide: true };
    this._face(S, [P[0], P[1], P[5], P[4]], cf);                 // bottom
    this._face(S, [P[3], P[7], P[6], P[2]], { ...cf, mat: surfMat }); // slope
    this._face(S, [P[1], P[2], P[6], P[5]], cf);                 // back
    this._face(S, [P[0], P[3], P[7], P[4]], cf);                 // front
    this._face(S, [P[0], P[1], P[2], P[3]], cf);                 // side -z
    this._face(S, [P[4], P[5], P[6], P[7]], cf);                 // side +z
  }

  _sCylinder(s, i) {
    const pos = this._pos(s, i);
    if (!pos) return;
    const r = s.radius, h = s.height;
    if (!isNum(r) || r <= 0 || !isNum(h) || h <= 0) { this.warn(`solid #${i} (cylinder): needs positive radius and height`); return; }
    const rt = isNum(s.radiusTop) ? Math.max(0, s.radiusTop) : r;
    let rot = this._rot(s);
    const S = this._ctx(s, pos, rot);
    this._curCast = S.cast;
    if (s.axis === 'x' || s.axis === 'z') {
      // lay the cylinder down: rotate the local Y axis onto X or Z
      const R = new THREE.Matrix4().makeRotationZ(s.axis === 'x' ? -Math.PI / 2 : 0);
      if (s.axis === 'z') R.makeRotationX(Math.PI / 2);
      S.M.multiply(R);
    }
    this._cylinder(S, 0, 0, 0, r, rt, h, s.sides ?? 12, { flat: s.flat });
  }

  _sPillar(s, i) {
    const pos = this._pos(s, i);
    if (!pos) return;
    const r = s.radius, H = s.height;
    if (!isNum(r) || r <= 0 || !isNum(H) || H <= 0) { this.warn(`solid #${i} (pillar): needs positive radius and height`); return; }
    const S = this._ctx(s, pos, this._rot(s));
    this._curCast = S.cast;
    const sides = s.sides ?? 8;
    const bh = Math.min(0.28, H * 0.12), ch = Math.min(0.34, H * 0.14), collar = Math.min(0.12, H * 0.05);
    const bw = r * 2.7, cw = r * 2.55;
    const y0 = -H / 2;
    let y = y0;
    this._box(S, 0, y + bh / 2, 0, bw, bh, bw, { bevel: 0.03 });
    y += bh;
    this._cylinder(S, 0, y + collar / 2, 0, r * 1.22, r * 1.1, collar, Math.max(sides, 8), { flat: true, collide: false });
    y += collar;
    const shaftH = H - bh - ch - collar * 2;
    this._cylinder(S, 0, y + shaftH / 2, 0, r, r * 0.92, shaftH, sides, { capTop: false, capBottom: false });
    y += shaftH;
    this._cylinder(S, 0, y + collar / 2, 0, r * 1.1, r * 1.22, collar, Math.max(sides, 8), { flat: true, collide: false });
    y += collar;
    this._box(S, 0, y + ch / 2, 0, cw, ch, cw, { bevel: 0.04 });
  }

  _sArch(s, i) {
    const pos = this._pos(s, i);
    const size = this._size3(s, i);
    if (!pos || !size) return;
    const [w, h, d] = size;
    const t = Math.min(isNum(s.thickness) ? s.thickness : 1, w / 2 - 0.4);
    const lin = Math.min(isNum(s.lintel) ? s.lintel : 1, h - 0.5);
    const S = this._ctx(s, pos, this._rot(s));
    this._curCast = S.cast;
    const pierH = h - lin;
    const px = w / 2 - t / 2;
    this._box(S, -px, -h / 2 + pierH / 2, 0, t, pierH, d, { bevel: 0.03 });
    this._box(S, px, -h / 2 + pierH / 2, 0, t, pierH, d, { bevel: 0.03 });
    this._box(S, 0, h / 2 - lin / 2, 0, w, lin, d, { bevel: 0.04 });
    // cornice cap (visual only) and small impost blocks where the lintel meets the piers
    this._box(S, 0, h / 2 + 0.07, 0, w + 0.2, 0.14, d + 0.2, { collide: false, skip: [F_BOTTOM] });
    const ib = 0.18;
    this._box(S, -(w / 2 - t) + 0.04, h / 2 - lin - ib / 2, 0, 0.16, ib, d + 0.1, { collide: false, skip: [F_TOP] });
    this._box(S, (w / 2 - t) - 0.04, h / 2 - lin - ib / 2, 0, 0.16, ib, d + 0.1, { collide: false, skip: [F_TOP] });
  }

  _sCrate(s, i) {
    const pos = this._pos(s, i);
    const size = this._size3(s, i, [1.2, 1.2, 1.2]);
    if (!pos || !size) return;
    const S = this._ctx(s, pos, this._rot(s), { mat: 'crate' });
    this._curCast = S.cast;
    this._box(S, 0, 0, 0, size[0], size[1], size[2], { bevel: s.bevel ?? Math.min(0.045, Math.min(...size) * 0.06) });
  }

  _sContainer(s, i) {
    const pos = this._pos(s, i);
    const size = this._size3(s, i, [2.44, 2.6, 6.06]);
    if (!pos || !size) return;
    let color = s.color ?? 'red';
    if (!CONTAINER_COLORS.includes(color)) {
      this.warn(`solid #${i} (container): unknown color '${color}' (valid: ${CONTAINER_COLORS.join(', ')})`);
      color = 'red';
    }
    const S = this._ctx(s, pos, this._rot(s), { mat: `container_${color}` });
    this._curCast = S.cast;
    const [w, h, d] = size;
    // body
    this._box(S, 0, 0, 0, w, h, d, { top: S.top ?? S.mat, bottom: 'metal_dark' });
    if (!S.visible) return;
    const dark = 'metal_dark';
    const post = 0.15, pr = 0.035; // corner post size and how far it stands proud
    const hw = w / 2, hd = d / 2, hh = h / 2;
    const det = { mat: dark, collide: false };
    const IN_X = sx => (sx > 0 ? 1 : 0);   // face index pointing inward (into the body) for a +/-x side
    const IN_Z = sz => (sz > 0 ? 5 : 4);
    // corner posts + castings (only the faces that can be seen)
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        this._box(S, sx * (hw - post / 2 + pr), 0, sz * (hd - post / 2 + pr), post, h - 0.16, post, { ...det, skip: [IN_X(sx), IN_Z(sz), F_TOP, F_BOTTOM] });
        this._box(S, sx * (hw - 0.1 + pr), hh - 0.08, sz * (hd - 0.1 + pr), 0.22, 0.16, 0.22, { ...det, skip: [IN_X(sx), IN_Z(sz), F_BOTTOM] });
        this._box(S, sx * (hw - 0.1 + pr), -hh + 0.08, sz * (hd - 0.1 + pr), 0.22, 0.16, 0.22, { ...det, skip: [IN_X(sx), IN_Z(sz), F_TOP] });
      }
    }
    // top and bottom rails (long sides and ends)
    for (const sx of [-1, 1]) {
      this._box(S, sx * (hw + pr / 2 - 0.05), hh - 0.08, 0, 0.1 + pr, 0.14, d - 0.3, { ...det, skip: [IN_X(sx), 4, 5] });
      this._box(S, sx * (hw + pr / 2 - 0.05), -hh + 0.09, 0, 0.1 + pr, 0.16, d - 0.3, { ...det, skip: [IN_X(sx), 4, 5] });
    }
    for (const sz of [-1, 1]) {
      this._box(S, 0, hh - 0.08, sz * (hd + pr / 2 - 0.05), w - 0.3, 0.14, 0.1 + pr, { ...det, skip: [IN_Z(sz), 0, 1] });
      this._box(S, 0, -hh + 0.09, sz * (hd + pr / 2 - 0.05), w - 0.3, 0.16, 0.1 + pr, { ...det, skip: [IN_Z(sz), 0, 1] });
    }
    // door end (+Z): seam, locking rods with handles, hinges
    const zf = hd + 0.035;
    this._box(S, 0, 0, zf, 0.035, h - 0.3, 0.03, { ...det, skip: [5, F_TOP, F_BOTTOM] });
    for (const rx of [-0.85, -0.42, 0.42, 0.85]) {
      if (Math.abs(rx) > hw - 0.25) continue;
      this._box(S, rx, 0, zf + 0.02, 0.05, h - 0.35, 0.05, { mat: 'metal_panel', collide: false, skip: [5, F_TOP, F_BOTTOM] });
      this._box(S, rx, -0.05, zf + 0.06, 0.05, 0.16, 0.05, { mat: 'metal_panel', collide: false, skip: [5] });
    }
    for (const hy of [-0.85, 0.85]) {
      for (const sx of [-1, 1]) this._box(S, sx * (hw - 0.3), hy, zf, 0.12, 0.16, 0.04, { ...det, skip: [5] });
    }
  }

  _sRailing(s, i) {
    if (!isVec(s.from) || !isVec(s.to)) { this.warn(`solid #${i} (railing): 'from'/'to' must be [x,y,z]`); return; }
    const a = V(...s.from), b = V(...s.to);
    const len = a.distanceTo(b);
    if (len < 0.05) { this.warn(`solid #${i} (railing): zero length`); return; }
    const height = isNum(s.height) ? s.height : 1.05;
    const S = this._ctx(s, V(0, 0, 0), 0, { mat: 'metal_painted_yellow' });
    this._curCast = S.cast;
    this._railingAt(S, a, b, height, S.collide);
  }

  /** Posts + rails + kick plate along a->b (y = walking surface). Collision = thin wall. */
  _railingAt(S, a, b, height, collide) {
    const len = a.distanceTo(b);
    const dir = b.clone().sub(a).normalize();
    const posts = Math.max(2, Math.ceil(len / 2.0) + 1);
    const mat = S.mat;
    const rail = { mat, collide: false };
    const up = V(0, height, 0);
    for (let k = 0; k < posts; k++) {
      const p = a.clone().lerp(b, k / (posts - 1));
      this._beam(S, p, p.clone().add(up), 0.07, 0.07, { ...rail, skip: [F_BOTTOM] });
    }
    const top0 = a.clone().add(V(0, height - 0.04, 0)), top1 = b.clone().add(V(0, height - 0.04, 0));
    this._beam(S, top0, top1, 0.075, 0.06, { ...rail, skip: [0, 1] });
    this._beam(S, a.clone().add(V(0, height * 0.52, 0)), b.clone().add(V(0, height * 0.52, 0)), 0.045, 0.04, { ...rail, skip: [0, 1] });
    this._beam(S, a.clone().add(V(0, 0.08, 0)), b.clone().add(V(0, 0.08, 0)), 0.03, 0.14, { ...rail, skip: [0, 1] });
    if (collide) {
      // thin collision wall along the rail (also blocks the top rail height)
      const mid = a.clone().add(b).multiplyScalar(0.5).add(V(0, height / 2, 0));
      const M = new THREE.Matrix4().makeRotationY(Math.atan2(-dir.z, dir.x));
      M.setPosition(mid.x, mid.y, mid.z);
      this._box(this._withMatrix(S, M), 0, 0, 0, len, height, 0.12, { visual: false, collide: true });
    }
  }

  _sCatwalk(s, i) {
    if (!isVec(s.from) || !isVec(s.to)) { this.warn(`solid #${i} (catwalk): 'from'/'to' must be [x,y,z]`); return; }
    const a = V(...s.from), b = V(...s.to);
    const len = a.distanceTo(b);
    if (len < 0.2) { this.warn(`solid #${i} (catwalk): too short`); return; }
    const width = isNum(s.width) ? s.width : 2.5;
    const th = isNum(s.thickness) ? s.thickness : 0.2;
    const rails = s.railings ?? 'both';
    const railH = isNum(s.railHeight) ? s.railHeight : 1.05;
    if (Math.abs(a.x - b.x) > 1e-3 && Math.abs(a.z - b.z) > 1e-3) this.warn(`solid #${i} (catwalk): not axis aligned (works, but UVs and rails may look odd)`);
    const S = this._ctx(s, V(0, 0, 0), 0, { mat: 'metal_grate' });
    this._curCast = S.cast;
    const dir = b.clone().sub(a).normalize();
    const side = new THREE.Vector3().crossVectors(dir, UP).normalize();      // right-hand side
    const left = side.clone().negate();
    const dark = 'metal_dark';
    const collide = S.collide;

    // deck: grate on top, dark steel around
    const M = new THREE.Matrix4().makeBasis(dir, new THREE.Vector3().crossVectors(side, dir).normalize(), side);
    M.setPosition((a.x + b.x) / 2, (a.y + b.y) / 2 - th / 2, (a.z + b.z) / 2);
    const SD = this._withMatrix(S, M);
    this._box(SD, 0, 0, 0, len, th, width, { mat: dark, top: S.mat, bottom: dark, collide });

    const det = { mat: dark, collide: false };
    // stringers (I-beam look) under both edges + cross beams
    for (const sg of [-1, 1]) {
      this._box(SD, 0, -th / 2 - 0.14, sg * (width / 2 - 0.09), len - 0.1, 0.28, 0.07, det);
      this._box(SD, 0, -th / 2 - 0.26, sg * (width / 2 - 0.09), len - 0.1, 0.05, 0.2, det);
    }
    const cross = Math.max(1, Math.round(len / 2.6));
    for (let k = 0; k <= cross; k++) {
      const x = -len / 2 + 0.15 + (len - 0.3) * (k / cross);
      this._box(SD, x, -th / 2 - 0.09, 0, 0.1, 0.18, width - 0.2, det);
    }
    // deck trim on the walking surface edges
    for (const sg of [-1, 1]) this._box(SD, 0, th / 2 - 0.01, sg * (width / 2 - 0.03), len, 0.04, 0.06, { mat: 'metal_painted_yellow', collide: false });

    const railMat = s.railMat ?? 'metal_painted_yellow';
    const SR = { ...S, mat: railMat };
    const off = width / 2 - 0.05;
    const edge = (sgn) => {
      const o = (sgn > 0 ? side : left).clone().multiplyScalar(off);
      this._railingAt(SR, a.clone().add(o), b.clone().add(o), railH, collide);
    };
    if (rails === 'both' || rails === 'right') edge(1);
    if (rails === 'both' || rails === 'left') edge(-1);
  }

  _sPanel(s, i) {
    const pos = this._pos(s, i);
    if (!pos) return;
    let z = s.size;
    if (isNum(z)) z = [z, z];
    if (!isVec(z, 2) || z[0] <= 0 || z[1] <= 0) { this.warn(`solid #${i} (panel): size must be [w,h]`); return; }
    const S = this._ctx(s, pos, this._rot(s), { mat: 'light_panel', collide: false, shadow: false });
    if (s.shadow === undefined) S.cast = false;
    this._curCast = S.cast;
    const t = 0.05;
    // front face uses the panel material, everything else is dark trim
    this._box(S, 0, 0, 0, z[0], z[1], t, {
      mat: 'metal_dark', collide: S.collide, skip: [4],
    });
    const hw = z[0] / 2, hh = z[1] / 2;
    this._face(S, [V(-hw, -hh, t / 2), V(hw, -hh, t / 2), V(hw, hh, t / 2), V(-hw, hh, t / 2)], { mat: S.mat, centroid: V(0, 0, 0), collide: S.collide });
  }

  // ------------------------------------------------------------------ phase 2: meshes

  /** Create the merged meshes (materials must be generated by now). Returns the group. */
  createMeshes() {
    const group = new THREE.Group();
    group.name = 'map-solids';
    for (const b of this.buckets.values()) {
      if (b.vc === 0) continue;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3));
      geo.setAttribute('normal', new THREE.Float32BufferAttribute(b.nor, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(b.uv, 2));
      geo.setIndex(b.vc > 65535 ? new THREE.Uint32BufferAttribute(b.idx, 1) : new THREE.Uint16BufferAttribute(b.idx, 1));
      geo.computeBoundingBox();
      geo.computeBoundingSphere();
      const info = this._info(b.mat);
      const mesh = new THREE.Mesh(geo, getMaterial(b.mat));
      mesh.name = `solids:${b.mat}${b.cast ? '' : ':nocast'}`;
      mesh.castShadow = b.cast;
      mesh.receiveShadow = !info.emissive;
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      group.add(mesh);
      this.meshes.push(mesh);
      // free the JS arrays
      b.pos = b.nor = b.uv = b.idx = null;
    }
    this.group = group;
    return group;
  }

  /** Float32Array of collision triangles (9 floats each) for the NavGraph. */
  getNavTriangles() {
    return new Float32Array(this.navTris);
  }

  /** Uint8Array (one per nav triangle): bit0 = never a walkable floor (invisible / nav:false solids). */
  getNavFlags() {
    return new Uint8Array(this.navFlags);
  }

  get stats() {
    return {
      solids: (this.def.solids || []).length,
      drawCalls: this.meshes.length,
      triangles: this.visualTriCount,
      collisionTriangles: this.collisionTriCount,
      materials: this.materialNames.length,
    };
  }
}
