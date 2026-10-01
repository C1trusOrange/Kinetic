import * as THREE from 'three';

/**
 * NavGraph: multi-level walkable graph for the AI bots.
 *
 * Built from the map's collision triangles on a 1 m grid:
 *  - every column is sampled with a vertical line; hits are sorted and depth-counted (down-facing =
 *    entering a solid, up-facing = leaving it) so only surfaces that are real, un-buried floors with
 *    >= 1.85 m headroom become nodes - this handles overlapping solids, catwalks over floors, etc.
 *  - 8-neighbour links: `walk` (flat / slope / curbs), `jump` (up to 1.15 m), `drop` (walking off a
 *    ledge 0.65..6 m down, or from jump-pad to landing). Walls, railings and gaps block links.
 *  - components (weak + strong), A* with string pulling that never cuts across drops or jumps.
 *
 * API (see ARCHITECTURE.md 6.2): nodes, nearestNode, findPath, randomNode, randomPointNear,
 * isConnected, debugObject, stats.  Extra: findPath waypoints carry `.type` ('walk'|'drop'|'jump') of the
 * link that ARRIVES at them, and `.pad = true` for jump-pad launches.
 *
 * Time-sliced requests (bots): createPathJob(from, to) + stepPath(job, deadline) compute exactly what findPath
 * computes, but the A* expansion loop and the string pulling check the clock, so a request never costs a frame more
 * than the caller's budget plus one bounded unit of work (see BotManager.servicePaths).
 */

const CELL = 1.0;
const JX = 0.0131;          // sample jitter: keeps sample points off triangle edges shared by quads
const JZ = 0.00731;
const HEADROOM = 1.85;      // clear height needed above a floor
const CLEAR_R = 0.3;        // wall clearance radius for a node
const WALK_ANY = 0.35;      // step height always walkable
const JUMP_MAX = 1.15;      // max jump-up between adjacent cells
const DROP_MAX = 20.0;      // the game has no fall damage, so long drops are fine (bots use them to get back down)
const MAX_HITS = 96;
const LOOK_MAX = 16;        // string pulling probes at most this many nodes ahead of a corner (bounds the old O(L^2) scan)
const CHECK_EVERY = 16;     // A* expansions between two deadline checks
const CONNECT_R2 = 36;      // job.connect: both ends must have a node within 6 m (isConnected's snap radius, squared)
const REACH_CACHE_MAX = 4096;

// path job phases
const J_START = 0, J_SEARCH = 1, J_SMOOTH = 2, J_FIRST = 3, J_DONE = 4;
const CLEAR_HEIGHTS = [0.4, 1.0, 1.6];

/** nearestNode()'s metric: squared distance with the vertical part counted double. */
function dist2(pos, p) {
  const dx = p.x - pos.x, dz = p.z - pos.z, dy = (p.y - pos.y) * 2;
  return dx * dx + dz * dz + dy * dy;
}

const DIRS = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];

const cache = new Map();

/** Triangle grid (XZ cells) with per-triangle plane data. */
class TriGrid {
  constructor(tris, minX, minZ, nx, nz, flags = null) {
    this.tris = tris;
    this.flags = flags;
    this.minX = minX;
    this.minZ = minZ;
    this.nx = nx;
    this.nz = nz;
    const n = (this.count = tris.length / 9);
    this.nrm = new Float32Array(n * 3);
    this.invDet = new Float32Array(n);
    for (let t = 0; t < n; t++) {
      const o = t * 9;
      const ux = tris[o + 3] - tris[o], uy = tris[o + 4] - tris[o + 1], uz = tris[o + 5] - tris[o + 2];
      const vx = tris[o + 6] - tris[o], vy = tris[o + 7] - tris[o + 1], vz = tris[o + 8] - tris[o + 2];
      let cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
      const l = Math.hypot(cx, cy, cz) || 1;
      this.nrm[t * 3] = cx / l; this.nrm[t * 3 + 1] = cy / l; this.nrm[t * 3 + 2] = cz / l;
      const x0 = tris[o], z0 = tris[o + 2], x1 = tris[o + 3], z1 = tris[o + 5], x2 = tris[o + 6], z2 = tris[o + 8];
      const det = (z1 - z2) * (x0 - x2) + (x2 - x1) * (z0 - z2);
      this.invDet[t] = Math.abs(det) < 1e-9 ? 0 : 1 / det;
    }
    this.floor = this._csr(t => Math.abs(this.nrm[t * 3 + 1]) > 0.02);
    this.wall = this._csr(t => Math.abs(this.nrm[t * 3 + 1]) < 0.7);
    this.triMark = new Int32Array(n);
    this.cellMark = new Int32Array(nx * nz);
    this.stamp = 0;
    this.hy = new Float32Array(MAX_HITS);
    this.hf = new Uint8Array(MAX_HITS);       // bit0 up-facing, bit1 walkable
  }

  _overlap(t, ci, cj) {
    const o = t * 9, tr = this.tris;
    const cx = this.minX + ci + 0.5, cz = this.minZ + cj + 0.5;
    const h = 0.52;
    const x0 = tr[o], x1 = tr[o + 3], x2 = tr[o + 6];
    const z0 = tr[o + 2], z1 = tr[o + 5], z2 = tr[o + 8];
    // separating-axis test on the three edge normals (box axes are covered by the bbox cell range)
    for (let e = 0; e < 3; e++) {
      let ax, az;
      if (e === 0) { ax = -(z1 - z0); az = x1 - x0; }
      else if (e === 1) { ax = -(z2 - z1); az = x2 - x1; }
      else { ax = -(z0 - z2); az = x0 - x2; }
      if (ax === 0 && az === 0) continue;
      const p0 = ax * x0 + az * z0, p1 = ax * x1 + az * z1, p2 = ax * x2 + az * z2;
      const mn = Math.min(p0, p1, p2), mx = Math.max(p0, p1, p2);
      const c = ax * cx + az * cz, r = h * (Math.abs(ax) + Math.abs(az));
      if (mn > c + r || mx < c - r) return false;
    }
    return true;
  }

  _csr(pred) {
    const { nx, nz, count } = this;
    const start = new Int32Array(nx * nz + 1);
    const ranges = [];
    const tr = this.tris;
    for (let pass = 0; pass < 2; pass++) {
      let items = null, fill = null;
      if (pass === 1) {
        for (let i = 0; i < nx * nz; i++) start[i + 1] += start[i];
        items = new Int32Array(start[nx * nz]);
        fill = start.slice(0, nx * nz);
      }
      for (let t = 0; t < count; t++) {
        if (!pred(t)) continue;
        const o = t * 9;
        let r = ranges[t];
        if (!r) {
          const x0 = Math.min(tr[o], tr[o + 3], tr[o + 6]), x1 = Math.max(tr[o], tr[o + 3], tr[o + 6]);
          const z0 = Math.min(tr[o + 2], tr[o + 5], tr[o + 8]), z1 = Math.max(tr[o + 2], tr[o + 5], tr[o + 8]);
          r = ranges[t] = [
            Math.max(0, Math.floor(x0 - this.minX - 0.02)), Math.min(nx - 1, Math.floor(x1 - this.minX + 0.02)),
            Math.max(0, Math.floor(z0 - this.minZ - 0.02)), Math.min(nz - 1, Math.floor(z1 - this.minZ + 0.02)),
          ];
        }
        for (let j = r[2]; j <= r[3]; j++) {
          for (let i = r[0]; i <= r[1]; i++) {
            if (!this._overlap(t, i, j)) continue;
            const ci = j * nx + i;
            if (pass === 0) start[ci + 1]++;
            else items[fill[ci]++] = t;
          }
        }
      }
      if (pass === 1) return { start, items };
    }
    return null;
  }

  cellIndex(x, z) {
    const i = Math.floor(x - this.minX), j = Math.floor(z - this.minZ);
    if (i < 0 || j < 0 || i >= this.nx || j >= this.nz) return -1;
    return j * this.nx + i;
  }

  /** Sorted vertical-line hits at (x, z) -> count (hy[], hf[]). Ties: down-facing first. */
  columnHits(x, z) {
    const ci = this.cellIndex(x, z);
    if (ci < 0) return 0;
    const { start, items } = this.floor;
    const tr = this.tris, hy = this.hy, hf = this.hf, nrm = this.nrm;
    let n = 0;
    for (let k = start[ci], e = start[ci + 1]; k < e; k++) {
      const t = items[k];
      const id = this.invDet[t];
      if (id === 0) continue;
      const o = t * 9;
      const x0 = tr[o], z0 = tr[o + 2], x1 = tr[o + 3], z1 = tr[o + 5], x2 = tr[o + 6], z2 = tr[o + 8];
      const l1 = ((z1 - z2) * (x - x2) + (x2 - x1) * (z - z2)) * id;
      const l2 = ((z2 - z0) * (x - x2) + (x0 - x2) * (z - z2)) * id;
      const l3 = 1 - l1 - l2;
      if (l1 < -1e-6 || l2 < -1e-6 || l3 < -1e-6) continue;
      const y = l1 * tr[o + 1] + l2 * tr[o + 4] + l3 * tr[o + 7];
      const ny = nrm[t * 3 + 1];
      const flag = (ny > 0 ? 1 : 0) | (ny >= 0.7 ? 2 : 0) | (this.flags && this.flags[t] ? 4 : 0);
      if (n >= MAX_HITS) break;
      // insertion sort
      let p = n++;
      while (p > 0 && (hy[p - 1] > y + 1e-4 || (Math.abs(hy[p - 1] - y) <= 1e-4 && (hf[p - 1] & 1) && !(flag & 1)))) {
        hy[p] = hy[p - 1];
        hf[p] = hf[p - 1];
        p--;
      }
      hy[p] = y;
      hf[p] = flag;
    }
    return n;
  }

  /**
   * Real floors at (x,z): walkable, not buried in another solid, with headroom.
   * Fills outY[] / outHead[] (headroom, Infinity if open sky) and returns the count.
   */
  floorsAt(x, z, outY, outHead, minHead = 0) {
    const n = this.columnHits(x, z);
    const hy = this.hy, hf = this.hf;
    let depth = 0, c = 0;
    for (let i = 0; i < n; i++) {
      if (hf[i] & 1) {
        depth = Math.max(0, depth - 1);
        if ((hf[i] & 2) && !(hf[i] & 4) && depth === 0) {
          const head = i + 1 < n ? hy[i + 1] - hy[i] : Infinity;
          if (head >= minHead) { outY[c] = hy[i]; outHead[c] = head; c++; }
        }
      } else {
        depth++;
      }
    }
    return c;
  }

  /** Nearest real floor height to yRef within tol at (x,z), or NaN. */
  floorNear(x, z, yRef, tol) {
    const oy = this._fy || (this._fy = new Float32Array(MAX_HITS));
    const oh = this._fh || (this._fh = new Float32Array(MAX_HITS));
    const c = this.floorsAt(x, z, oy, oh, 0);
    let best = NaN, bd = tol;
    for (let i = 0; i < c; i++) {
      const d = Math.abs(oy[i] - yRef);
      if (d <= bd) { bd = d; best = oy[i]; }
    }
    return best;
  }

  /** True if a wall-class triangle intersects the segment. */
  segBlocked(x0, y0, z0, x1, y1, z1) {
    const dx = x1 - x0, dy = y1 - y0, dz = z1 - z0;
    const len = Math.hypot(dx, dz);
    const steps = Math.max(1, Math.ceil(len / 0.4));
    const stamp = ++this.stamp;
    const { start, items } = this.wall;
    const tr = this.tris;
    for (let s = 0; s <= steps; s++) {
      const f = s / steps;
      const ci = this.cellIndex(x0 + dx * f, z0 + dz * f);
      if (ci < 0 || this.cellMark[ci] === stamp) continue;
      this.cellMark[ci] = stamp;
      for (let k = start[ci], e = start[ci + 1]; k < e; k++) {
        const t = items[k];
        if (this.triMark[t] === stamp) continue;
        this.triMark[t] = stamp;
        const o = t * 9;
        // Moller-Trumbore, two-sided, segment param in [0,1]
        const e1x = tr[o + 3] - tr[o], e1y = tr[o + 4] - tr[o + 1], e1z = tr[o + 5] - tr[o + 2];
        const e2x = tr[o + 6] - tr[o], e2y = tr[o + 7] - tr[o + 1], e2z = tr[o + 8] - tr[o + 2];
        const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x;
        const det = e1x * px + e1y * py + e1z * pz;
        if (det > -1e-9 && det < 1e-9) continue;
        const inv = 1 / det;
        const tx = x0 - tr[o], ty = y0 - tr[o + 1], tz = z0 - tr[o + 2];
        const u = (tx * px + ty * py + tz * pz) * inv;
        if (u < 0 || u > 1) continue;
        const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x;
        const v = (dx * qx + dy * qy + dz * qz) * inv;
        if (v < 0 || u + v > 1) continue;
        const tt = (e2x * qx + e2y * qy + e2z * qz) * inv;
        if (tt >= 0 && tt <= 1) return true;
      }
    }
    return false;
  }
}

class MinHeap {
  constructor() { this.ids = []; this.keys = []; }
  clear() { this.ids.length = 0; this.keys.length = 0; }
  get size() { return this.ids.length; }
  push(id, key) {
    const ids = this.ids, keys = this.keys;
    let i = ids.length;
    ids.push(id); keys.push(key);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (keys[p] <= key) break;
      ids[i] = ids[p]; keys[i] = keys[p];
      i = p;
    }
    ids[i] = id; keys[i] = key;
  }
  pop() {
    const ids = this.ids, keys = this.keys;
    const top = ids[0];
    const lastId = ids.pop(), lastKey = keys.pop();
    const n = ids.length;
    if (n > 0) {
      let i = 0;
      for (;;) {
        let c = i * 2 + 1;
        if (c >= n) break;
        if (c + 1 < n && keys[c + 1] < keys[c]) c++;
        if (keys[c] >= lastKey) break;
        ids[i] = ids[c]; keys[i] = keys[c];
        i = c;
      }
      ids[i] = lastId; keys[i] = lastKey;
    }
    return top;
  }
}

/** Per-node A* scratch (costs, parents, stamps) + open heap. One search owns it at a time (`owner`). */
class SearchSpace {
  constructor(n) {
    this.G = new Float32Array(n);
    this.P = new Int32Array(n);
    this.seen = new Int32Array(n);
    this.closed = new Int32Array(n);
    this.stamp = 0;
    this.heap = new MinHeap();
    this.owner = null;
  }
}

/**
 * A time-sliced path request (NavGraph#createPathJob / #stepPath). Reusable: createPathJob re-initialises it.
 * `done` / `result` are the public outputs; everything else is resumable search state.
 */
export class PathJob {
  constructor() {
    this.from = new THREE.Vector3();
    this.to = new THREE.Vector3();
    /** Also require what isConnected(from, to) requires (a node within 6 m of both ends, directed reachability). */
    this.connect = false;
    this.done = true;
    /** Waypoints (see NavGraph#findPath) or null when unreachable; valid once `done`. */
    this.result = null;
    /** Nodes expanded by the search (diagnostics). */
    this.expanded = 0;
    this._phase = J_DONE;
    this._s = null;
    this._g = null;
    this._stamp = 0;
    this._startBlocked = false;
    this._chain = [];
    this._types = [];
    this._out = null;
    this._i = 0;
    this._cur = -1;
    this._runEnd = 0;
    this._lo = -1;
    this._hi = 0;
    this._d = 2;
    this._mode = 0;
  }
}

export class NavGraph {
  constructor() {
    /** @type {{id:number, position:THREE.Vector3, links:{to:number,cost:number,type:string}[]}[]} */
    this.nodes = [];
    this.stats = { nodes: 0, links: 0, components: 0, largestComponent: 0, buildMs: 0 };
    this.grid = null;
    this.minX = 0; this.minZ = 0; this.nx = 0; this.nz = 0;
    this.colStart = new Int32Array(1);
    this._main = [];
    // flat copies of the node positions and links (A* inner loop: no object lookups, inlined heuristic)
    this._px = new Float64Array(0);
    this._py = new Float64Array(0);
    this._pz = new Float64Array(0);
    this._linkStart = new Int32Array(1);
    this._linkTo = new Int32Array(0);
    this._linkCost = new Float64Array(0);
    this._jobSpace = null;       // time-sliced jobs (one after another)
    this._syncSpace = null;      // synchronous findPath (never disturbs a suspended job)
    this._syncJob = null;
    this._reachSeen = new Int32Array(0);
    this._reachStamp = 0;
    this._reachCache = new Map();
    this._sccCount = 0;
    this._debug = null;
  }

  /** An empty graph (safe defaults before a map is loaded). */
  static empty() {
    return new NavGraph();
  }

  /**
   * Build a graph.
   * @param {Float32Array} tris collision triangles (9 floats each, CCW outward)
   * @param {THREE.Box3} bounds map bounds (clips the grid)
   * @param {{mapId?:string, def?:object, jumpPads?:Array, flags?:Uint8Array,
   *          inside?:(x:number,y:number,z:number)=>boolean}} opts  `inside(x,y,z)`: point-in-solid test
   *          (CollisionWorld.isInsideXYZ). Depth counting over the triangle columns is exact for closed solids but
   *          cannot see nodes inside solids with missing faces (a pillar shaft without a bottom cap, ...): such nodes
   *          are dropped so no bot ever paths into geometry. Only nodes with wall triangles in the surrounding 3x3 cells and
   *          geometry above them are tested (one probe at mid-body height).
   */
  static build(tris, bounds, opts = {}) {
    const key = opts.mapId;
    if (key && cache.has(key)) {
      const c = cache.get(key);
      if (c.def === opts.def && c.triCount === tris.length) return c.graph;
    }
    const g = new NavGraph();
    g._build(tris, bounds, opts);
    if (key) cache.set(key, { def: opts.def, triCount: tris.length, graph: g });
    return g;
  }

  static clearCache() { cache.clear(); }

  // ------------------------------------------------------------------ build

  _build(tris, bounds, opts) {
    const t0 = performance.now();
    if (!tris || tris.length < 9) { this.stats.buildMs = 0; return; }
    // grid extent = triangles' XZ extent clipped to bounds
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (let i = 0; i < tris.length; i += 3) {
      const x = tris[i], z = tris[i + 2];
      if (x < x0) x0 = x; if (x > x1) x1 = x;
      if (z < z0) z0 = z; if (z > z1) z1 = z;
    }
    if (bounds) {
      x0 = Math.max(x0, bounds.min.x); x1 = Math.min(x1, bounds.max.x);
      z0 = Math.max(z0, bounds.min.z); z1 = Math.min(z1, bounds.max.z);
    }
    this.minX = Math.floor(x0);
    this.minZ = Math.floor(z0);
    this.nx = Math.max(1, Math.ceil(x1) - this.minX);
    this.nz = Math.max(1, Math.ceil(z1) - this.minZ);
    const grid = (this.grid = new TriGrid(tris, this.minX, this.minZ, this.nx, this.nz, opts.flags || null));
    const yMin = bounds ? bounds.min.y : -Infinity, yMax = bounds ? bounds.max.y : Infinity;

    // ---- nodes
    const NX = [], NY = [], NZ = [], NH = [];
    const { nx, nz } = this;
    this.colStart = new Int32Array(nx * nz + 1);
    const fy = new Float32Array(MAX_HITS), fh = new Float32Array(MAX_HITS);
    const wallStart = grid.wall.start;
    const inside = typeof opts.inside === 'function' ? opts.inside : null;
    let removedInside = 0;
    const removedSample = [];
    for (let j = 0; j < nz; j++) {
      for (let i = 0; i < nx; i++) {
        const ci = j * nx + i;
        this.colStart[ci] = NX.length;
        const x = this.minX + i + 0.5 + JX, z = this.minZ + j + 0.5 + JZ;
        const c = grid.floorsAt(x, z, fy, fh, HEADROOM);
        const hasWalls = wallStart[ci + 1] > wallStart[ci];
        // wall triangles in this cell or one of its 8 neighbours (a solid with missing faces has its walls right there)
        let nearWalls = false;
        if (inside && c > 0) {
          for (let dj = -1; dj <= 1 && !nearWalls; dj++) {
            const jj = j + dj;
            if (jj < 0 || jj >= nz) continue;
            for (let di = -1; di <= 1; di++) {
              const ii = i + di;
              if (ii < 0 || ii >= nx) continue;
              const cc = jj * nx + ii;
              if (wallStart[cc + 1] > wallStart[cc]) { nearWalls = true; break; }
            }
          }
        }
        for (let k = 0; k < c; k++) {
          const y = fy[k];
          if (y < yMin || y > yMax) continue;
          if (hasWalls && this._nodeBlocked(grid, x, y, z)) continue;
          // a node buried in a solid always has geometry above it: nodes under open sky need no test
          if (nearWalls && fh[k] < 1e9 && inside(x, y + 0.9, z)) {
            removedInside++;
            if (removedSample.length < 4) removedSample.push([+x.toFixed(2), +y.toFixed(2), +z.toFixed(2)]);
            continue;
          }
          NX.push(x); NY.push(y); NZ.push(z); NH.push(fh[k]);
        }
      }
    }
    this.stats.removedInside = removedInside;
    this.stats.removedSample = removedSample;
    this.colStart[nx * nz] = NX.length;
    const N = NX.length;
    const mask = new Uint8Array(N);
    const adj = new Array(N);
    for (let i = 0; i < N; i++) adj[i] = [];
    let linkCount = 0;
    const addLink = (a, b, cost, type, pad) => {
      const l = { to: b, cost, type };
      if (pad) l.pad = true;
      adj[a].push(l);
      linkCount++;
    };

    // ---- neighbour links (each unordered pair evaluated once)
    const cs = this.colStart;
    for (let j = 0; j < nz; j++) {
      for (let i = 0; i < nx; i++) {
        const ci = j * nx + i;
        for (let a = cs[ci]; a < cs[ci + 1]; a++) {
          for (let d = 0; d < 4; d++) {
            const ni = i + DIRS[d][0], nj = j + DIRS[d][1];
            if (ni < 0 || nj < 0 || ni >= nx || nj >= nz) continue;
            const cn = nj * nx + ni;
            const dist = d % 2 === 1 ? Math.SQRT2 : 1;
            for (let b = cs[cn]; b < cs[cn + 1]; b++) {
              const r = this._pair(grid, NX, NY, NZ, a, b, dist);
              if (!r) continue;
              const dy = NY[b] - NY[a];
              const len3 = Math.hypot(dist, dy);
              // r: 1 = walk both ways, 2 = jump lo->hi, walk/drop hi->lo
              if (r === 1) {
                const slopeCost = 1 + Math.min(0.5, Math.abs(dy) * 0.12);
                addLink(a, b, len3 * slopeCost, 'walk');
                addLink(b, a, len3 * slopeCost, 'walk');
              } else {
                const lo = dy >= 0 ? a : b, hi = dy >= 0 ? b : a;
                const ady = Math.abs(dy);
                addLink(lo, hi, len3 + 2.5 + ady, 'jump');
                if (ady <= 0.65) addLink(hi, lo, len3, 'walk');
                else addLink(hi, lo, len3 + 0.8 + ady * 0.3, 'drop');
              }
              mask[a] |= 1 << d;
              mask[b] |= 1 << ((d + 4) % 8);
            }
          }
        }
      }
    }

    // ---- ledge drops
    for (let j = 0; j < nz; j++) {
      for (let i = 0; i < nx; i++) {
        const ci = j * nx + i;
        for (let a = cs[ci]; a < cs[ci + 1]; a++) {
          for (let d = 0; d < 8; d++) {
            if (mask[a] & (1 << d)) continue;
            this._ledge(grid, NX, NY, NZ, NH, adj, addLink, a, i, j, d);
          }
        }
      }
    }

    // ---- jump pad links
    const pads = opts.jumpPads || [];
    for (const pad of pads) {
      if (!pad || !pad.position || !pad.target) continue;
      const from = this._nearestIdx(NX, NY, NZ, pad.position.x, pad.position.y, pad.position.z, 1.8);
      const to = this._nearestIdx(NX, NY, NZ, pad.target.x, pad.target.y, pad.target.z, 3.2);
      if (from < 0 || to < 0 || from === to) continue;
      const hd = Math.hypot(NX[to] - NX[from], NZ[to] - NZ[from]);
      const dy = NY[to] - NY[from];
      addLink(from, to, Math.hypot(hd, dy) * 0.9 + 2, 'jump', true);
    }

    // ---- node objects
    const nodes = (this.nodes = new Array(N));
    for (let i = 0; i < N; i++) {
      nodes[i] = { id: i, position: new THREE.Vector3(NX[i], NY[i], NZ[i]), links: adj[i], headroom: NH[i], comp: -1, scc: -1, main: false };
    }
    this._components();
    this._flatten();
    this.stats.nodes = N;
    this.stats.cells = nx * nz;
    this.stats.links = linkCount;
    this.stats.buildMs = Math.round(performance.now() - t0);
  }

  /** Walls too close to a standing capsule at (x,y,z)? */
  _nodeBlocked(grid, x, y, z) {
    for (let d = 0; d < 8; d++) {
      const ax = DIRS[d][0], az = DIRS[d][1];
      const l = Math.hypot(ax, az);
      const ex = x + (ax / l) * CLEAR_R, ez = z + (az / l) * CLEAR_R;
      if (grid.segBlocked(x, y + 0.5, z, ex, y + 0.5, ez)) return true;
      if (grid.segBlocked(x, y + 1.45, z, ex, y + 1.45, ez)) return true;
    }
    return false;
  }

  /** 0 = no link, 1 = walkable both ways, 2 = step needing a jump (up) */
  _pair(grid, NX, NY, NZ, a, b, dist) {
    const ax = NX[a], ay = NY[a], az = NZ[a], bx = NX[b], by = NY[b], bz = NZ[b];
    const dy = by - ay, ady = Math.abs(dy);
    if (ady > JUMP_MAX) return 0;
    const hi = Math.max(ay, by);
    if (grid.segBlocked(ax, hi + 0.4, az, bx, hi + 0.4, bz)) return 0;
    if (grid.segBlocked(ax, hi + 1.0, az, bx, hi + 1.0, bz)) return 0;
    if (grid.segBlocked(ax, hi + 1.55, az, bx, hi + 1.55, bz)) return 0;
    const mid = grid.floorNear((ax + bx) / 2, (az + bz) / 2, (ay + by) / 2, ady / 2 + 0.2);
    if (Number.isNaN(mid)) return 0;
    if (Math.abs(mid - (ay + by) / 2) <= 0.14 && ady <= 0.66 * dist + 0.08) return 1;
    if (ady <= WALK_ANY) return 1;
    return 2;
  }

  _ledge(grid, NX, NY, NZ, NH, adj, addLink, a, ci, cj, d) {
    const ax = NX[a], ay = NY[a], az = NZ[a];
    const dx = DIRS[d][0], dz = DIRS[d][1];
    const diag = dx !== 0 && dz !== 0;
    const maxK = diag ? 1 : 2;
    const l = Math.hypot(dx, dz);
    // must be able to step out: no wall/railing in the first metre (tested with capsule-wide lateral offsets)
    const px = -dz / l, pz = dx / l;
    const sx = ax + (dx / l) * 0.95, sz = az + (dz / l) * 0.95;
    if (this._sweepBlocked(grid, ax, ay, az, sx, sz, px, pz)) return;
    // ...and no walkable floor right next to us (that would already be a walk/jump link)
    for (let k = 1; k <= maxK; k++) {
      const ni = ci + dx * k, nj = cj + dz * k;
      if (ni < 0 || nj < 0 || ni >= this.nx || nj >= this.nz) return;
      const cn = nj * this.nx + ni;
      let best = -1, bestY = -Infinity;
      for (let b = this.colStart[cn]; b < this.colStart[cn + 1]; b++) {
        const drop = ay - NY[b];
        if (drop < 1.0 || drop > DROP_MAX) continue;
        if (NH[b] < drop + 1.0) continue;
        if (NY[b] > bestY) { bestY = NY[b]; best = b; }
      }
      if (best < 0) continue;
      const bx = NX[best], bz = NZ[best];
      if (this._sweepBlocked(grid, ax, ay, az, bx, bz, px, pz)) return;
      const hd = Math.hypot(bx - ax, bz - az);
      const drop = ay - NY[best];
      addLink(a, best, hd + 1.0 + drop * 0.4, 'drop');
      return;
    }
  }

  /** Is the horizontal path (ax,az)->(bx,bz) blocked for a 0.6 m wide, 1.4 m tall mover (rays at 3 lateral offsets)? */
  _sweepBlocked(grid, ax, ay, az, bx, bz, px, pz) {
    for (const o of [0, 0.3, -0.3]) {
      const ox = px * o, oz = pz * o;
      if (grid.segBlocked(ax + ox, ay + 0.5, az + oz, bx + ox, ay + 0.5, bz + oz)) return true;
      if (grid.segBlocked(ax + ox, ay + 1.4, az + oz, bx + ox, ay + 1.4, bz + oz)) return true;
    }
    return false;
  }

  _nearestIdx(NX, NY, NZ, x, y, z, maxD) {
    const ci = Math.floor(x - this.minX), cj = Math.floor(z - this.minZ);
    const r = Math.ceil(maxD);
    let best = -1, bd = maxD * maxD;
    for (let j = cj - r; j <= cj + r; j++) {
      for (let i = ci - r; i <= ci + r; i++) {
        if (i < 0 || j < 0 || i >= this.nx || j >= this.nz) continue;
        const c = j * this.nx + i;
        for (let n = this.colStart[c]; n < this.colStart[c + 1]; n++) {
          const dx = NX[n] - x, dz = NZ[n] - z, dy = (NY[n] - y) * 2;
          const d = dx * dx + dz * dz + dy * dy;
          if (d < bd) { bd = d; best = n; }
        }
      }
    }
    return best;
  }

  _components() {
    const nodes = this.nodes, N = nodes.length;
    // weak components: union-find over undirected links
    const parent = new Int32Array(N);
    for (let i = 0; i < N; i++) parent[i] = i;
    const find = x => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
    for (let i = 0; i < N; i++) for (const l of nodes[i].links) { const a = find(i), b = find(l.to); if (a !== b) parent[a] = b; }
    const sizes = new Map();
    for (let i = 0; i < N; i++) { const r = find(i); nodes[i].comp = r; sizes.set(r, (sizes.get(r) || 0) + 1); }
    let largestWeak = 0;
    for (const s of sizes.values()) largestWeak = Math.max(largestWeak, s);

    // strong components (iterative Tarjan)
    const index = new Int32Array(N).fill(-1), low = new Int32Array(N), onStack = new Uint8Array(N);
    const stack = [], call = [], itPos = new Int32Array(N);
    let idx = 0, sccCount = 0;
    const sccSize = [];
    for (let s = 0; s < N; s++) {
      if (index[s] !== -1) continue;
      call.push(s);
      while (call.length) {
        const v = call[call.length - 1];
        if (index[v] === -1) { index[v] = low[v] = idx++; stack.push(v); onStack[v] = 1; }
        const links = nodes[v].links;
        let pushed = false;
        while (itPos[v] < links.length) {
          const w = links[itPos[v]++].to;
          if (index[w] === -1) { call.push(w); pushed = true; break; }
          if (onStack[w]) low[v] = Math.min(low[v], index[w]);
        }
        if (pushed) continue;
        if (low[v] === index[v]) {
          let size = 0, w;
          do { w = stack.pop(); onStack[w] = 0; nodes[w].scc = sccCount; size++; } while (w !== v);
          sccSize.push(size);
          sccCount++;
        }
        call.pop();
        if (call.length) { const p = call[call.length - 1]; low[p] = Math.min(low[p], low[v]); }
      }
    }
    let main = 0;
    for (let i = 1; i < sccSize.length; i++) if (sccSize[i] > sccSize[main]) main = i;
    this._mainScc = main;
    this._sccCount = sccCount;
    this._reachCache.clear();
    this._main = [];
    for (let i = 0; i < N; i++) { if (nodes[i].scc === main) { nodes[i].main = true; this._main.push(nodes[i]); } }
    // reachability relative to the main area: `fromMain` = a bot can get there, `toMain` = a bot can get out
    const fromMain = new Uint8Array(N), toMain = new Uint8Array(N);
    const rev = new Array(N);
    for (let i = 0; i < N; i++) rev[i] = [];
    for (let i = 0; i < N; i++) for (const l of nodes[i].links) rev[l.to].push(i);
    const flood = (adjOf, mark) => {
      const q = [];
      for (const n of this._main) { mark[n.id] = 1; q.push(n.id); }
      while (q.length) {
        const u = q.pop();
        const a = adjOf(u);
        for (let k = 0; k < a.length; k++) {
          const v = typeof a[k] === 'number' ? a[k] : a[k].to;
          if (!mark[v]) { mark[v] = 1; q.push(v); }
        }
      }
    };
    flood(u => nodes[u].links, fromMain);
    flood(u => rev[u], toMain);
    let traps = 0;
    for (let i = 0; i < N; i++) {
      nodes[i].fromMain = !!fromMain[i];
      nodes[i].toMain = !!toMain[i];
      if (fromMain[i] && !nodes[i].main) traps++;
    }
    this.stats.traps = traps;
    this.stats.components = sizes.size;
    this.stats.largestComponent = largestWeak;
    this.stats.strongComponents = sccCount;
    this.stats.largestStrong = sccSize[main] || 0;
  }

  /** Flat typed-array copies of node positions and links for the search loops; allocates the scratch arrays. */
  _flatten() {
    const nodes = this.nodes, N = nodes.length;
    let L = 0;
    for (let i = 0; i < N; i++) L += nodes[i].links.length;
    const px = (this._px = new Float64Array(N)), py = (this._py = new Float64Array(N)), pz = (this._pz = new Float64Array(N));
    const ls = (this._linkStart = new Int32Array(N + 1)), lt = (this._linkTo = new Int32Array(L)), lc = (this._linkCost = new Float64Array(L));
    let k = 0;
    for (let i = 0; i < N; i++) {
      const n = nodes[i];
      px[i] = n.position.x; py[i] = n.position.y; pz[i] = n.position.z;
      ls[i] = k;
      for (const l of n.links) { lt[k] = l.to; lc[k] = l.cost; k++; }
    }
    ls[N] = k;
    this._jobSpace = null;
    this._syncSpace = null;
    this._reachSeen = new Int32Array(N);
    this._reachStamp = 0;
  }

  // ------------------------------------------------------------------ queries

  /**
   * Nearest node to a feet position (vertical distance counts double). null if none within maxDist.
   * @param {THREE.Vector3} pos
   * @param {number} [maxDist=6]
   */
  nearestNode(pos, maxDist = 6) {
    const N = this.nodes.length;
    if (!N) return null;
    const ci = Math.floor(pos.x - this.minX), cj = Math.floor(pos.z - this.minZ);
    const maxR = Math.ceil(maxDist / CELL) + 1;
    let best = null, bd = maxDist * maxDist;
    for (let r = 0; r <= maxR; r++) {
      if (best && Math.sqrt(bd) <= (r - 1) * CELL) break;
      for (let j = cj - r; j <= cj + r; j++) {
        if (j < 0 || j >= this.nz) continue;
        const edgeRow = j === cj - r || j === cj + r;
        for (let i = ci - r; i <= ci + r; i += (edgeRow || r === 0) ? 1 : 2 * r) {
          if (i < 0 || i >= this.nx) continue;
          const c = j * this.nx + i;
          for (let n = this.colStart[c]; n < this.colStart[c + 1]; n++) {
            const p = this.nodes[n].position;
            const dx = p.x - pos.x, dz = p.z - pos.z, dy = (p.y - pos.y) * 2;
            const d = dx * dx + dz * dz + dy * dy;
            if (d < bd) { bd = d; best = this.nodes[n]; }
          }
        }
      }
    }
    return best;
  }

  /** Is there no wall between the feet position `pos` and the node (checked at knee and chest height)? */
  _seesNode(pos, node) {
    const p = node.position;
    const dx = p.x - pos.x, dy = p.y - pos.y, dz = p.z - pos.z;
    if (dx * dx + dy * dy + dz * dz < 0.25) return true;
    const grid = this.grid;
    if (!grid) return true;
    return !grid.segBlocked(pos.x, pos.y + 0.45, pos.z, p.x, p.y + 0.45, p.z)
      && !grid.segBlocked(pos.x, pos.y + 1.1, pos.z, p.x, p.y + 1.1, p.z);
  }

  /**
   * nearestNode() that does not pick a node behind a wall: when the nearest node cannot be seen from `pos` (thin
   * walls, slots between props), the nearest node with a clear line and a similar height is returned instead.
   * Falls back to the plain nearest node when none of the close candidates is visible.
   * @param {THREE.Vector3} pos feet position
   * @param {number} [maxDist=6]
   */
  _nearestVisible(pos, maxDist = 6) {
    return this._visibleFrom(pos, this.nearestNode(pos, maxDist), maxDist);
  }

  /** _nearestVisible() given the plain nearest node `first` (null passes through). */
  _visibleFrom(pos, first, maxDist) {
    if (!first || this._seesNode(pos, first)) return first;
    const cand = this._cand || (this._cand = { id: new Int32Array(96), d: new Float32Array(96) });
    const R = Math.min(maxDist, 4);
    const maxR = Math.ceil(R / CELL) + 1;
    const ci = Math.floor(pos.x - this.minX), cj = Math.floor(pos.z - this.minZ);
    const nodes = this.nodes;
    let n = 0;
    for (let j = cj - maxR; j <= cj + maxR; j++) {
      if (j < 0 || j >= this.nz) continue;
      for (let i = ci - maxR; i <= ci + maxR; i++) {
        if (i < 0 || i >= this.nx) continue;
        const c = j * this.nx + i;
        for (let k = this.colStart[c]; k < this.colStart[c + 1]; k++) {
          const p = nodes[k].position;
          const dy = p.y - pos.y;
          if (dy > 1.5 || dy < -1.5 || k === first.id || n >= 96) continue;
          const dx = p.x - pos.x, dz = p.z - pos.z;
          const d = dx * dx + dz * dz + dy * dy * 4;
          if (d < R * R) { cand.id[n] = k; cand.d[n] = d; n++; }
        }
      }
    }
    for (let tests = 0; tests < 8; tests++) {
      let bi = -1, bd = Infinity;
      for (let k = 0; k < n; k++) if (cand.d[k] < bd) { bd = cand.d[k]; bi = k; }
      if (bi < 0) break;
      cand.d[bi] = Infinity;
      const node = nodes[cand.id[bi]];
      if (this._seesNode(pos, node)) return node;
    }
    return first;
  }

  _resolve(a, maxDist = 6) {
    if (a == null) return null;
    if (typeof a === 'number') return this.nodes[a] || null;
    if (a.links && a.position) return a;
    if (a.isVector3) return this._nearestVisible(a, maxDist);
    if (a.position && a.position.isVector3) return this._nearestVisible(a.position, maxDist);
    return null;
  }

  /** True when a bot can walk from a to b (Vector3 | node | node id): same/reachable area, following one-way drops and jumps. */
  isConnected(a, b) {
    const na = this._resolve(a), nb = this._resolve(b);
    if (!na || !nb) return false;
    return this._reachable(na, nb);
  }

  /**
   * Exact directed reachability between two nodes. Decided from the component structure in O(1) except for the rare
   * pairs where neither end is tied to the main area; those run a pruned BFS whose verdict is cached per pair of
   * strong components (reachability is a property of the components, not of the nodes).
   */
  _reachable(na, nb) {
    if (na === nb || na.scc === nb.scc) return true;
    if (na.comp !== nb.comp) return false;
    if (na.toMain && nb.fromMain) return true;       // a -> main -> b
    if (na.fromMain && !nb.fromMain) return false;   // else main -> a -> b would make b reachable from main
    if (!na.toMain && nb.toMain) return false;       // else a -> b -> main would let a reach main
    const key = na.scc * this._sccCount + nb.scc;
    let r = this._reachCache.get(key);
    if (r === undefined) {
      r = this._reaches(na.id, nb.id, !nb.fromMain);
      if (this._reachCache.size >= REACH_CACHE_MAX) this._reachCache.clear();
      this._reachCache.set(key, r);
    }
    return r;
  }

  /**
   * Directed reachability BFS. `skipFromMain`: `to` is not reachable from the main area, so no path to it can pass a
   * node that is (the main area would then reach `to`): those nodes are not expanded, which keeps the search inside
   * the small isolated region instead of flooding the whole map.
   */
  _reaches(from, to, skipFromMain = false) {
    const stamp = ++this._reachStamp;
    const seen = this._reachSeen, nodes = this.nodes;
    const ls = this._linkStart, lt = this._linkTo;
    const q = [from];
    seen[from] = stamp;
    for (let h = 0; h < q.length; h++) {
      const u = q[h];
      for (let k = ls[u], e = ls[u + 1]; k < e; k++) {
        const v = lt[k];
        if (v === to) return true;
        if (seen[v] === stamp) continue;
        seen[v] = stamp;
        if (skipFromMain && nodes[v].fromMain) continue;
        q.push(v);
      }
    }
    return false;
  }

  /**
   * Random node of the main (strongly connected) walkable area.
   * @param {(node)=>boolean} [filter]
   */
  randomNode(filter) {
    const list = this._main.length ? this._main : this.nodes;
    if (!list.length) return null;
    if (!filter) return list[Math.floor(Math.random() * list.length)];
    for (let t = 0; t < 40; t++) {
      const n = list[Math.floor(Math.random() * list.length)];
      if (filter(n)) return n;
    }
    const off = Math.floor(Math.random() * list.length);
    for (let i = 0; i < list.length; i++) {
      const n = list[(i + off) % list.length];
      if (filter(n)) return n;
    }
    return null;
  }

  /** A random walkable point (new Vector3) within `radius` of pos (main area), or null. */
  randomPointNear(pos, radius) {
    if (!this.nodes.length) return null;
    const ci = Math.floor(pos.x - this.minX), cj = Math.floor(pos.z - this.minZ);
    const r = Math.max(1, Math.ceil(radius));
    const r2 = radius * radius;
    let picked = null, seen = 0;
    for (let j = cj - r; j <= cj + r; j++) {
      if (j < 0 || j >= this.nz) continue;
      for (let i = ci - r; i <= ci + r; i++) {
        if (i < 0 || i >= this.nx) continue;
        const c = j * this.nx + i;
        for (let n = this.colStart[c]; n < this.colStart[c + 1]; n++) {
          const nd = this.nodes[n];
          if (!nd.main) continue;
          const p = nd.position;
          const dx = p.x - pos.x, dz = p.z - pos.z;
          if (dx * dx + dz * dz > r2 || Math.abs(p.y - pos.y) > Math.max(6, radius * 0.5)) continue;
          seen++;
          if (Math.random() * seen < 1) picked = nd; // reservoir sampling
        }
      }
    }
    return picked ? picked.position.clone() : null;
  }

  /**
   * A* path from `from` to `to` (Vector3 feet positions). Returns waypoints AFTER the start, string-pulled
   * along walk links only, ending near `to`; null if unreachable. The array carries `startBlocked = true` when no
   * node the mover can see was found near `from` (it stands in a pocket behind a wall: the first waypoint is not
   * walkable from where it is). Synchronous; bots use the time-sliced createPathJob / stepPath instead.
   * @returns {THREE.Vector3[]|null}
   */
  findPath(from, to) {
    const job = this._syncJob || (this._syncJob = new PathJob());
    this.createPathJob(from, to, job);
    this._step(job, Infinity, this._space(true));
    const res = job.result;
    job.result = null;
    return res;
  }

  /**
   * Start a time-sliced path request (the same result as findPath, computed across several stepPath calls).
   * @param {THREE.Vector3} from feet position (copied)
   * @param {THREE.Vector3} to goal feet position (copied)
   * @param {PathJob} [job] a job object to reuse (no allocation)
   * @param {{connect?: boolean}} [opts] connect: also fail when isConnected(from, to) would be false (no node within
   *        6 m of an end, or the goal area cannot be reached by walking / dropping / jumping)
   * @returns {PathJob}
   */
  createPathJob(from, to, job = new PathJob(), { connect = false } = {}) {
    job.from.copy(from);
    job.to.copy(to);
    job.connect = connect;
    job.done = false;
    job.result = null;
    job.expanded = 0;
    job._phase = J_START;
    job._s = null;
    job._g = null;
    job._stamp = 0;
    job._startBlocked = false;
    job._out = null;
    return job;
  }

  /**
   * Advance a path job until it is done or performance.now() reaches `deadline` (ms). The A* expansion loop checks
   * the clock every CHECK_EVERY expansions and the string pulling before every line test, so a call overshoots the
   * deadline by at most one small, bounded unit of work. Jobs share one search workspace: run them one after another
   * (a job whose half-finished search was overwritten by another job simply restarts it).
   * @param {PathJob} job
   * @param {number} [deadline=Infinity] performance.now() time to stop at
   * @returns {boolean} true when the job is done (result in job.result)
   */
  stepPath(job, deadline = Infinity) {
    if (job.done) return true;
    return this._step(job, deadline, this._space(false));
  }

  /** Scratch space for jobs (`sync` = the separate one of findPath). */
  _space(sync) {
    const N = this.nodes.length;
    let sp = sync ? this._syncSpace : this._jobSpace;
    if (!sp || sp.G.length !== N) {
      sp = new SearchSpace(N);
      if (sync) this._syncSpace = sp; else this._jobSpace = sp;
    }
    return sp;
  }

  _finish(job, result) {
    if (result && job._startBlocked) result.startBlocked = true;
    job.result = result;
    job.done = true;
    job._phase = J_DONE;
    job._s = job._g = null;
    job._out = null;
    job._chain.length = 0;
    job._types.length = 0;
    return true;
  }

  _step(job, deadline, sp) {
    if (job._phase === J_START) {
      const from = job.from, to = job.to;
      const ns = this.nearestNode(from, 8), ng = this.nearestNode(to, 8);
      const s = this._visibleFrom(from, ns, 8), g = this._visibleFrom(to, ng, 8);
      if (!s || !g || s.comp !== g.comp) return this._finish(job, null);
      // isConnected(from, to) resolves with a 6 m snap: same nodes whenever the plain nearest one is that close
      if (job.connect && (dist2(from, ns.position) >= CONNECT_R2 || dist2(to, ng.position) >= CONNECT_R2 || !this._reachable(s, g))) {
        return this._finish(job, null);
      }
      job._startBlocked = !this._seesNode(from, s);
      if (s === g) return this._finish(job, [this._endPoint(g, to)]);
      job._s = s;
      job._g = g;
      job._phase = J_SEARCH;
      job._stamp = 0;
    }
    if (job._phase === J_SEARCH) {
      if (!this._search(job, deadline, sp)) return false;
      if (job._phase === J_DONE) return true;   // unreachable
    }
    if (job._phase === J_SMOOTH) {
      if (!this._smoothStep(job, deadline)) return false;
      job._phase = J_FIRST;
    }
    if (job._phase === J_FIRST) {
      if (performance.now() >= deadline) return false;
      this._fixFirst(job);
      return this._finish(job, job._out);
    }
    return job.done;
  }

  /** A* on the flat arrays. Returns false when the deadline suspended it (resumable), true when finished. */
  _search(job, deadline, sp) {
    const s = job._s.id, gId = job._g.id;
    const G = sp.G, P = sp.P, seen = sp.seen, closed = sp.closed, heap = sp.heap;
    const px = this._px, py = this._py, pz = this._pz;
    const ls = this._linkStart, lt = this._linkTo, lc = this._linkCost;
    const gx = px[gId], gy = py[gId], gz = pz[gId];
    if (sp.owner !== job || sp.stamp !== job._stamp || job._stamp === 0) {
      // (re)start: a fresh stamp invalidates whatever another search left in the arrays
      const stamp = ++sp.stamp;
      sp.owner = job;
      job._stamp = stamp;
      heap.clear();
      G[s] = 0; P[s] = -1; seen[s] = stamp;
      const dx = px[s] - gx, dy = py[s] - gy, dz = pz[s] - gz;
      heap.push(s, Math.sqrt(dx * dx + dy * dy + dz * dz) * 0.9);
    }
    const stamp = job._stamp;
    let found = false;
    let n = 0;
    while (heap.size) {
      if (++n >= CHECK_EVERY) {
        n = 0;
        if (performance.now() >= deadline) return false;
      }
      const u = heap.pop();
      if (closed[u] === stamp) continue;
      closed[u] = stamp;
      job.expanded++;
      if (u === gId) { found = true; break; }
      const gu = G[u];
      for (let k = ls[u], e = ls[u + 1]; k < e; k++) {
        const v = lt[k];
        if (closed[v] === stamp) continue;
        const ng = gu + lc[k];
        if (seen[v] !== stamp || ng < G[v]) {
          seen[v] = stamp; G[v] = ng; P[v] = u;
          const dx = px[v] - gx, dy = py[v] - gy, dz = pz[v] - gz;
          heap.push(v, ng + Math.sqrt(dx * dx + dy * dy + dz * dz) * 0.9);
        }
      }
    }
    sp.owner = null;
    if (!found) { this._finish(job, null); return true; }
    // node chain start -> goal + the type of the link arriving at each node
    const chain = job._chain, types = job._types;
    chain.length = 0;
    for (let v = gId; v !== -1; v = P[v]) chain.push(v);
    chain.reverse();
    types.length = 0;
    for (let i = 0; i < chain.length; i++) {
      const link = i === 0 ? null : this._linkBetween(chain[i - 1], chain[i]);
      types.push(link ? (link.pad ? 'pad' : link.type) : 'walk');
    }
    job._out = [];
    job._i = 0;
    job._cur = -1;
    job._phase = J_SMOOTH;
    return true;
  }

  _linkBetween(a, b) {
    const links = this.nodes[a].links;
    let best = null;
    for (let i = 0; i < links.length; i++) if (links[i].to === b && (!best || links[i].cost < best.cost)) best = links[i];
    return best;
  }

  _endPoint(g, to) {
    const p = g.position.clone();
    p.type = 'walk';
    if (to && Math.abs(to.y - p.y) < 0.9 && Math.hypot(to.x - p.x, to.z - p.z) < 1.6) {
      const q = to.clone();
      q.y = p.y;
      q.type = 'walk';
      return q;
    }
    return p;
  }

  /**
   * String pulling, resumable: convert the node chain to waypoints, merging runs of walk links that are provably clear.
   * From each corner the farthest clear node of the run (at most LOOK_MAX ahead) is found by exponential probing plus a
   * binary search: O(log L) line tests per corner instead of the old linear scan's O(L^2) work on long clear runs.
   * Every emitted segment is a verified clear line, exactly like before. Returns false when the deadline suspended it.
   */
  _smoothStep(job, deadline) {
    const nodes = this.nodes, chain = job._chain, types = job._types, out = job._out;
    const n = chain.length;
    for (;;) {
      if (job._cur < 0) {
        // at the start of a run (index job._i)
        const i = job._i;
        if (i >= n - 1) return true;
        let runEnd = i;
        while (runEnd + 1 < n && types[runEnd + 1] === 'walk') runEnd++;
        if (runEnd === i) {
          const w = nodes[chain[i + 1]].position.clone();
          w.type = types[i + 1] === 'pad' ? 'jump' : types[i + 1];
          if (types[i + 1] === 'pad') w.pad = true;
          out.push(w);
          job._i = i + 1;
          continue;
        }
        job._runEnd = runEnd;
        job._cur = i;
        job._lo = -1;
      }
      const cur = job._cur, runEnd = job._runEnd;
      if (cur >= runEnd) { job._i = runEnd; job._cur = -1; continue; }
      if (job._lo < 0) {
        job._lo = cur + 1;                                 // the next node is always reachable (walk link)
        job._hi = Math.min(runEnd, cur + LOOK_MAX) + 1;    // exclusive bound: first index not (known to be) clear
        job._d = 2;
        job._mode = 0;                                     // 0 exponential, 1 last node in range, 2 binary search
      }
      let k = -1;
      if (job._mode === 0) {
        k = cur + job._d;
        if (k >= job._hi) { k = -1; job._mode = 1; }
      }
      if (k < 0 && job._mode === 1) {
        if (job._lo < job._hi - 1) k = job._hi - 1; else job._mode = 2;
      }
      if (k < 0 && job._mode === 2 && job._hi - job._lo > 1) k = (job._lo + job._hi) >> 1;
      if (k < 0) {
        const w = nodes[chain[job._lo]].position.clone();
        w.type = 'walk';
        out.push(w);
        job._cur = job._lo;
        job._lo = -1;
        continue;
      }
      if (performance.now() >= deadline) return false;
      const clear = this._clearLine(nodes[chain[cur]].position, nodes[chain[k]].position);
      if (job._mode === 0) {
        if (clear) { job._lo = k; job._d *= 2; } else { job._hi = k; job._mode = 2; }
      } else {
        if (clear) job._lo = k; else job._hi = k;
        job._mode = 2;
      }
    }
  }

  /**
   * Make sure the mover can actually reach the first waypoint from where it stands: when the straight line is blocked,
   * or the first step is a drop/jump, walk to the start node first. Then snap the last waypoint onto the goal.
   */
  _fixFirst(job) {
    const nodes = this.nodes, chain = job._chain, out = job._out, from = job.from;
    if (out.length && from) {
      const sp = nodes[chain[0]].position;
      const first = out[0];
      const near = Math.hypot(sp.x - from.x, sp.z - from.z) < 3.2;
      if (near && (first.type !== 'walk' || !this._clearLine(from, first, true)) && Math.hypot(sp.x - from.x, sp.z - from.z) > 0.6) {
        const w = sp.clone();
        w.type = 'walk';
        out.unshift(w);
      }
    }
    const last = out[out.length - 1];
    const goalNode = job._g;
    if (last && goalNode && last.type === 'walk' && last.distanceToSquared(goalNode.position) < 1e-6) {
      out[out.length - 1] = this._endPoint(goalNode, job.to);
    }
  }

  /** Is the straight walk A->B supported by floor and free of walls (with a 0.32 m corridor)? */
  _clearLine(a, b, loose = false) {
    const grid = this.grid;
    if (!grid) return false;
    const dx = b.x - a.x, dz = b.z - a.z, dy = b.y - a.y;
    const len = Math.hypot(dx, dz);
    if (len < 1e-3) return true;
    const nxn = -dz / len, nzn = dx / len;
    const steps = Math.max(1, Math.ceil(len / 0.5));
    const tol = loose ? 0.6 : 0.32;
    for (let s = 1; s < steps; s++) {
      const f = s / steps;
      const x = a.x + dx * f, z = a.z + dz * f, y = a.y + dy * f;
      if (Number.isNaN(grid.floorNear(x, z, y, tol))) return false;
      if (Number.isNaN(grid.floorNear(x + nxn * 0.32, z + nzn * 0.32, y, 0.45))) return false;
      if (Number.isNaN(grid.floorNear(x - nxn * 0.32, z - nzn * 0.32, y, 0.45))) return false;
    }
    for (let i = 0; i < CLEAR_HEIGHTS.length; i++) {
      const h = CLEAR_HEIGHTS[i];
      if (grid.segBlocked(a.x, a.y + h, a.z, b.x, b.y + h, b.z)) return false;
      if (grid.segBlocked(a.x + nxn * 0.32, a.y + h, a.z + nzn * 0.32, b.x + nxn * 0.32, b.y + h, b.z + nzn * 0.32)) return false;
      if (grid.segBlocked(a.x - nxn * 0.32, a.y + h, a.z - nzn * 0.32, b.x - nxn * 0.32, b.y + h, b.z - nzn * 0.32)) return false;
    }
    return true;
  }

  // ------------------------------------------------------------------ debug

  /** Visualisation: cyan = walk, yellow = jump, magenta = drop, orange = jump pad, red points = unreachable nodes. */
  debugObject() {
    if (this._debug) return this._debug;
    const root = new THREE.Group();
    root.name = 'nav-debug';
    const nodes = this.nodes;
    const pos = [], col = [];
    const C = { walk: [0.2, 0.9, 1.0], jump: [1.0, 0.9, 0.2], drop: [1.0, 0.25, 0.8], pad: [1.0, 0.55, 0.1] };
    for (const n of nodes) {
      for (const l of n.links) {
        const b = nodes[l.to].position;
        const c = l.pad ? C.pad : C[l.type] || C.walk;
        pos.push(n.position.x, n.position.y + 0.12, n.position.z, b.x, b.y + 0.12, b.z);
        col.push(c[0], c[1], c[2], c[0] * 0.5, c[1] * 0.5, c[2] * 0.5);
      }
    }
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    lg.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    const lines = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.85, depthTest: false }));
    lines.renderOrder = 999;
    root.add(lines);
    const pp = [], pc = [];
    for (const n of nodes) {
      pp.push(n.position.x, n.position.y + 0.12, n.position.z);
      if (n.main) pc.push(0.3, 1, 0.4); else pc.push(1, 0.15, 0.15);
    }
    const pg = new THREE.BufferGeometry();
    pg.setAttribute('position', new THREE.Float32BufferAttribute(pp, 3));
    pg.setAttribute('color', new THREE.Float32BufferAttribute(pc, 3));
    const points = new THREE.Points(pg, new THREE.PointsMaterial({ size: 0.16, vertexColors: true, depthTest: false }));
    points.renderOrder = 1000;
    root.add(points);
    this._debug = root;
    return root;
  }

  dispose() {
    if (this._debug) {
      this._debug.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
      this._debug = null;
    }
  }
}
