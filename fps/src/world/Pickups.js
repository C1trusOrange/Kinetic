import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { WEAPON_IDS } from '../core/constants.js';
import { grantCrate } from '../weapons/GrenadeTypes.js';

/**
 * Pickups: health / armor / ammo / grenades / weapon pads.
 *
 * Floating, spinning low-poly props with emissive accents on a glowing base ring plus a light beam
 * for visibility; collection (feet within 1.3 m horizontally and 1.6 m vertically), respawn timers,
 * 'pickup' events and sounds. See ARCHITECTURE.md 6.2.
 *
 * Draw-call friendly: pads, rings and beams are single InstancedMeshes for the whole map, each prop
 * kind (medkit, armor, ammo, grenades) is a merged-per-material InstancedMesh set, and weapon pads
 * merge the (shared-material) weapon model per material.
 */

const TYPES = ['health', 'armor', 'ammo', 'grenades', 'weapon'];
const SOUNDS = { health: 'pickup_health', armor: 'pickup_armor', ammo: 'pickup_ammo', grenades: 'pickup_grenade', weapon: 'pickup_weapon' };
const DEFAULT_RESPAWN = { health: 20, armor: 25, ammo: 15, grenades: 20, weapon: 25 };
const TYPE_COLOR = { health: 0x2dff7a, armor: 0x38b6ff, ammo: 0xffc233, grenades: 0xff5a3c };
const WEAPON_COLOR = { pistol: 0xc4d4e4, rifle: 0x6dff8a, shotgun: 0xffb040, sniper: 0x40d0ff, rocket: 0xff5a30, smg: 0xffc233, rail: 0xffe066, arc: 0xb47bff, gale: 0xbfeaff };
const WEAPON_LENGTH = { pistol: 0.62, rifle: 1.15, shotgun: 1.2, sniper: 1.4, rocket: 1.3, smg: 0.9, rail: 1.5, arc: 1.1, gale: 0.75 };

const COLLECT_H = 1.3;
const COLLECT_V_UP = 1.6;
const COLLECT_V_DOWN = 1.0;
const FLOAT_Y = 0.95;
const WEAPON_FLOAT_Y = 1.2;
const BIG = 1.22; // weapon pads are a bit larger

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _c = new THREE.Color();
const _yAxis = new THREE.Vector3(0, 1, 0);

let weaponModelsPromise = null;
function loadWeaponModels() {
  if (!weaponModelsPromise) {
    weaponModelsPromise = import('../weapons/WeaponModels.js').catch(err => {
      console.warn('[pickups] WeaponModels unavailable, using placeholders:', err && err.message);
      return null;
    });
  }
  return weaponModelsPromise;
}

// ---------------------------------------------------------------------- shared assets

let ASSETS = null;

function mat(color, o = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.5, metalness: 0.1, ...o });
}

function glow(color, intensity, o = {}) {
  return new THREE.MeshStandardMaterial({ color: 0x111111, emissive: new THREE.Color(color), emissiveIntensity: intensity, roughness: 0.6, ...o });
}

function shieldShape(scale = 1) {
  const s = new THREE.Shape();
  const pts = [[-0.17, 0.25], [0.17, 0.25], [0.21, 0.2], [0.21, 0.02], [0, -0.28], [-0.21, 0.02], [-0.21, 0.2]];
  pts.forEach(([x, y], i) => (i === 0 ? s.moveTo(x * scale, y * scale) : s.lineTo(x * scale, y * scale)));
  s.closePath();
  return s;
}

function beamGeometry(r0, r1, h) {
  const g = new THREE.CylinderGeometry(r1, r0, h, 16, 1, true);
  g.translate(0, h / 2, 0);
  const pos = g.attributes.position;
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const t = pos.getY(i) / h;
    const k = Math.pow(Math.max(0, 1 - t), 2.1);
    col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = k;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

function tinted(geo, hex) {
  const c = new THREE.Color(hex);
  const n = geo.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}

function assets() {
  if (ASSETS) return ASSETS;
  const A = { geo: {}, mat: {} };
  const G = A.geo, M = A.mat;

  M.white = mat(0xe7edf1, { roughness: 0.38, metalness: 0.05 });
  M.gray = mat(0x2b3138, { roughness: 0.5, metalness: 0.6 });
  M.dark = mat(0x161a1f, { roughness: 0.55, metalness: 0.7 });
  M.red = glow(0xff2a2a, 2.4);
  M.olive = mat(0x59683a, { roughness: 0.72, metalness: 0.15 });
  M.oliveDark = mat(0x3b4628, { roughness: 0.7, metalness: 0.2 });
  M.brass = mat(0xd9a441, { roughness: 0.25, metalness: 1.0 });
  M.amber = glow(0xffb020, 2.6);
  M.blueSteel = mat(0x33507c, { roughness: 0.32, metalness: 0.75 });
  M.cyan = glow(0x3de0ff, 3.0);
  M.gren = mat(0x3d4a2a, { roughness: 0.55, metalness: 0.35 });
  M.gold = mat(0xe0b040, { roughness: 0.3, metalness: 1.0 });
  M.placeholder = mat(0x8899aa, { roughness: 0.4, metalness: 0.6 });
  // weapon pads: parts are baked into vertex-coloured 'metal' and 'paint' meshes (+ the original glowing parts)
  M.wMetal = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.38, metalness: 0.85 });
  M.wPaint = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.15 });

  // pad = trim + top plate merged with vertex colours (one draw call for every pad in the map)
  const trim = tinted(new THREE.CylinderGeometry(0.6, 0.66, 0.07, 28).translate(0, 0.035, 0), 0x384250);
  const top = tinted(new THREE.CylinderGeometry(0.5, 0.56, 0.03, 28).translate(0, 0.085, 0), 0x1a2027);
  G.pad = mergeGeometries([trim, top], false);
  M.pad = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, metalness: 0.75 });
  G.ring = new THREE.RingGeometry(0.4, 0.5, 40);
  G.ring.rotateX(-Math.PI / 2);
  M.ring = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide, toneMapped: false });
  G.beam = beamGeometry(0.4, 0.26, 2.5);
  M.beam = new THREE.MeshBasicMaterial({
    color: 0xffffff, vertexColors: true, transparent: true, opacity: 0.15, blending: THREE.AdditiveBlending,
    depthWrite: false, side: THREE.FrontSide,
  });

  // medkit
  G.medBody = new RoundedBoxGeometry(0.46, 0.25, 0.3, 2, 0.045);
  G.medBase = new RoundedBoxGeometry(0.47, 0.09, 0.31, 2, 0.03);
  G.crossA = new THREE.BoxGeometry(0.2, 0.062, 0.014);
  G.crossB = new THREE.BoxGeometry(0.062, 0.2, 0.014);
  G.medHandle = new RoundedBoxGeometry(0.2, 0.035, 0.05, 1, 0.012);
  G.medPost = new THREE.BoxGeometry(0.035, 0.05, 0.05);
  G.medLatch = new THREE.BoxGeometry(0.05, 0.1, 0.02);

  // armor
  const ex = { depth: 0.05, bevelEnabled: true, bevelThickness: 0.022, bevelSize: 0.02, bevelSegments: 1, steps: 1 };
  G.shield = new THREE.ExtrudeGeometry(shieldShape(1), ex);
  G.shield.translate(0, 0, -0.025);
  G.shieldRim = new THREE.ExtrudeGeometry(shieldShape(0.72), { depth: 0.012, bevelEnabled: false });
  G.shieldEmblem = new THREE.ExtrudeGeometry(shieldShape(0.5), { depth: 0.012, bevelEnabled: false });

  // ammo
  G.ammoBody = new RoundedBoxGeometry(0.52, 0.26, 0.3, 2, 0.03);
  G.ammoLid = new THREE.BoxGeometry(0.535, 0.025, 0.315);
  G.ammoPlate = new THREE.BoxGeometry(0.3, 0.09, 0.012);
  G.ammoLatch = new THREE.BoxGeometry(0.045, 0.1, 0.03);
  G.bullet = new THREE.CylinderGeometry(0.022, 0.022, 0.1, 8);
  G.bulletTip = new THREE.ConeGeometry(0.022, 0.05, 8);
  G.bulletTip.translate(0, 0.075, 0);
  G.bulletBand = new THREE.CylinderGeometry(0.024, 0.024, 0.014, 8);

  // grenade crate
  G.grenCrate = new RoundedBoxGeometry(0.5, 0.16, 0.3, 2, 0.025);
  G.grenStripe = new THREE.BoxGeometry(0.34, 0.04, 0.012);
  G.grenade = new THREE.IcosahedronGeometry(0.078, 1);
  G.grenade.scale(1, 1.15, 1);
  G.grenCap = new THREE.CylinderGeometry(0.026, 0.03, 0.035, 8);
  G.grenSpoon = new THREE.BoxGeometry(0.014, 0.075, 0.03);
  G.grenRing = new THREE.TorusGeometry(0.03, 0.006, 5, 10);

  A.kinds = {};
  ASSETS = A;
  return A;
}

function mesh(geo, material, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, material);
  m.position.set(x, y, z);
  return m;
}

// ---------------------------------------------------------------------- prop builders (Groups centred on the origin)

function buildMedkit() {
  const A = assets(), G = A.geo, M = A.mat;
  const g = new THREE.Group();
  g.add(mesh(G.medBase, M.gray, 0, -0.085, 0));
  g.add(mesh(G.medBody, M.white, 0, 0.06, 0));
  for (const z of [0.156, -0.156]) {
    g.add(mesh(G.crossA, M.red, 0, 0.06, z));
    g.add(mesh(G.crossB, M.red, 0, 0.06, z));
  }
  g.add(mesh(G.medHandle, M.gray, 0, 0.225, 0));
  g.add(mesh(G.medPost, M.gray, -0.085, 0.205, 0));
  g.add(mesh(G.medPost, M.gray, 0.085, 0.205, 0));
  for (const x of [-0.16, 0.16]) g.add(mesh(G.medLatch, M.gray, x, 0.0, 0.155));
  g.scale.setScalar(0.95);
  g.rotation.x = 0.1;
  return g;
}

function buildArmor() {
  const A = assets(), G = A.geo, M = A.mat;
  const g = new THREE.Group();
  g.add(mesh(G.shield, M.blueSteel));
  for (const s of [1, -1]) {
    g.add(mesh(G.shieldRim, M.dark, 0, 0.0, s > 0 ? 0.046 : -0.058));
    g.add(mesh(G.shieldEmblem, M.cyan, 0, -0.005, s > 0 ? 0.056 : -0.068));
  }
  g.scale.setScalar(1.25);
  return g;
}

function buildAmmo() {
  const A = assets(), G = A.geo, M = A.mat;
  const g = new THREE.Group();
  g.add(mesh(G.ammoBody, M.olive, 0, 0, 0));
  g.add(mesh(G.ammoLid, M.oliveDark, 0, 0.09, 0));
  for (const z of [0.155, -0.155]) g.add(mesh(G.ammoPlate, M.amber, 0, -0.01, z));
  for (const x of [-0.2, 0.2]) for (const z of [0.16, -0.16]) g.add(mesh(G.ammoLatch, M.oliveDark, x, 0.03, z));
  for (let i = 0; i < 5; i++) {
    const x = -0.16 + i * 0.08;
    const z = i % 2 ? 0.045 : -0.045;
    g.add(mesh(G.bullet, M.brass, x, 0.155, z));
    g.add(mesh(G.bulletTip, M.brass, x, 0.155, z));
    g.add(mesh(G.bulletBand, M.gold, x, 0.115, z));
  }
  g.scale.setScalar(1.05);
  g.rotation.x = 0.08;
  return g;
}

function buildGrenades() {
  const A = assets(), G = A.geo, M = A.mat;
  const g = new THREE.Group();
  g.add(mesh(G.grenCrate, M.oliveDark, 0, -0.03, 0));
  for (const z of [0.155, -0.155]) g.add(mesh(G.grenStripe, M.red, 0, -0.03, z));
  for (let i = 0; i < 3; i++) {
    const x = -0.15 + i * 0.15;
    const gr = new THREE.Group();
    gr.add(mesh(G.grenade, M.gren, 0, 0, 0));
    gr.add(mesh(G.grenCap, M.gray, 0, 0.1, 0));
    gr.add(mesh(G.grenSpoon, M.gold, 0.03, 0.06, 0));
    const ring = mesh(G.grenRing, M.gold, -0.035, 0.125, 0);
    ring.rotation.y = Math.PI / 2;
    gr.add(ring);
    gr.position.set(x, 0.14, 0);
    gr.rotation.z = (i - 1) * 0.12;
    g.add(gr);
  }
  g.scale.setScalar(1.05);
  return g;
}

const KIND_BUILDERS = { health: buildMedkit, armor: buildArmor, ammo: buildAmmo, grenades: buildGrenades };

function buildPlaceholderWeapon(id) {
  const A = assets();
  const g = new THREE.Group();
  const len = WEAPON_LENGTH[id] || 0.8;
  const key = 'ph_' + id;
  if (!A.geo[key + 'a']) {
    A.geo[key + 'a'] = new THREE.BoxGeometry(0.08, 0.14, len * 0.5);
    A.geo[key + 'b'] = new THREE.BoxGeometry(0.05, 0.05, len);
  }
  g.add(mesh(A.geo[key + 'a'], A.mat.placeholder, 0, 0, 0));
  g.add(mesh(A.geo[key + 'b'], A.mat.dark, 0, 0.05, -len * 0.1));
  return g;
}

/** Signature of everything that affects how a material looks, so equal clones merge. */
function materialKey(m) {
  const hex = c => (c && c.isColor ? c.getHex() : '-');
  const id = t => (t ? t.uuid : '-');
  return [m.type, hex(m.color), hex(m.emissive), m.emissiveIntensity, m.roughness, m.metalness, id(m.map), id(m.normalMap),
    id(m.roughnessMap), id(m.metalnessMap), id(m.emissiveMap), m.vertexColors, m.transparent, m.opacity, m.side, m.envMapIntensity].join('|');
}

/**
 * Bake a static object tree into one merged geometry per distinct material.
 * Returns [{geometry, material}] or null when the tree cannot be merged safely (then use it as is).
 * The result is in the root's own (world) frame: root.matrixWorld is included.
 */
function bakeMerged(root) {
  root.updateMatrixWorld(true);
  const groups = new Map();
  let ok = true;
  root.traverse(o => {
    if (!o.isMesh || !ok) return;
    if (o.isSkinnedMesh || o.isInstancedMesh || Array.isArray(o.material) || !o.geometry || !o.geometry.attributes.position) { ok = false; return; }
    let g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
    g.applyMatrix4(o.matrixWorld);
    if (!g.attributes.normal) g.computeVertexNormals();
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    const key = materialKey(o.material);
    let entry = groups.get(key);
    if (!entry) { entry = { material: o.material, list: [] }; groups.set(key, entry); }
    entry.list.push(g);
  });
  if (!ok) { for (const e of groups.values()) e.list.forEach(g => g.dispose()); return null; }
  const out = [];
  for (const { material, list } of groups.values()) {
    const keepColor = list.every(g => g.attributes.color && g.attributes.color.itemSize === 3);
    for (const g of list) {
      for (const name of Object.keys(g.attributes)) {
        if (name === 'position' || name === 'normal' || name === 'uv' || (name === 'color' && keepColor)) continue;
        g.deleteAttribute(name);
      }
      g.clearGroups();
    }
    const merged = list.length === 1 ? list[0] : mergeGeometries(list, false);
    if (!merged) { for (const e of groups.values()) e.list.forEach(g => g.dispose()); return null; }
    if (list.length > 1) list.forEach(g => g.dispose());
    out.push({ geometry: merged, material });
  }
  return out;
}


const _avgCache = new Map();
const _mc = new THREE.Color();
/** Approximate flat colour of a material: its colour times the average of its map (when it is a canvas / image). */
function surfaceColor(m) {
  _mc.copy(m.color || _c.set(0x888888));
  const t = m.map;
  if (t && t.image) {
    let avg = _avgCache.get(t.uuid);
    if (!avg) {
      avg = new THREE.Color(1, 1, 1);
      try {
        const cv = document.createElement('canvas');
        cv.width = cv.height = 1;
        const ctx = cv.getContext('2d');
        ctx.imageSmoothingEnabled = true;
        ctx.drawImage(t.image, 0, 0, 1, 1);
        const d = ctx.getImageData(0, 0, 1, 1).data;
        avg.setRGB(d[0] / 255, d[1] / 255, d[2] / 255, THREE.SRGBColorSpace);
      } catch (err) { /* tainted or non-drawable image: keep white */ }
      _avgCache.set(t.uuid, avg);
    }
    _mc.multiply(avg);
  }
  return _mc;
}

/**
 * Bake a weapon model into a handful of meshes: every plain opaque part goes into a vertex-coloured
 * 'metal' or 'paint' mesh (chosen by the part's metalness); emissive / transparent / textured parts keep
 * their original (shared, never disposed) material and merge per signature. Returns [{geometry, material}].
 */
function bakeWeaponProp(root) {
  const A = assets();
  root.updateMatrixWorld(true);
  const groups = new Map();
  let ok = true;
  root.traverse(o => {
    if (!o.isMesh || !ok || !o.visible) return;
    if (o.isSkinnedMesh || o.isInstancedMesh || Array.isArray(o.material) || !o.geometry || !o.geometry.attributes.position) { ok = false; return; }
    const m = o.material;
    const g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
    g.applyMatrix4(o.matrixWorld);
    if (!g.attributes.normal) g.computeVertexNormals();
    g.clearGroups();
    const special = m.transparent || m.emissiveMap || (m.emissive && m.emissive.getHex() !== 0 && (m.emissiveIntensity ?? 1) > 0.25);
    let key, material, attrs;
    if (special) {
      key = materialKey(m);
      material = m;
      attrs = ['position', 'normal', 'uv'];
      if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    } else {
      key = m.metalness >= 0.5 ? 'metal' : 'paint';
      material = key === 'metal' ? A.mat.wMetal : A.mat.wPaint;
      attrs = ['position', 'normal', 'color'];
      const c = surfaceColor(m);
      const n = g.attributes.position.count;
      const arr = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
      g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    }
    for (const name of Object.keys(g.attributes)) if (!attrs.includes(name)) g.deleteAttribute(name);
    let entry = groups.get(key);
    if (!entry) { entry = { material, list: [] }; groups.set(key, entry); }
    entry.list.push(g);
  });
  const disposeAll = () => { for (const e of groups.values()) e.list.forEach(g => g.dispose()); };
  if (!ok) { disposeAll(); return null; }
  const out = [];
  for (const { material, list } of groups.values()) {
    const merged = list.length === 1 ? list[0] : mergeGeometries(list, false);
    if (!merged) { disposeAll(); return null; }
    if (list.length > 1) list.forEach(g => g.dispose());
    out.push({ geometry: merged, material });
  }
  return out;
}

/** Merged, cached parts for a prop kind (shared by every pickup of that kind). */
function kindParts(kind) {
  const A = assets();
  if (!A.kinds[kind]) {
    const g = KIND_BUILDERS[kind]();
    A.kinds[kind] = bakeMerged(g) || [];
  }
  return A.kinds[kind];
}

// ---------------------------------------------------------------------- Pickups

export class Pickups {
  /**
   * @param {import('./World.js').World} world owner (uses world.game)
   */
  constructor(world) {
    this.world = world;
    this.game = world.game;
    /** @type {Array<object>} see ARCHITECTURE.md 6.2 */
    this.list = [];
    this.group = null;
    this.time = 0;
    this._warned = new Set();
    this._kinds = new Map();
    this._ownGeo = [];
    this._pad = null;
    this._ringMesh = null;
    this._beamMesh = null;
  }

  /**
   * Build pickups from def.pickups. Async only because weapon pads load WeaponModels lazily.
   * @param {Array} defs def.pickups entries { type, pos, amount?, weapon?, respawn? }
   * @param {(msg:string)=>void} warn
   */
  async build(defs, warn = () => {}) {
    this.dispose();
    this.group = new THREE.Group();
    this.group.name = 'pickups';
    const A = assets();
    const arr = Array.isArray(defs) ? defs : [];
    let WM = null;
    if (arr.some(d => d && d.type === 'weapon')) WM = await loadWeaponModels();

    arr.forEach((d, i) => {
      if (!d || !TYPES.includes(d.type)) { warn(`pickup #${i}: unknown type '${d && d.type}' (valid: ${TYPES.join(', ')})`); return; }
      if (!Array.isArray(d.pos) || d.pos.length < 3 || d.pos.some(v => !Number.isFinite(v))) { warn(`pickup #${i} (${d.type}): 'pos' must be [x,y,z]`); return; }
      let weapon = null;
      if (d.type === 'weapon') {
        weapon = d.weapon;
        if (!WEAPON_IDS.includes(weapon)) { warn(`pickup #${i}: unknown weapon '${weapon}' (valid: ${WEAPON_IDS.join(', ')})`); return; }
      }
      const amount = d.amount ?? (d.type === 'health' ? 25 : d.type === 'armor' ? 50 : d.type === 'grenades' ? 2 : d.type === 'ammo' ? 0.5 : 1);
      const big = d.type === 'weapon';
      this.list.push({
        id: this.list.length,
        type: d.type,
        weapon,
        amount,
        /** grenade crates: pinned special type ('vortex' | 'static' | 'kinetic' | 'smoke'), else a random one is dealt */
        extra: d.type === 'grenades' ? (d.extra || null) : null,
        lastGrant: null,
        position: new THREE.Vector3(d.pos[0], d.pos[1], d.pos[2]),
        available: true,
        respawnTime: d.respawn ?? DEFAULT_RESPAWN[d.type],
        nextRespawn: 0,
        // visuals
        baseColor: new THREE.Color(big ? WEAPON_COLOR[weapon] : TYPE_COLOR[d.type]),
        phase: this.list.length * 1.7,
        pop: 1,
        floatY: big ? WEAPON_FLOAT_Y : FLOAT_Y,
        spin: big ? 1.0 : 1.4,
        propScale: d.type === 'health' && amount >= 50 ? 1.3 / 0.95 : 1,
        yaw: (this.list.length * 2.399) % (Math.PI * 2),
        slot: 0,
        holder: null,
      });
    });

    const n = this.list.length;
    if (n) {
      // pads / rings / beams: one instanced draw call each for the whole map
      const pad = new THREE.InstancedMesh(A.geo.pad, A.mat.pad, n);
      const ring = new THREE.InstancedMesh(A.geo.ring, A.mat.ring, n);
      const beam = new THREE.InstancedMesh(A.geo.beam, A.mat.beam, n);
      beam.renderOrder = 5;
      this.list.forEach((p, i) => {
        p.slot = i;
        const s = p.type === 'weapon' ? BIG : 1;
        _q.identity();
        _s.setScalar(s);
        pad.setMatrixAt(i, _m.compose(_p.set(p.position.x, p.position.y, p.position.z), _q, _s));
        ring.setMatrixAt(i, _m.compose(_p.set(p.position.x, p.position.y + 0.104, p.position.z), _q, _s));
        beam.setMatrixAt(i, _m.compose(_p.set(p.position.x, p.position.y + 0.1, p.position.z), _q, _s));
        ring.setColorAt(i, p.baseColor);
        beam.setColorAt(i, p.baseColor);
      });
      for (const m of [pad, ring, beam]) { m.frustumCulled = false; m.castShadow = false; m.receiveShadow = false; }
      ring.instanceColor.setUsage(THREE.DynamicDrawUsage);
      beam.instanceColor.setUsage(THREE.DynamicDrawUsage);
      this.group.add(pad, ring, beam);
      this._pad = pad; this._ringMesh = ring; this._beamMesh = beam;

      // props: one InstancedMesh per (kind, material)
      const byKind = new Map();
      for (const p of this.list) {
        if (p.type === 'weapon') continue;
        if (!byKind.has(p.type)) byKind.set(p.type, []);
        const l = byKind.get(p.type);
        p.slot = l.length;
        l.push(p);
      }
      for (const [kind, ps] of byKind) {
        const meshes = kindParts(kind).map(part => {
          const im = new THREE.InstancedMesh(part.geometry, part.material, ps.length);
          im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
          im.frustumCulled = false;
          this.group.add(im);
          return im;
        });
        this._kinds.set(kind, { list: ps, meshes });
      }
      // weapon pads: individual merged groups
      for (const p of this.list) {
        if (p.type !== 'weapon') continue;
        p.holder = this._buildWeaponProp(p, WM);
        this.group.add(p.holder);
      }
    }
    this._animate(0);
    return this;
  }

  _buildWeaponProp(p, WM) {
    const id = p.weapon;
    let model = null;
    if (WM && typeof WM.createWeaponModel === 'function') {
      try {
        model = WM.createWeaponModel(id, { view: false });
      } catch (err) {
        if (!this._warned.has(id)) { this._warned.add(id); console.warn(`[pickups] createWeaponModel('${id}') failed:`, err && err.message); }
      }
    }
    const src = model && model.root ? model.root : buildPlaceholderWeapon(id);
    // centre + scale to a readable size (the weapon lies along Z; the holder spins around Y)
    src.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(src);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const s = (WEAPON_LENGTH[id] || 0.9) / Math.max(size.x, size.y, size.z, 0.05);
    const wrap = new THREE.Group();
    wrap.add(src);
    src.position.sub(center);
    const scaler = new THREE.Group();
    scaler.add(wrap);
    scaler.scale.setScalar(s);
    scaler.rotation.z = 0.12;
    const holder = new THREE.Group();
    const parts = model && model.root ? bakeWeaponProp(scaler) : bakeMerged(scaler);
    if (parts && parts.length) {
      for (const part of parts) {
        this._ownGeo.push(part.geometry);
        const m = new THREE.Mesh(part.geometry, part.material);
        m.frustumCulled = false;
        holder.add(m);
      }
    } else {
      holder.add(scaler);
    }
    return holder;
  }

  /** Nearest pickup of a type ('health'|'armor'|'ammo'|'grenades'|'weapon' or falsy for any). */
  nearest(type, position, { weapon = null, availableOnly = true } = {}) {
    let best = null, bd = Infinity;
    for (const p of this.list) {
      if (type && p.type !== type) continue;
      if (weapon && p.weapon !== weapon) continue;
      if (availableOnly && !p.available) continue;
      const dx = p.position.x - position.x, dy = p.position.y - position.y, dz = p.position.z - position.z;
      const d = dx * dx + dz * dz + dy * dy * 4;
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  }

  /** Escalation switches the weapon pads off (they keep their ring but no weapon, nobody can collect them). */
  setWeaponPadsEnabled(on) {
    for (const p of this.list) {
      if (p.type !== 'weapon') continue;
      p.available = !!on;
      p.nextRespawn = on ? 0 : Infinity;
      if (on) p.pop = 0;
    }
    if (this.list.length && this._ringMesh) this._animate(0);
  }

  /** Make every pickup available again (new match). */
  reset() {
    for (const p of this.list) {
      p.available = true;
      p.nextRespawn = 0;
      p.pop = 1;
    }
    this._animate(0);
  }

  update(dt) {
    if (!this.list.length) return;
    const game = this.game;
    const now = game.time;
    const ents = game.entities || [];
    // respawns and collection are host-authoritative online (clients get availability from the host), and nobody
    // collects during the online countdown; collection uses the rules position (a RemotePlayer's latest report)
    const auth = !game.net || game.net.authority;
    const live = auth && !(game.match && game.match.phase === 'countdown');
    for (const p of this.list) {
      if (!auth) continue;
      if (!p.available && now >= p.nextRespawn) {
        p.available = true;
        p.pop = 0;
      }
      if (p.available && live && ents.length) {
        for (let k = 0; k < ents.length; k++) {
          const e = ents[k];
          if (!e.alive) continue;
          const ep = e.authPos;
          const dx = ep.x - p.position.x, dz = ep.z - p.position.z;
          if (dx * dx + dz * dz > COLLECT_H * COLLECT_H) continue;
          const dy = ep.y - p.position.y;
          if (dy > COLLECT_V_UP || dy < -COLLECT_V_DOWN) continue;
          if (this._apply(p, e)) {
            p.available = false;
            p.nextRespawn = now + p.respawnTime;
            game.events.emit('pickup', { entity: e, pickup: p });
            if (game.audio && game.audio.play) game.audio.play(SOUNDS[p.type], { position: p.position });
            break;
          }
        }
      }
    }
    this._animate(dt);
  }

  /**
   * Online client: a pickup event from the host. `nextRespawnNet` is host net ms (NET.NEVER = none), `atMs` the event's
   * host time (older snapshot availability bits never override it).
   */
  applyEvent(id, available, nextRespawnNet, atMs) {
    const p = this.list[id];
    if (!p) return;
    const net = this.game.net;
    p.eventAt = atMs;
    if (!!available !== p.available && available) p.pop = 0;
    p.available = !!available;
    p.nextRespawn = typeof nextRespawnNet === 'number' && nextRespawnNet >= 0 && net
      ? net.clock.netToLocalGame(this.game, nextRespawnNet) : available ? 0 : Infinity;
  }

  /**
   * Online client: snapshot availability bits (bit j of byte i = pickup i * 8 + j) of host time tHostMs; a pickup
   * whose last event is newer keeps the event's state.
   */
  applyNet(bits, count, tHostMs) {
    const n = Math.min(count, this.list.length);
    for (let i = 0; i < n; i++) {
      const p = this.list[i];
      if (tHostMs <= (p.eventAt || 0)) continue;
      const av = ((bits[i >> 3] >> (i & 7)) & 1) === 1;
      if (av === p.available) continue;
      if (av) { p.pop = 0; p.nextRespawn = 0; }
      p.available = av;
    }
  }

  _apply(p, e) {
    switch (p.type) {
      case 'health': return !!e.heal(p.amount);
      case 'armor': return !!e.addArmor(p.amount);
      case 'ammo': return !!e.addAmmo(null, p.amount > 1 ? Math.min(1, p.amount / 100) : p.amount);
      case 'grenades': return grantCrate(e, p);
      case 'weapon': return !!e.giveWeapon(p.weapon);
      default: return false;
    }
  }

  /** Bob / spin / pulse every pickup and upload the instance data. */
  _animate(dt) {
    this.time += dt;
    const t = this.time;
    const now = this.game.time;
    for (const p of this.list) {
      let scale = 0.0001;
      if (p.available) {
        if (p.pop < 1) p.pop = Math.min(1, p.pop + dt * 3.2);
        const k = p.pop - 1;
        scale = Math.max(0.0001, 1 + 2.70158 * k * k * k + 1.70158 * k * k); // easeOutBack
        p.yaw += dt * p.spin;
      }
      const y = p.position.y + p.floatY + Math.sin(t * 2.1 + p.phase) * 0.07;
      if (p.type === 'weapon') {
        const h = p.holder;
        h.visible = p.available;
        h.position.set(p.position.x, y, p.position.z);
        h.rotation.y = p.yaw;
        h.scale.setScalar(scale);
      } else {
        const kind = this._kinds.get(p.type);
        _q.setFromAxisAngle(_yAxis, p.yaw);
        _m.compose(_p.set(p.position.x, y, p.position.z), _q, _s.setScalar(scale * p.propScale));
        for (const im of kind.meshes) im.setMatrixAt(p.slot, _m);
      }
      // ring pulse + beam
      let pulse;
      if (p.available) pulse = 1.0 + 0.55 * (0.5 + 0.5 * Math.sin(t * 3.0 + p.phase));
      else {
        const left = Math.max(0, p.nextRespawn - now);
        pulse = left < 2 ? 0.15 + 0.5 * (0.5 + 0.5 * Math.sin(t * 12)) : 0.12;
      }
      this._ringMesh.setColorAt(p.id, _c.copy(p.baseColor).multiplyScalar(pulse));
      this._beamMesh.setColorAt(p.id, _c.copy(p.baseColor).multiplyScalar(p.available ? 1 : 0));
    }
    for (const k of this._kinds.values()) for (const im of k.meshes) im.instanceMatrix.needsUpdate = true;
    if (this._ringMesh) {
      this._ringMesh.instanceColor.needsUpdate = true;
      this._beamMesh.instanceColor.needsUpdate = true;
    }
  }

  /** Remove visuals (shared geometry/materials are never disposed; merged weapon copies are). */
  dispose() {
    if (this.group && this.group.parent) this.group.parent.remove(this.group);
    for (const im of [this._pad, this._ringMesh, this._beamMesh]) if (im) im.dispose();
    for (const k of this._kinds.values()) for (const im of k.meshes) im.dispose();
    for (const g of this._ownGeo) g.dispose();
    this._ownGeo = [];
    this._kinds.clear();
    this._pad = this._ringMesh = this._beamMesh = null;
    this.list = [];
    this.group = null;
  }
}
