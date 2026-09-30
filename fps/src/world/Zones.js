// King of the Hill control zones: the validated zone list of a map (def.zones, or auto-picked spots when a map has
// none) and the world-space visuals of the live / next zone. Mode logic (rotation, scoring) lives in core/Modes.js.
//
// def.zones = [{ id, name, pos: [x, y, z] /* floor centre */, radius = 7, halfUp = 3.2, halfDown = 1.2 }]  (rotation order)
//
// Visuals: an additive open cylinder wall (vertical alpha gradient, scrolling energy lines), a floor ring and a faint floor
// disc for the live zone, and one dim pulsing ring for the upcoming zone. No lights, no depth writes, 4 draw calls.

import * as THREE from 'three';
import { HILL, TEAM_BLUE, TEAM_RED, TEAM_COLORS } from '../core/constants.js';
import { damp } from '../core/utils.js';

const WALL_H = 14;
const MIN_NODES = 30;        // a zone should cover at least this many walkable nav nodes
const MIN_NODES_HARD = 6;    // below this a zone is dropped (bots could never reach / hold it)
const AUTO_COUNT = 4;

const _o = new THREE.Vector3();
const _d = new THREE.Vector3(0, -1, 0);
const _warned = new Set();

function warnOnce(msg) {
  if (_warned.has(msg)) return;
  _warned.add(msg);
  console.warn('[zones] ' + msg);
}

/**
 * Is a feet position inside a zone cylinder (horizontal radius, vertical window around the zone floor)?
 * @param {{pos: THREE.Vector3, radius: number, halfUp: number, halfDown: number}} z
 */
export function zoneContains(z, x, y, zz, margin = 0) {
  const dx = x - z.pos.x, dz = zz - z.pos.z;
  const r = z.radius + margin;
  if (dx * dx + dz * dz > r * r) return false;
  const dy = y - z.pos.y;
  return dy >= -z.halfDown - margin * 0.4 && dy <= z.halfUp + margin * 0.4;
}

/** A random walkable spot inside the zone (a nav node position, shared - do not mutate), or its centre. */
export function zonePoint(z) {
  const n = z.nodes;
  return n.length ? n[(Math.random() * n.length) | 0] : z.pos;
}

/** Fill zone.nodes with the main-area nav nodes that lie inside its cylinder. */
function collectNodes(z, nav) {
  z.nodes = [];
  if (!nav || !nav.nodes) return;
  const r2 = z.radius * z.radius * 0.8;
  for (const nd of nav.nodes) {
    if (!nd.main) continue;
    const p = nd.position;
    const dx = p.x - z.pos.x, dz = p.z - z.pos.z;
    if (dx * dx + dz * dz > r2) continue;
    const dy = p.y - z.pos.y;
    if (dy < -z.halfDown || dy > z.halfUp - 0.4) continue;
    z.nodes.push(p);
  }
}

function makeZone(id, name, x, y, z, radius, halfUp, halfDown) {
  return {
    id, name, pos: new THREE.Vector3(x, y, z),
    radius: radius > 0 ? radius : HILL.radius,
    halfUp: halfUp > 0 ? halfUp : HILL.halfUp,
    halfDown: halfDown > 0 ? halfDown : HILL.halfDown,
    nodes: [], source: 'map',
  };
}

/**
 * The zone list for a loaded world: def.zones validated against the collision floor and the nav graph, or - when the
 * map has none (or none usable) - up to 4 well separated, nav-connected spots away from the spawn points.
 * @param {object} world
 * @returns {Array} zones with `pos` (Vector3), radius, halfUp, halfDown, nodes (nav positions inside), source
 */
export function resolveZones(world) {
  const def = world.def || {};
  const nav = world.nav;
  const out = [];
  const raw = Array.isArray(def.zones) ? def.zones : [];
  raw.forEach((d, i) => {
    if (!d || !Array.isArray(d.pos) || d.pos.length < 3 || d.pos.some(v => !Number.isFinite(v))) {
      warnOnce(`zone #${i}: 'pos' must be [x, y, z]`);
      return;
    }
    const z = makeZone(d.id || 'zone' + i, d.name || 'Zone ' + (i + 1), d.pos[0], d.pos[1], d.pos[2], d.radius, d.halfUp, d.halfDown);
    if (world.collision) {
      const hit = world.collision.raycast(_o.set(z.pos.x, z.pos.y + 1.5, z.pos.z), _d, 4);
      if (!hit || Math.abs(hit.point.y - z.pos.y) > 1.5) warnOnce(`zone '${z.id}' on ${def.id}: no floor within 1.5 m of [${d.pos.join(', ')}]`);
      else z.pos.y = hit.point.y;
    }
    collectNodes(z, nav);
    if (z.nodes.length < MIN_NODES_HARD) {
      warnOnce(`zone '${z.id}' on ${def.id} covers ${z.nodes.length} walkable nodes: dropped`);
      return;
    }
    if (z.nodes.length < MIN_NODES) warnOnce(`zone '${z.id}' on ${def.id} covers only ${z.nodes.length} walkable nodes`);
    out.push(z);
  });
  if (out.length >= 2) return out;
  return autoZones(world);
}

/** Fallback for maps without zones: farthest-point sampling over the dense, connected parts of the nav graph. */
function autoZones(world) {
  const nav = world.nav;
  const list = [];
  if (!nav || !nav.nodes || !nav.nodes.length) {
    warnOnce('no nav graph: King of the Hill has no zones');
    return list;
  }
  const main = nav.nodes.filter(n => n.main);
  if (!main.length) return list;
  const spawns = (world.spawnPoints || []).map(s => s.position);
  const b = world.bounds;
  const cx = b ? (b.min.x + b.max.x) / 2 : 0, cz = b ? (b.min.z + b.max.z) / 2 : 0;
  const R = HILL.radius;
  // candidates: a thinned sample of the main nodes, with local density (walkable area inside the radius) and spawn clearance
  const step = Math.max(1, Math.floor(main.length / 260));
  const cand = [];
  for (let i = 0; i < main.length; i += step) {
    const p = main[i].position;
    let dens = 0;
    for (let k = 0; k < main.length; k++) {
      const q = main[k].position;
      const dx = q.x - p.x, dz = q.z - p.z;
      if (dx * dx + dz * dz <= R * R * 0.64 && Math.abs(q.y - p.y) <= HILL.halfUp - 0.4 && q.y - p.y >= -HILL.halfDown) dens++;
    }
    if (dens < MIN_NODES) continue;
    let clear = Infinity;
    for (const s of spawns) clear = Math.min(clear, Math.hypot(s.x - p.x, s.z - p.z));
    cand.push({ p, dens, clear });
  }
  for (const minClear of [24, 14, 0]) {
    const pool = cand.filter(c => c.clear >= minClear);
    if (pool.length < 3) continue;
    // first zone: closest to the map centre; then farthest-point sampling
    let first = pool[0], fd = Infinity;
    for (const c of pool) { const d = Math.hypot(c.p.x - cx, c.p.z - cz); if (d < fd) { fd = d; first = c; } }
    const picked = [first];
    while (picked.length < AUTO_COUNT) {
      let best = null, bd = -1;
      for (const c of pool) {
        let md = Infinity;
        for (const q of picked) md = Math.min(md, Math.hypot(c.p.x - q.p.x, c.p.z - q.p.z) + Math.abs(c.p.y - q.p.y) * 2);
        if (md > bd) { bd = md; best = c; }
      }
      if (!best || bd < 20) break;
      picked.push(best);
    }
    if (picked.length < 2) continue;
    picked.forEach((c, i) => {
      const z = makeZone('auto' + (i + 1), 'Zone ' + String.fromCharCode(65 + i), c.p.x, c.p.y, c.p.z, R, HILL.halfUp, HILL.halfDown);
      z.source = 'auto';
      collectNodes(z, nav);
      list.push(z);
    });
    return list;
  }
  warnOnce('could not auto-pick King of the Hill zones on ' + ((world.def && world.def.id) || 'this map'));
  return list;
}

// ----------------------------------------------------------------------------------------------------- visuals

const COL = {
  neutral: new THREE.Color(0xdfe9f5),
  1: new THREE.Color(TEAM_COLORS[TEAM_BLUE]),
  2: new THREE.Color(TEAM_COLORS[TEAM_RED]),
  contested: new THREE.Color(0xffc93d),
  next: new THREE.Color(0x9fb4c8),
};

function makeWallTexture() {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = 'rgb(70,70,70)';
  g.fillRect(0, 0, 64, 64);
  // soft rising bands and thin vertical seams: the "force field" read
  const grad = g.createLinearGradient(0, 0, 0, 64);
  grad.addColorStop(0, 'rgba(255,255,255,0)');
  grad.addColorStop(0.5, 'rgba(255,255,255,0.75)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  g.fillStyle = 'rgba(255,255,255,0.9)';
  g.fillRect(0, 0, 2, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function addMat(opts = {}) {
  return new THREE.MeshBasicMaterial({
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false, ...opts,
  });
}

/**
 * Zone list + world visuals. `setState()` is called every frame by the mode; `update()` animates.
 */
export class Zones {
  /** @param {object} game */
  constructor(game) {
    this.game = game;
    /** @type {Array} resolved zones (see resolveZones) */
    this.list = [];
    this.group = new THREE.Group();
    this.group.name = 'kothZones';
    this.group.visible = false;
    this.time = 0;
    this.state = { active: null, next: null, owner: 0, contested: false, progress: 0, warn: false };
    this._col = new THREE.Color(COL.neutral);
    this._built = false;
  }

  _build() {
    this._built = true;
    const wallGeo = new THREE.CylinderGeometry(1, 1, 1, 56, 1, true);
    wallGeo.translate(0, 0.5, 0);
    const pos = wallGeo.attributes.position;
    const cols = new Float32Array(pos.count * 4);
    for (let i = 0; i < pos.count; i++) {
      const a = pos.getY(i) < 0.5 ? 0.85 : 0;
      cols[i * 4] = cols[i * 4 + 1] = cols[i * 4 + 2] = 1;
      cols[i * 4 + 3] = a;
    }
    wallGeo.setAttribute('color', new THREE.BufferAttribute(cols, 4));
    const ringGeo = new THREE.RingGeometry(0.95, 1, 72);
    ringGeo.rotateX(-Math.PI / 2);
    const discGeo = new THREE.CircleGeometry(1, 48);
    discGeo.rotateX(-Math.PI / 2);
    this._geos = [wallGeo, ringGeo, discGeo];
    this.wallTex = makeWallTexture();
    this.wallMat = addMat({ vertexColors: true, map: this.wallTex, opacity: 0.55 });
    this.ringMat = addMat({ opacity: 0.9 });
    this.discMat = addMat({ opacity: 0.12 });
    this.nextMat = addMat({ opacity: 0.5 });
    this._mats = [this.wallMat, this.ringMat, this.discMat, this.nextMat];
    this.wall = new THREE.Mesh(wallGeo, this.wallMat);
    this.floorRing = new THREE.Mesh(ringGeo, this.ringMat);
    this.floorDisc = new THREE.Mesh(discGeo, this.discMat);
    this.nextRing = new THREE.Mesh(ringGeo, this.nextMat);
    for (const m of [this.wall, this.floorRing, this.floorDisc, this.nextRing]) {
      m.frustumCulled = false;
      m.renderOrder = 5;
      this.group.add(m);
    }
    this.nextRing.visible = false;
  }

  /**
   * Resolve the zones of the loaded world and add the visuals to the scene.
   * @returns {Array} the zone list (may be empty)
   */
  load(world) {
    this.list = resolveZones(world);
    if (!this._built) this._build();
    if (!this.group.parent) this.game.scene.add(this.group);
    this.group.visible = true;
    this.setState({ active: null, next: null, owner: 0, contested: false, progress: 0, warn: false });
    return this.list;
  }

  /** @param {{active: object|null, next: object|null, owner: number, contested: boolean, progress: number, warn: boolean}} s */
  setState(s) {
    const st = this.state;
    st.active = s.active; st.next = s.next; st.owner = s.owner | 0; st.contested = !!s.contested;
    st.progress = s.progress || 0; st.warn = !!s.warn;
  }

  update(dt) {
    if (!this._built || !this.group.visible) return;
    this.time += dt;
    const t = this.time;
    const st = this.state;
    const z = st.active;
    const showActive = !!z;
    this.wall.visible = this.floorRing.visible = this.floorDisc.visible = showActive;
    if (z) {
      const target = st.contested ? COL.contested : st.owner ? COL[st.owner] : COL.neutral;
      this._col.lerp(target, damp(9, dt));
      const pulse = 0.5 + 0.5 * Math.sin(t * (st.contested ? 9 : 2.6));
      const warnFlash = st.warn ? 0.5 + 0.5 * Math.sin(t * 10) : 1;
      this.wall.position.set(z.pos.x, z.pos.y, z.pos.z);
      this.wall.scale.set(z.radius, WALL_H, z.radius);
      this.floorRing.position.set(z.pos.x, z.pos.y + 0.07, z.pos.z);
      this.floorRing.scale.set(z.radius, 1, z.radius);
      this.floorDisc.position.set(z.pos.x, z.pos.y + 0.05, z.pos.z);
      this.floorDisc.scale.set(z.radius, 1, z.radius);
      this.wallMat.color.copy(this._col).multiplyScalar(0.62);
      this.ringMat.color.copy(this._col).multiplyScalar(0.78);
      this.discMat.color.copy(this._col).multiplyScalar(0.7);
      // the wall thins out when the camera is close to it (standing on the edge would otherwise wash the view)
      const cam = this.game.camera.position;
      const edge = Math.abs(Math.hypot(cam.x - z.pos.x, cam.z - z.pos.z) - z.radius);
      const near = 0.3 + 0.7 * Math.min(1, edge / 4);
      this.wallMat.opacity = (0.46 + 0.1 * pulse) * (st.warn ? 0.55 + 0.45 * warnFlash : 1) * near;
      this.ringMat.opacity = 0.62 + 0.28 * pulse;
      this.discMat.opacity = 0.07 + 0.2 * st.progress + 0.03 * pulse;
      const tex = this.wallTex;
      tex.repeat.set(Math.max(4, Math.round(z.radius * 2.2)), 2.5);
      tex.offset.y = (tex.offset.y - dt * 0.35) % 1;
    }
    const nz = st.next;
    this.nextRing.visible = !!nz;
    if (nz) {
      const pulse = 0.5 + 0.5 * Math.sin(t * 4);
      this.nextRing.position.set(nz.pos.x, nz.pos.y + 0.07, nz.pos.z);
      this.nextRing.scale.set(nz.radius, 1, nz.radius);
      this.nextMat.color.copy(COL.next).multiplyScalar(0.55);
      this.nextMat.opacity = 0.32 + 0.4 * pulse;
    }
  }

  /** Remove the visuals and forget the zones (end of match). */
  clear() {
    this.list = [];
    this.state.active = this.state.next = null;
    this.group.visible = false;
    if (this.group.parent) this.group.parent.remove(this.group);
  }

  dispose() {
    this.clear();
    if (this._geos) for (const g of this._geos) g.dispose();
    if (this._mats) for (const m of this._mats) m.dispose();
    if (this.wallTex) this.wallTex.dispose();
    this._built = false;
  }
}
