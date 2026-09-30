import * as THREE from 'three';
import { Octree } from 'three/addons/math/Octree.js';
import { Capsule } from 'three/addons/math/Capsule.js';

const _ray = new THREE.Ray();
const _triHit = new THREE.Vector3();

/**
 * Slab test: distance along the ray (ox,oy,oz + t*(dx,dy,dz)) at which it enters `box` (0 if the origin
 * is inside the box), or -1 if the ray misses. (ix,iy,iz) are the precomputed reciprocals of the direction
 * (one division per ray instead of six per node). (THREE.Ray.intersectBox returns the EXIT point when the
 * origin is inside the box, which is useless for nearest-first culling.)
 */
function rayBoxEntryI(ox, oy, oz, dx, dy, dz, ix, iy, iz, box) {
  let tmin = 0, tmax = Infinity, t1, t2, tt;
  if (dx > -1e-12 && dx < 1e-12) {
    if (ox < box.min.x || ox > box.max.x) return -1;
  } else {
    t1 = (box.min.x - ox) * ix; t2 = (box.max.x - ox) * ix;
    if (t1 > t2) { tt = t1; t1 = t2; t2 = tt; }
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return -1;
  }
  if (dy > -1e-12 && dy < 1e-12) {
    if (oy < box.min.y || oy > box.max.y) return -1;
  } else {
    t1 = (box.min.y - oy) * iy; t2 = (box.max.y - oy) * iy;
    if (t1 > t2) { tt = t1; t1 = t2; t2 = tt; }
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return -1;
  }
  if (dz > -1e-12 && dz < 1e-12) {
    if (oz < box.min.z || oz > box.max.z) return -1;
  } else {
    t1 = (box.min.z - oz) * iz; t2 = (box.max.z - oz) * iz;
    if (t1 > t2) { tt = t1; t1 = t2; t2 = tt; }
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return -1;
  }
  return tmin;
}

const _d = new THREE.Vector3();
const _probeOrigin = new THREE.Vector3();
const _down = new THREE.Vector3(0, -1, 0);
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _scratchCap = new Capsule();

// ---- allocation-free double-sided ray / triangle test (point-in-solid queries, clearance rays)
const HIT_MIN = 1e-6;          // hits closer than this are ignored (the ray starts on the surface)
const HIT_TIE = 1e-5;          // two hits this close count as the same distance (coincident faces of stacked solids)
const INSIDE_MAX_DIST = 12;    // point-in-solid rays give up after this distance (no hit = open air = outside)
const CAPSULE_INSIDE_DIST = 3;  // shorter range for the per-frame capsule checks (cheaper: fewer octree nodes per ray)
const INSIDE_RAYS = 8;
const INSIDE_NEED = 2;         // rays whose nearest hit is a back face needed to call a point inside
const INSIDE_QUIT = 4;         // after this many rays with no back face at all ...
const INSIDE_QUIT_MISS = 2;    // ... of which this many hit nothing within range = open air, stop early
/**
 * Fixed, well spread, deliberately skewed unit directions. Never axis aligned: axis rays graze box edges and
 * lie in the plane of coplanar faces, where a hit test is ambiguous. Ordered so that consecutive rays point
 * into opposite hemispheres (cheap early-outs for points that are clearly outside).
 */
const INSIDE_DIRS = (() => {
  const raw = [
    [0.61, 0.32, 0.72], [-0.44, -0.83, -0.35], [-0.79, 0.27, 0.55], [0.71, -0.29, -0.64],
    [-0.33, 0.52, -0.79], [0.09, -0.94, 0.33], [0.86, 0.18, -0.47], [-0.27, 0.91, 0.31],
  ];
  const out = new Float64Array(raw.length * 3);
  raw.forEach((d, i) => {
    const l = Math.hypot(d[0], d[1], d[2]);
    out[i * 3] = d[0] / l; out[i * 3 + 1] = d[1] / l; out[i * 3 + 2] = d[2] / l;
  });
  return out;
})();

/** Determinant of the last successful triHit(): > 0 the ray hit the front face (against the normal), < 0 the back face. */
let _det = 0;

/**
 * Moller-Trumbore, double sided. Returns the hit distance t (> HIT_MIN) or -1 on a miss; the facing of
 * the hit is left in `_det`. `tr` is a THREE.Triangle with CCW winding = outward normal.
 */
function triHit(tr, ox, oy, oz, dx, dy, dz) {
  const a = tr.a, b = tr.b, c = tr.c;
  const e1x = b.x - a.x, e1y = b.y - a.y, e1z = b.z - a.z;
  const e2x = c.x - a.x, e2y = c.y - a.y, e2z = c.z - a.z;
  const hx = dy * e2z - dz * e2y, hy = dz * e2x - dx * e2z, hz = dx * e2y - dy * e2x;
  const det = e1x * hx + e1y * hy + e1z * hz;
  if (det > -1e-12 && det < 1e-12) return -1;
  const f = 1 / det;
  const sx = ox - a.x, sy = oy - a.y, sz = oz - a.z;
  const u = f * (sx * hx + sy * hy + sz * hz);
  if (u < 0 || u > 1) return -1;
  const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x;
  const v = f * (dx * qx + dy * qy + dz * qz);
  if (v < 0 || u + v > 1) return -1;
  const t = f * (e2x * qx + e2y * qy + e2z * qz);
  if (t <= HIT_MIN) return -1;
  _det = det;
  return t;
}

// ---- robust capsule / triangle contact (replaces three's Octree.triangleCapsuleIntersect for movement)
/*
 * three's triangleCapsuleIntersect finds edge contacts with a segment/segment closest-point routine that clamps t1 but
 * then derives t2 from the UNCLAMPED t1. For edges that are nearly (not exactly) parallel to the capsule axis - the long
 * edges of a slightly tapered pole, chimney or pillar against a vertical capsule - the infinite-line solution lies far
 * outside both segments, the pair of points comes out wrong, the distance is over-estimated and the edge reports "no
 * contact": the player walks straight through the pole (measured on foundry: 6 of 240 seeded sprint episodes ended with
 * the capsule axis inside a pole). segSegClosest below re-derives the other parameter after every clamp (Ericson,
 * Real-Time Collision Detection 5.1.9), which is exact in the degenerate cases, and it allocates nothing.
 */
const CT_EPS = 1e-12;
let _segS = 0, _segT = 0;

/** Closest points of segments P1Q1 and P2Q2 (numbers in, parameters out in _segS / _segT). */
function segSegClosest(p1x, p1y, p1z, q1x, q1y, q1z, p2x, p2y, p2z, q2x, q2y, q2z) {
  const d1x = q1x - p1x, d1y = q1y - p1y, d1z = q1z - p1z;
  const d2x = q2x - p2x, d2y = q2y - p2y, d2z = q2z - p2z;
  const rx = p1x - p2x, ry = p1y - p2y, rz = p1z - p2z;
  const a = d1x * d1x + d1y * d1y + d1z * d1z;
  const e = d2x * d2x + d2y * d2y + d2z * d2z;
  const f = d2x * rx + d2y * ry + d2z * rz;
  let s, t;
  if (a <= CT_EPS && e <= CT_EPS) { s = 0; t = 0; }
  else if (a <= CT_EPS) { s = 0; t = f / e; t = t < 0 ? 0 : t > 1 ? 1 : t; }
  else {
    const c = d1x * rx + d1y * ry + d1z * rz;
    if (e <= CT_EPS) { t = 0; s = -c / a; s = s < 0 ? 0 : s > 1 ? 1 : s; }
    else {
      const b = d1x * d2x + d1y * d2y + d1z * d2z;
      const denom = a * e - b * b;
      if (denom > 1e-14 * a * e) { s = (b * f - c * e) / denom; s = s < 0 ? 0 : s > 1 ? 1 : s; } else s = 0;
      t = (b * s + f) / e;
      if (t < 0) { t = 0; s = -c / a; s = s < 0 ? 0 : s > 1 ? 1 : s; }
      else if (t > 1) { t = 1; s = (b - c) / a; s = s < 0 ? 0 : s > 1 ? 1 : s; }
    }
  }
  _segS = s;
  _segT = t;
}

/** Contact of the last successful capsuleTri(): unit normal (pointing out of the geometry) and penetration depth. */
const _ct = { nx: 0, ny: 0, nz: 0, depth: 0 };
const _ctEdge = new Float64Array(9);

/**
 * Capsule (axis start -> end, radius r) against one triangle. Same contract as three's triangleCapsuleIntersect (a
 * capsule whose axis lies entirely behind the face plane is ignored - see the class comment) but with robust edge
 * contacts, no allocations, and the DEEPEST edge contact instead of the first one. Needs the plane cached by addTriangle.
 */
function capsuleTri(sx, sy, sz, ex, ey, ez, r, t) {
  const nx = t.nx, ny = t.ny, nz = t.nz;
  const d1 = nx * sx + ny * sy + nz * sz - t.pd - r;
  const d2 = nx * ex + ny * ey + nz * ez - t.pd - r;
  if ((d1 > 0 && d2 > 0) || (d1 < -r && d2 < -r)) return false;
  const a = t.a, b = t.b, c = t.c;
  // point of the axis nearest the plane, inside the triangle (projected along the normal)? -> face contact
  const sum = Math.abs(d1) + Math.abs(d2);
  const delta = sum > 1e-12 ? Math.abs(d1) / sum : 0.5;
  const px = sx + (ex - sx) * delta, py = sy + (ey - sy) * delta, pz = sz + (ez - sz) * delta;
  const v0x = c.x - a.x, v0y = c.y - a.y, v0z = c.z - a.z;
  const v1x = b.x - a.x, v1y = b.y - a.y, v1z = b.z - a.z;
  const v2x = px - a.x, v2y = py - a.y, v2z = pz - a.z;
  const dot00 = v0x * v0x + v0y * v0y + v0z * v0z;
  const dot01 = v0x * v1x + v0y * v1y + v0z * v1z;
  const dot02 = v0x * v2x + v0y * v2y + v0z * v2z;
  const dot11 = v1x * v1x + v1y * v1y + v1z * v1z;
  const dot12 = v1x * v2x + v1y * v2y + v1z * v2z;
  const den = dot00 * dot11 - dot01 * dot01;
  if (den !== 0) {
    const inv = 1 / den;
    const u = (dot11 * dot02 - dot01 * dot12) * inv;
    const v = (dot00 * dot12 - dot01 * dot02) * inv;
    if (u >= 0 && v >= 0 && u + v <= 1) {
      _ct.nx = nx; _ct.ny = ny; _ct.nz = nz;
      _ct.depth = Math.abs(d1 < d2 ? d1 : d2);
      return true;
    }
  }
  // edge contacts: closest points between the axis segment and each edge; keep the deepest
  const e = _ctEdge;
  e[0] = a.x; e[1] = a.y; e[2] = a.z; e[3] = b.x; e[4] = b.y; e[5] = b.z; e[6] = c.x; e[7] = c.y; e[8] = c.z;
  const r2 = r * r;
  let best = r2, bx = 0, by = 0, bz = 0, hit = false;
  for (let k = 0; k < 3; k++) {
    const i0 = k * 3, i1 = ((k + 1) % 3) * 3;
    segSegClosest(sx, sy, sz, ex, ey, ez, e[i0], e[i0 + 1], e[i0 + 2], e[i1], e[i1 + 1], e[i1 + 2]);
    const q1x = sx + (ex - sx) * _segS, q1y = sy + (ey - sy) * _segS, q1z = sz + (ez - sz) * _segS;
    const q2x = e[i0] + (e[i1] - e[i0]) * _segT, q2y = e[i0 + 1] + (e[i1 + 1] - e[i0 + 1]) * _segT, q2z = e[i0 + 2] + (e[i1 + 2] - e[i0 + 2]) * _segT;
    const dx = q1x - q2x, dy = q1y - q2y, dz = q1z - q2z;
    const dd = dx * dx + dy * dy + dz * dz;
    if (dd < best) { best = dd; bx = dx; by = dy; bz = dz; hit = true; }
  }
  if (!hit) return false;
  const dist = Math.sqrt(best);
  if (dist > 1e-9) {
    _ct.nx = bx / dist; _ct.ny = by / dist; _ct.nz = bz / dist;
  } else {
    // the axis passes exactly through the edge: no direction to speak of, use the face normal
    _ct.nx = nx; _ct.ny = ny; _ct.nz = nz;
  }
  _ct.depth = r - dist;
  return true;
}

/**
 * Static collision world: an Octree of triangles, each tagged with a surface type
 * ('metal' | 'concrete' | 'wood' | 'dirt' | 'sand' | 'stone' | 'glass' | 'grass' | 'energy').
 *
 * All queries are world-space. Normals of solid geometry must face outward (standard CCW winding);
 * raycasts ignore back faces, so rays starting inside a solid pass out of it - which also means a
 * capsule that is completely INSIDE a closed solid gets no push-out (both sphere centres are behind every
 * face plane) and nothing in raycast() / resolveCapsule() can tell. Use isInside() / capsuleInside() for that.
 */
export class CollisionWorld {
  constructor() {
    this.octree = new Octree();
    this.triangleCount = 0;
    this.built = false;
    this._tris = [];
    this._stack = [];
    this._hitBack = false;
    this._contacts = { count: 0, normals: [], depths: [] };
    for (let i = 0; i < 32; i++) this._contacts.normals.push(new THREE.Vector3());
    this._move = {
      onGround: false, groundNormal: new THREE.Vector3(0, 1, 0),
      hitWall: false, wallNormal: new THREE.Vector3(),
      hitCeiling: false,
    };
    this._probe = { distance: 0, point: new THREE.Vector3(), normal: new THREE.Vector3() };
  }

  clear() {
    this.octree = new Octree();
    this.triangleCount = 0;
    this.built = false;
  }

  /** Add one triangle (copied). */
  addTriangle(a, b, c, surface = 'concrete') {
    const t = new THREE.Triangle(a.clone(), b.clone(), c.clone());
    // skip degenerate triangles (they produce NaN normals)
    if (t.getArea() < 1e-7) return;
    t.surface = surface;
    // cached plane for capsuleTri()
    const e1x = b.x - a.x, e1y = b.y - a.y, e1z = b.z - a.z, e2x = c.x - a.x, e2y = c.y - a.y, e2z = c.z - a.z;
    let nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
    const nl = Math.hypot(nx, ny, nz) || 1;
    nx /= nl; ny /= nl; nz /= nl;
    t.nx = nx; t.ny = ny; t.nz = nz;
    t.pd = nx * a.x + ny * a.y + nz * a.z;
    this.octree.addTriangle(t);
    this.triangleCount++;
  }

  /**
   * Add all triangles of a BufferGeometry (indexed or not), transformed by `matrix` (optional).
   */
  addGeometry(geometry, matrix = null, surface = 'concrete') {
    const pos = geometry.getAttribute('position');
    const index = geometry.getIndex();
    const count = index ? index.count : pos.count;
    for (let i = 0; i < count; i += 3) {
      const ia = index ? index.getX(i) : i;
      const ib = index ? index.getX(i + 1) : i + 1;
      const ic = index ? index.getX(i + 2) : i + 2;
      _a.fromBufferAttribute(pos, ia);
      _b.fromBufferAttribute(pos, ib);
      _c.fromBufferAttribute(pos, ic);
      if (matrix) { _a.applyMatrix4(matrix); _b.applyMatrix4(matrix); _c.applyMatrix4(matrix); }
      this.addTriangle(_a, _b, _c, surface);
    }
  }

  /** Build the octree. Call once after all triangles are added. */
  build() {
    if (this.triangleCount === 0) {
      console.warn('[collision] building an empty collision world');
      return this;
    }
    // Octree.calcBox() only pads the MIN corner of the bounds by 0.01. Triangles lying exactly on the
    // +x / +y / +z faces of the bounds (the top and outer faces of the boundary volumes) then fall
    // outside every child box (sub-box maxima are accumulated floats) and were silently dropped from
    // the tree. Pad the MAX corner too.
    this.octree.bounds.max.addScalar(0.02);
    this.octree.build();
    this.built = true;
    const kept = this._countTreeTriangles();
    if (kept !== this.triangleCount) {
      console.warn(`[collision] octree kept ${kept} of ${this.triangleCount} triangles`);
    }
    return this;
  }

  /** Number of distinct triangles reachable through the octree (build-time sanity check). */
  _countTreeTriangles() {
    const seen = new Set();
    const stack = [this.octree];
    while (stack.length) {
      const n = stack.pop();
      for (let i = 0; i < n.triangles.length; i++) seen.add(n.triangles[i]);
      for (let i = 0; i < n.subTrees.length; i++) stack.push(n.subTrees[i]);
    }
    return seen.size;
  }

  get bounds() {
    return this.octree.box;
  }

  // ---------------------------------------------------------------- raycast

  /**
   * Nearest front-face hit along a ray within maxDist.
   * @returns {{distance:number, point:THREE.Vector3, normal:THREE.Vector3, surface:string,
   *            triangle:THREE.Triangle}|null} NEW object (safe to keep)
   */
  raycast(origin, dir, maxDist = 1000) {
    if (!this.built) return null;
    _ray.set(origin, dir);
    let best = maxDist;
    let bestTri = null;
    const ox = origin.x, oy = origin.y, oz = origin.z, dx = dir.x, dy = dir.y, dz = dir.z;
    const ix = 1 / dx, iy = 1 / dy, iz = 1 / dz;
    const stack = this._stack;
    let sp = 0;
    stack[sp++] = this.octree;
    while (sp > 0) {
      const node = stack[--sp];
      if (node.box) {
        const enter = rayBoxEntryI(ox, oy, oz, dx, dy, dz, ix, iy, iz, node.box);
        if (enter < 0 || enter > best) continue;
      }
      const tris = node.triangles;
      for (let i = 0; i < tris.length; i++) {
        const t = tris[i];
        const p = _ray.intersectTriangle(t.a, t.b, t.c, true, _triHit);
        if (p) {
          const d = p.distanceTo(origin);
          if (d < best) { best = d; bestTri = t; }
        }
      }
      const subs = node.subTrees;
      for (let i = 0; i < subs.length; i++) stack[sp++] = subs[i];
    }
    if (!bestTri) return null;
    const normal = new THREE.Vector3();
    bestTri.getNormal(normal);
    return {
      distance: best,
      point: origin.clone().addScaledVector(dir, best),
      normal,
      surface: bestTri.surface || 'concrete',
      triangle: bestTri,
    };
  }

  /**
   * True when a FRONT face is hit within `maxDist` along the (unit) direction - the boolean, allocation-free
   * cousin of raycast() for clearance checks ("is the straight path from A to B free?").
   * The origin is given as numbers so callers need no vectors.
   */
  rayBlocked(ox, oy, oz, dx, dy, dz, maxDist) {
    if (!this.built || !(maxDist > 0)) return false;
    const ix = 1 / dx, iy = 1 / dy, iz = 1 / dz;
    const stack = this._stack;
    let sp = 0;
    stack[sp++] = this.octree;
    while (sp > 0) {
      const node = stack[--sp];
      if (node.box) {
        const enter = rayBoxEntryI(ox, oy, oz, dx, dy, dz, ix, iy, iz, node.box);
        if (enter < 0 || enter > maxDist) continue;
      }
      const tris = node.triangles;
      for (let i = 0; i < tris.length; i++) {
        const t = triHit(tris[i], ox, oy, oz, dx, dy, dz);
        if (t >= 0 && t <= maxDist && _det > 0) return true;
      }
      const subs = node.subTrees;
      for (let i = 0; i < subs.length; i++) stack[sp++] = subs[i];
    }
    return false;
  }

  // ---------------------------------------------------------------- inside-a-solid queries

  /**
   * Nearest hit (front OR back face, allocation free). Returns its distance or -1 when nothing is hit
   * within maxDist; `this._hitBack` tells whether it was a back face. Two hits at (nearly) the same
   * distance - the coincident faces of two stacked solids - resolve to "back face": the ray is leaving one
   * solid exactly as it enters the next, i.e. it is still inside the union.
   */
  _nearestFacing(ox, oy, oz, dx, dy, dz, maxDist) {
    const ix = 1 / dx, iy = 1 / dy, iz = 1 / dz;
    const stack = this._stack;
    let sp = 0;
    stack[sp++] = this.octree;
    let best = maxDist, back = false, found = false;
    while (sp > 0) {
      const node = stack[--sp];
      if (node.box) {
        const enter = rayBoxEntryI(ox, oy, oz, dx, dy, dz, ix, iy, iz, node.box);
        if (enter < 0 || enter > best + HIT_TIE) continue;
      }
      const tris = node.triangles;
      for (let i = 0; i < tris.length; i++) {
        const t = triHit(tris[i], ox, oy, oz, dx, dy, dz);
        if (t < 0 || t > best + HIT_TIE) continue;
        if (!found || t < best - HIT_TIE) {
          best = t;
          back = _det < 0;
          found = true;
        } else if (_det < 0) {
          back = true;                 // tie with a coincident face: prefer "leaving a solid"
          if (t < best) best = t;
        }
      }
      const subs = node.subTrees;
      for (let i = 0; i < subs.length; i++) stack[sp++] = subs[i];
    }
    this._hitBack = back;
    return found ? best : -1;
  }

  /**
   * Is the point inside a closed solid? Casts up to 8 skewed rays and looks at the FACING of the nearest
   * triangle each one hits (double sided): a back face first means the ray started inside a solid - for
   * closed geometry with outward normals that is impossible from open air, so it is evidence that cannot be
   * produced by a point in the open. A ray that hits nothing within 12 m, or meets the front face of another
   * solid first (overlapping pieces), proves nothing either way, so the point is inside when at least 2 rays
   * leave a solid first; 2 (not 1) so that a stray ray through a hairline crack cannot decide alone. A point
   * near a face of a big solid always has several rays heading for that face. Open air is recognised after 4
   * clean rays (they point into both hemispheres, so any face within reach would have shown up).
   * Rays are limited to 12 m: a point buried deeper than that inside a huge solid reads "outside" (irrelevant
   * for anything a player can reach - they cross a surface to get in). Coincident faces of stacked solids
   * (the hidden seam) resolve to "leaving a solid", i.e. still inside.
   * Points exactly ON a surface are ambiguous; query at least 1 cm away (capsule sphere centres are 0.4 m).
   * Allocation free; a few microseconds for a point in the open.
   * @param {{x:number,y:number,z:number}} p
   */
  isInside(p) {
    return this.isInsideXYZ(p.x, p.y, p.z);
  }

  /** Same as isInside() with plain numbers. */
  isInsideXYZ(x, y, z, maxDist = INSIDE_MAX_DIST) {
    if (!this.built) return false;
    const box = this.octree.box;
    if (x < box.min.x || x > box.max.x || y < box.min.y || y > box.max.y || z < box.min.z || z > box.max.z) return false;
    let back = 0, miss = 0;
    for (let i = 0; i < INSIDE_RAYS; i++) {
      const k = i * 3;
      const t = this._nearestFacing(x, y, z, INSIDE_DIRS[k], INSIDE_DIRS[k + 1], INSIDE_DIRS[k + 2], maxDist);
      if (t >= 0 && this._hitBack) {
        if (++back >= INSIDE_NEED) return true;
      } else {
        if (t < 0) miss++;
        // open air: the first rays left the neighbourhood without touching anything (or only met front faces) and
        // none of them saw a back face. Front-face hits alone must not end the test: a point buried in a big slab
        // next to overlapping detail pieces sees only their front faces on its first rays.
        if (i + 1 >= INSIDE_QUIT && back === 0 && miss >= INSIDE_QUIT_MISS) return false;
      }
    }
    return false;
  }

  /**
   * True when either sphere centre of the capsule (three/addons Capsule) is inside a solid. resolveCapsule()
   * cannot push such a capsule out (a centre behind a face plane is ignored), so this is how "the player is in
   * the wall" is detected. Allocation free. Rays only look 3 m ahead (a capsule that just crossed into a solid is
   * always within a metre of the face it came through), which halves the cost of the per-frame checks.
   */
  capsuleInside(capsule, maxDist = CAPSULE_INSIDE_DIST) {
    return this.isInsideXYZ(capsule.start.x, capsule.start.y, capsule.start.z, maxDist)
      || this.isInsideXYZ(capsule.end.x, capsule.end.y, capsule.end.z, maxDist);
  }

  // ---------------------------------------------------------------- capsule / sphere

  /**
   * Push a capsule (three/addons Capsule) out of the geometry. MUTATES the capsule.
   * Returns a reused contact list {count, normals[], depths[]} (valid until the next call).
   */
  resolveCapsule(capsule) {
    const res = this._contacts;
    res.count = 0;
    if (!this.built) return res;
    const tris = this._tris;
    tris.length = 0;
    this.octree.getCapsuleTriangles(capsule, tris);
    const cs = capsule.start, ce = capsule.end, r = capsule.radius;
    for (let pass = 0; pass < 2; pass++) {
      let any = false;
      for (let i = 0; i < tris.length; i++) {
        if (!capsuleTri(cs.x, cs.y, cs.z, ce.x, ce.y, ce.z, r, tris[i]) || !(_ct.depth > 1e-7)) continue;
        if (!Number.isFinite(_ct.nx)) continue;
        const k = _ct.depth;
        cs.x += _ct.nx * k; cs.y += _ct.ny * k; cs.z += _ct.nz * k;
        ce.x += _ct.nx * k; ce.y += _ct.ny * k; ce.z += _ct.nz * k;
        if (res.count < res.normals.length) {
          res.normals[res.count].set(_ct.nx, _ct.ny, _ct.nz);
          res.depths[res.count] = k;
          res.count++;
        }
        any = true;
      }
      if (!any) break;
    }
    return res;
  }

  /** Raw combined push-out for a capsule (does not mutate): {normal, depth} | false. */
  capsuleIntersect(capsule) {
    if (!this.built) return false;
    const cap = _scratchCap;
    cap.start.copy(capsule.start);
    cap.end.copy(capsule.end);
    cap.radius = capsule.radius;
    const tris = this._tris;
    tris.length = 0;
    this.octree.getCapsuleTriangles(cap, tris);
    let hit = false;
    const cs = cap.start, ce = cap.end, r = cap.radius;
    const ox = (cs.x + ce.x) * 0.5, oy = (cs.y + ce.y) * 0.5, oz = (cs.z + ce.z) * 0.5;
    for (let i = 0; i < tris.length; i++) {
      if (!capsuleTri(cs.x, cs.y, cs.z, ce.x, ce.y, ce.z, r, tris[i])) continue;
      hit = true;
      const k = _ct.depth;
      cs.x += _ct.nx * k; cs.y += _ct.ny * k; cs.z += _ct.nz * k;
      ce.x += _ct.nx * k; ce.y += _ct.ny * k; ce.z += _ct.nz * k;
    }
    if (!hit) return false;
    const v = new THREE.Vector3((cs.x + ce.x) * 0.5 - ox, (cs.y + ce.y) * 0.5 - oy, (cs.z + ce.z) * 0.5 - oz);
    const depth = v.length();
    return { normal: v.normalize(), depth };
  }

  /** Combined push-out for a sphere (does not mutate): {normal, depth} | false. */
  sphereIntersect(sphere) {
    if (!this.built) return false;
    return this.octree.sphereIntersect(sphere);
  }

  /**
   * Kinematic "move and slide" for a capsule. Moves by velocity*dt in sub-steps (no tunnelling),
   * resolves penetration, and removes the velocity component going into each contact.
   * MUTATES capsule and velocity. Returns a reused result object:
   *   { onGround, groundNormal, hitWall, wallNormal, hitCeiling }
   * @param {object} opts  { groundMinY: 0.65 } minimum normal.y that counts as walkable ground
   */
  moveCapsule(capsule, velocity, dt, opts = {}) {
    const groundMinY = opts.groundMinY ?? 0.65;
    const out = this._move;
    out.onGround = false;
    out.groundNormal.set(0, 1, 0);
    out.hitWall = false;
    out.wallNormal.set(0, 0, 0);
    out.hitCeiling = false;
    let bestGroundY = -1;

    const dist = velocity.length() * dt;
    const steps = Math.min(24, Math.max(1, Math.ceil(dist / (capsule.radius * 0.45))));
    const sdt = dt / steps;
    for (let s = 0; s < steps; s++) {
      _d.copy(velocity).multiplyScalar(sdt);
      capsule.start.add(_d);
      capsule.end.add(_d);
      const c = this.resolveCapsule(capsule);
      for (let k = 0; k < c.count; k++) {
        const n = c.normals[k];
        const vn = velocity.dot(n);
        if (n.y >= groundMinY) {
          out.onGround = true;
          if (n.y > bestGroundY) { bestGroundY = n.y; out.groundNormal.copy(n); }
        } else if (n.y <= -0.55) {
          out.hitCeiling = true;
        } else {
          out.hitWall = true;
          out.wallNormal.copy(n);
        }
        if (vn < 0) velocity.addScaledVector(n, -vn);
      }
    }
    return out;
  }

  /**
   * Probe for walkable ground below a capsule's bottom sphere (5 rays: center + 4 around).
   * Returns the NEAREST walkable hit within maxDrop below the capsule bottom, or null.
   * distance = gap between the capsule bottom and the ground (can be slightly negative).
   * Reused result object.
   */
  probeGround(capsule, maxDrop = 0.5, groundMinY = 0.65) {
    const r = capsule.radius;
    const bottom = capsule.start; // start is the lower sphere center by convention
    let best = null;
    const offs = [[0, 0], [0.6, 0], [-0.6, 0], [0, 0.6], [0, -0.6]];
    for (const [ox, oz] of offs) {
      _probeOrigin.set(bottom.x + ox * r, bottom.y, bottom.z + oz * r);
      const hit = this.raycast(_probeOrigin, _down, r + maxDrop + 0.05);
      if (!hit || hit.normal.y < groundMinY) continue;
      // gap between the sphere surface and the ground (approximate for offset rays)
      const off = Math.hypot(ox * r, oz * r);
      const sphereBottom = bottom.y - Math.sqrt(Math.max(0, r * r - off * off));
      const gap = sphereBottom - hit.point.y;
      if (gap > maxDrop) continue;
      if (!best || gap < best.distance) {
        best = this._probe;
        best.distance = gap;
        best.point.copy(hit.point);
        best.normal.copy(hit.normal);
      }
    }
    return best;
  }
}
