import * as THREE from 'three';
import { Capsule } from 'three/addons/math/Capsule.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CollisionWorld, BLOCK_SHOTS } from './Collision.js';
import { initTextures, preloadMaterials } from './Textures.js';
import { MapBuilder } from './MapBuilder.js';
import { Pickups } from './Pickups.js';
import { NavGraph } from './NavGraph.js';
import { createSky, createEnvironment, normalizeSky } from './Sky.js';
import { Storm } from './Storm.js';
import { GRAVITY } from '../core/constants.js';
import { toColor, yawFromDirection } from '../core/utils.js';

/**
 * World: owns everything map related. load(def) builds the merged render meshes + collision
 * (MapBuilder), sky dome + PMREM environment (Sky), sun with a fitted shadow camera, hemisphere and
 * point lights, fog, pickups (Pickups), jump pads, the bot navigation graph (NavGraph) and validates
 * the map. See ARCHITECTURE.md 6.2 / 6.3.
 */

// ---------------------------------------------------------------------------------------------
// Diffused point lights
// ---------------------------------------------------------------------------------------------

/**
 * three.js attenuates point lights with 1 / d^decay, which is unbounded next to the light: a lamp, a bullet
 * flash or an explosion lights the surface right beside it into a searing hotspot. Give every point light a
 * soft core, 1 / (d^decay + LIGHT_CORE) - as if it were a frosted globe about a metre across. Beyond a few
 * metres the falloff is unchanged (at 5 m it is 3 % weaker), so map lighting keeps its balance.
 * Runs once at module load, i.e. before any shader program is compiled.
 */
const LIGHT_CORE = 0.8;
(function softenPointLights() {
  const chunk = THREE.ShaderChunk.lights_pars_begin;
  const from = 'float distanceFalloff = 1.0 / max( pow( lightDistance, decayExponent ), 0.01 );';
  if (typeof chunk !== 'string' || chunk.includes('LIGHT_CORE')) return;
  const patched = chunk.replace(from, `float distanceFalloff = 1.0 / ( pow( lightDistance, decayExponent ) + ${LIGHT_CORE.toFixed(2)} ); // LIGHT_CORE`);
  if (patched === chunk) {
    console.warn('[world] point light falloff chunk not recognised; lights keep the default hard 1/d^2 falloff');
    return;
  }
  THREE.ShaderChunk.lights_pars_begin = patched;
}());

const PAD_RADIUS = 1.1;
const PAD_VERTICAL = 0.7;
const PAD_COOLDOWN = 0.5;
const PAD_COLOR = 0x3dffb0;
const HALF_PI = Math.PI / 2;

const _launch = new THREE.Vector3();
const _origin = new THREE.Vector3();
const _down = new THREE.Vector3(0, -1, 0);
const _dirv = new THREE.Vector3();
const _padColor = new THREE.Color();

const yieldFrame = () => new Promise(resolve => {
  let done = false;
  const go = () => { if (!done) { done = true; resolve(); } };
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(go);
  setTimeout(go, 40);
});

let PAD_ASSETS = null;
function padAssets() {
  if (PAD_ASSETS) return PAD_ASSETS;
  const chev = new THREE.Shape();
  chev.moveTo(0, 0.42);
  chev.lineTo(0.55, -0.02);
  chev.lineTo(0.55, -0.24);
  chev.lineTo(0, 0.2);
  chev.lineTo(-0.55, -0.24);
  chev.lineTo(-0.55, -0.02);
  chev.closePath();
  const chevron = new THREE.ShapeGeometry(chev);
  chevron.rotateX(-HALF_PI);
  const beam = new THREE.CylinderGeometry(0.62, 0.9, 3.2, 20, 1, true);
  beam.translate(0, 1.6, 0);
  const pos = beam.attributes.position;
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const k = Math.pow(Math.max(0, 1 - pos.getY(i) / 3.2), 1.8);
    col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = k;
  }
  beam.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const tint = (geo, hex) => {
    const c = new THREE.Color(hex);
    const arr = new Float32Array(geo.attributes.position.count * 3);
    for (let i = 0; i < arr.length; i += 3) { arr[i] = c.r; arr[i + 1] = c.g; arr[i + 2] = c.b; }
    geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    return geo;
  };
  const base = tint(new THREE.CylinderGeometry(1.25, 1.35, 0.14, 28).translate(0, 0.07, 0), 0x1b222b);
  const top = tint(new THREE.CylinderGeometry(1.05, 1.1, 0.04, 28).translate(0, 0.15, 0), 0x0d1a1a);
  const additive = { transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false };
  PAD_ASSETS = {
    base: mergeGeometries([base, top], false),
    ring: new THREE.TorusGeometry(1.0, 0.055, 6, 40).rotateX(HALF_PI).translate(0, 0.19, 0),
    disc: new THREE.CircleGeometry(0.98, 28).rotateX(-HALF_PI).translate(0, 0.175, 0),
    chevron,
    beam,
    baseMat: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, metalness: 0.8 }),
    ringMat: new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }),
    discMat: new THREE.MeshBasicMaterial({ color: 0xffffff, ...additive }),
    chevMat: new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide, ...additive }),
    beamMat: new THREE.MeshBasicMaterial({ color: 0xffffff, vertexColors: true, side: THREE.FrontSide, ...additive }),
  };
  return PAD_ASSETS;
}

/** Ballistic launch velocity: arc peaks `apex` m above the higher end and lands on `to`. */
export function ballisticVelocity(from, to, apex = 3, out = new THREE.Vector3()) {
  const g = GRAVITY;
  const top = Math.max(from.y, to.y) + Math.max(0.2, apex);
  const vy = Math.sqrt(2 * g * (top - from.y));
  const t1 = vy / g;
  const t2 = Math.sqrt(2 * Math.max(0.01, top - to.y) / g);
  const T = t1 + t2;
  return out.set((to.x - from.x) / T, vy, (to.z - from.z) / T);
}

export class World {
  constructor(game) {
    this.game = game;
    /** Group holding everything map-owned (removed + disposed by unload()). */
    this.group = null;
    this.collision = new CollisionWorld();
    this.def = null;
    this.mapId = null;
    this.bounds = new THREE.Box3(new THREE.Vector3(-40, -2, -40), new THREE.Vector3(40, 30, 40));
    this.killY = -30;
    this.spawnPoints = [];
    this.jumpPads = [];
    this.warnings = [];
    this.pickups = new Pickups(this);
    this.nav = NavGraph.empty();
    this.lighting = null;
    /** Build statistics of the last load (draw calls, triangles, timings). */
    this.stats = null;

    this.sun = null;
    this.hemi = null;
    this.pointLights = [];
    this.sky = null;
    this.storm = null;
    this.env = null;
    this.pmrem = null;
    this._padGroup = null;
    this._padMeshes = null;
    this._solidsGroup = null;
    this._padCool = new WeakMap();
    this._shadowFit = null;
    this._warnedMaps = new Set();
    this._time = 0;
  }

  /** Initialise textures and the PMREM generator. */
  async init() {
    initTextures(this.game.renderer);
    this.pmrem = new THREE.PMREMGenerator(this.game.renderer);
  }

  // ==================================================================== load

  /**
   * Build a map definition (replaces any previous map).
   * @param {object} def map definition (ARCHITECTURE.md 6.3)
   * @param {{onProgress?:(fraction:number,label?:string)=>void}} [opts]
   */
  async load(def, { onProgress } = {}) {
    const prog = (f, label) => { if (onProgress) onProgress(Math.min(1, f), label); };
    this.unload();
    if (!this.pmrem) this.pmrem = new THREE.PMREMGenerator(this.game.renderer);
    const warnings = (this.warnings = []);
    const warn = msg => warnings.push(msg);
    const t0 = performance.now();

    this.def = def;
    this.mapId = def.id;
    const scene = this.game.scene;
    const group = (this.group = new THREE.Group());
    group.name = `map:${def.id}`;
    scene.add(group);

    // bounds / kill plane
    const b = def.bounds;
    if (b && Array.isArray(b.min) && Array.isArray(b.max)) {
      this.bounds = new THREE.Box3(new THREE.Vector3(...b.min), new THREE.Vector3(...b.max));
    } else {
      warn('def.bounds missing: using the geometry bounds');
      this.bounds = null;
    }

    // ---- geometry + collision
    prog(0.02, 'Building geometry');
    await yieldFrame();
    this.collision = new CollisionWorld();
    const builder = new MapBuilder(def, this.collision, warn);
    builder.buildGeometry();
    const tGeo = performance.now();

    prog(0.12, 'Generating textures');
    await yieldFrame();
    await preloadMaterials(builder.materialNames, f => prog(0.12 + f * 0.36, 'Generating textures'));
    this._solidsGroup = builder.createMeshes();
    group.add(this._solidsGroup);
    this.collision.build();
    const tMat = performance.now();

    if (!this.bounds) {
      this.bounds = builder.geoBounds.isEmpty()
        ? new THREE.Box3(new THREE.Vector3(-40, -2, -40), new THREE.Vector3(40, 30, 40))
        : builder.geoBounds.clone().expandByScalar(2);
    }
    this.killY = Number.isFinite(def.killY) ? def.killY : this.bounds.min.y - 15;

    // ---- lighting, sky, environment
    prog(0.52, 'Lighting');
    await yieldFrame();
    this._buildLighting(def.theme || {}, builder.geoBounds);
    const tLight = performance.now();

    // ---- spawns / pickups / jump pads
    prog(0.62, 'Placing items');
    const tItems0 = performance.now();
    this._buildSpawns(def, warn);
    this._buildJumpPads(def, warn);
    const pickupDefs = (def.pickups || []).map(p => ({ ...p, pos: p && Array.isArray(p.pos) ? this._snapToFloor(p.pos, `pickup (${p.type})`, warn) : p && p.pos }));
    await this.pickups.build(pickupDefs, warn);
    if (this.pickups.group) group.add(this.pickups.group);
    if (this._padGroup) group.add(this._padGroup);
    if (def.fx) this.storm = new Storm(this, def.fx);   // weather / spinners (Stratos)

    // ---- navigation
    const tItems1 = performance.now();
    prog(0.72, 'Building navigation');
    await yieldFrame();
    const tNav0 = performance.now();
    this.nav = NavGraph.build(builder.getNavTriangles(), this.bounds, {
      mapId: def.id, def, jumpPads: this.jumpPads, flags: builder.getNavFlags(),
      inside: (x, y, z) => this.collision.isInsideXYZ(x, y, z, 3),
    });
    const tNav = performance.now();

    // ---- validation
    this._validate(def, builder, warn);
    if (warnings.length && !this._warnedMaps.has(def.id)) {
      this._warnedMaps.add(def.id);
      console.warn(`[world] map '${def.id}' has ${warnings.length} warning(s):\n - ${warnings.join('\n - ')}`);
    }

    this.applyQuality(this.game.quality || { shadows: true, shadowMapSize: 2048 });
    this.stats = {
      ...builder.stats,
      navNodes: this.nav.stats.nodes,
      navBuildMs: this.nav.stats.buildMs,
      geometryMs: Math.round(tGeo - t0),
      textureMs: Math.round(tMat - tGeo),
      lightingMs: Math.round(tLight - tMat),
      itemsMs: Math.round(tItems1 - tItems0),
      navMs: Math.round(tNav - tNav0),
      totalMs: Math.round(performance.now() - t0),
    };
    prog(1, 'Ready');
  }

  // ==================================================================== lighting

  _buildLighting(theme, geoBounds) {
    const game = this.game, scene = game.scene, group = this.group;
    const sunT = theme.sun || {};
    const hemiT = theme.hemi || {};
    const sunDir = new THREE.Vector3(...(Array.isArray(sunT.dir) ? sunT.dir : [-0.5, 0.7, 0.35])).normalize();
    const sunColor = toColor(sunT.color ?? '#fff1d9');
    const sunIntensity = sunT.intensity ?? 2.4;
    const skyP = normalizeSky(theme.sky);

    // fog
    const fogT = theme.fog;
    const fogColor = toColor(fogT && fogT.color != null ? fogT.color : skyP.horizon);
    if (fogT && Number.isFinite(fogT.density)) scene.fog = new THREE.FogExp2(fogColor.getHex(), fogT.density);
    else if (fogT && Number.isFinite(fogT.near)) scene.fog = new THREE.Fog(fogColor.getHex(), fogT.near, fogT.far ?? fogT.near + 150);
    else if (fogT === null || fogT === false) scene.fog = null;
    else scene.fog = new THREE.Fog(fogColor.getHex(), 70, 300);

    // sky dome + environment
    const cam = game.camera;
    const radius = Math.max(60, Math.min(600, (cam && cam.far ? cam.far : 700) * 0.8));
    const fogBlend = scene.fog ? 0.7 : 0.0;
    this.sky = createSky(theme.sky, sunDir, fogColor, radius, fogBlend, !!(game.quality && game.quality.name === 'low'));
    group.add(this.sky.mesh);
    scene.background = skyP.horizon.clone();
    this.env = createEnvironment(this.pmrem, theme.sky, sunDir, scene.fog ? fogColor : skyP.horizon);
    scene.environment = this.env.texture;
    const envIntensity = theme.envIntensity ?? 0.7;
    scene.environmentIntensity = envIntensity;

    // hemisphere
    const hemiSky = toColor(hemiT.sky ?? skyP.top.clone().lerp(skyP.horizon, 0.5));
    const hemiGround = toColor(hemiT.ground ?? '#3a3128');
    const hemiIntensity = hemiT.intensity ?? 0.6;
    this.hemi = new THREE.HemisphereLight(hemiSky, hemiGround, hemiIntensity);
    group.add(this.hemi);

    // sun
    const sun = (this.sun = new THREE.DirectionalLight(sunColor, sunIntensity));
    sun.castShadow = true;
    group.add(sun, sun.target);
    this._fitShadow(sunDir, geoBounds);

    // point lights (fixed count for this map, no shadows)
    this.pointLights = [];
    const lights = Array.isArray(this.def.lights) ? this.def.lights : [];
    if (lights.length > 4) this.warnings.push(`def.lights has ${lights.length} entries; only the first 4 are used`);
    for (const l of lights.slice(0, 4)) {
      if (!l || !Array.isArray(l.pos)) continue;
      const pl = new THREE.PointLight(toColor(l.color ?? '#ffffff'), l.intensity ?? 30, l.distance ?? 25, l.decay ?? 2);
      pl.position.set(l.pos[0], l.pos[1], l.pos[2]);
      group.add(pl);
      this.pointLights.push(pl);
    }

    const bl = theme.bloom || {};
    this.lighting = {
      sunDirection: sunDir,
      sunColor: sunColor.clone(),
      sunIntensity,
      hemiSky: hemiSky.clone(),
      hemiGround: hemiGround.clone(),
      hemiIntensity,
      envIntensity,
      exposure: theme.exposure ?? 1,
      // strength is scaled by the player's Glow setting in Game._applyBloomSettings (see Game._setupComposer for what
      // strength / radius / threshold / knee mean: strength 1 adds the above-threshold energy back once)
      bloom: { strength: bl.strength ?? 1.8, radius: bl.radius ?? 0.85, threshold: bl.threshold ?? 0.6, knee: bl.knee ?? 0.3 },
    };
  }

  /** Fit the sun's orthographic shadow camera tightly around the visible geometry. */
  _fitShadow(sunDir, geoBounds) {
    const sun = this.sun;
    let box = new THREE.Box3();
    if (geoBounds && !geoBounds.isEmpty()) {
      box.copy(geoBounds);
      const lim = this.bounds.clone().expandByScalar(6);
      box.intersect(lim);
      if (box.isEmpty()) box.copy(this.bounds);
    } else {
      box.copy(this.bounds);
    }
    const f = sunDir.clone().negate();                       // direction light travels
    const upRef = Math.abs(f.y) > 0.98 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
    const right = new THREE.Vector3().crossVectors(f, upRef).normalize();
    const up = new THREE.Vector3().crossVectors(right, f).normalize();
    const center = box.getCenter(new THREE.Vector3());
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
    const d = new THREE.Vector3();
    for (let i = 0; i < 8; i++) {
      d.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z).sub(center);
      const x = d.dot(right), y = d.dot(up), z = d.dot(f);
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
      if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
    }
    const pad = 1.5;
    const dist = -minZ + 8;
    sun.position.copy(center).addScaledVector(sunDir, dist);
    sun.target.position.copy(center);
    sun.target.updateMatrixWorld();
    const cam = sun.shadow.camera;
    cam.left = minX - pad; cam.right = maxX + pad;
    cam.bottom = minY - pad; cam.top = maxY + pad;
    cam.near = 1;
    cam.far = dist + maxZ + 10;
    cam.updateProjectionMatrix();
    this._shadowFit = { extent: Math.max(cam.right - cam.left, cam.top - cam.bottom), range: cam.far - cam.near };
    this._applyShadowBias();
  }

  _applyShadowBias() {
    const sun = this.sun, fit = this._shadowFit;
    if (!sun || !fit) return;
    const size = sun.shadow.mapSize.x || 2048;
    const texel = fit.extent / size;
    sun.shadow.normalBias = THREE.MathUtils.clamp(texel * 1.7, 0.02, 0.16);
    sun.shadow.bias = -Math.max(0.03, texel * 0.5) / fit.range;
  }

  /**
   * Apply a quality preset (shadow toggle + resolution).
   * @param {{shadows:boolean, shadowMapSize:number}} q
   */
  applyQuality(q) {
    const sun = this.sun;
    if (!sun || !q) return;
    if (this.sky && this.sky.setLow) this.sky.setLow(q.name === 'low');
    sun.castShadow = !!q.shadows;
    const size = q.shadowMapSize || 2048;
    if (sun.shadow.mapSize.x !== size) {
      sun.shadow.mapSize.set(size, size);
      if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
    }
    this._applyShadowBias();
  }

  // ==================================================================== spawns / floors

  /** Nearest floor under (x, y, z): snaps y when the floor is within reach. Returns floor y or null. */
  _floorY(x, y, z) {
    _origin.set(x, y + 1.2, z);
    const hit = this.collision.raycast(_origin, _down, 5);
    if (!hit || hit.normal.y < 0.6) return null;
    return hit.point.y;
  }

  _snapToFloor(pos, what, warn) {
    const [x, y, z] = pos;
    const fy = this._floorY(x, y, z);
    if (fy === null) {
      warn(`${what} at [${x}, ${y}, ${z}] has no floor within 4 m below it`);
      return pos;
    }
    if (Math.abs(fy - y) > 0.25) warn(`${what} at [${x}, ${y}, ${z}]: floor is at y=${fy.toFixed(2)} (snapped)`);
    return [x, fy, z];
  }

  /**
   * First free standing spot above a buried spawn (feet y), settled back down onto the surface it was buried in;
   * null when there is none within 12 m. (The floor-snap raycast is not used: from above it can pass back down
   * through the very geometry the spawn was buried in.)
   */
  _liftSpawn(p, cap) {
    const coll = this.collision;
    const place = y => {
      cap.start.set(p[0], y + 0.45, p[2]);
      cap.end.set(p[0], y + 1.4, p[2]);
    };
    // both sphere centres AND the middle of the body must be in open air (a thin slab can sit between the centres)
    const buried = () => coll.capsuleInside(cap, 12) || coll.isInsideXYZ(cap.start.x, (cap.start.y + cap.end.y) * 0.5, cap.start.z, 12);
    for (let k = 1; k <= 48; k++) {
      place(p[1] + k * 0.25);
      coll.resolveCapsule(cap);            // a capsule straddling a face is popped out through it
      if (buried()) continue;
      let y = cap.start.y - 0.45;          // resolved feet height
      // settle down in 5 cm steps until something would touch the capsule
      for (let j = 0; j < 5; j++) {
        place(y - 0.05);
        if (coll.resolveCapsule(cap).count > 0 || buried()) break;
        y -= 0.05;
      }
      return y;
    }
    return null;
  }

  _buildSpawns(def, warn) {
    this.spawnPoints = [];
    const list = Array.isArray(def.spawns) ? def.spawns : [];
    if (list.length < 8) warn(`only ${list.length} spawn point(s): 14-18 recommended`);
    const cap = new Capsule(new THREE.Vector3(), new THREE.Vector3(), 0.4);
    list.forEach((sp, i) => {
      if (!sp || !Array.isArray(sp.pos) || sp.pos.length < 3 || sp.pos.some(v => !Number.isFinite(v))) { warn(`spawn #${i}: 'pos' must be [x,y,z]`); return; }
      let p = this._snapToFloor(sp.pos, `spawn #${i}`, warn);
      let yaw = Number.isFinite(sp.yaw) ? sp.yaw : 0;
      if (Array.isArray(sp.lookAt)) yaw = yawFromDirection(sp.lookAt[0] - p[0], sp.lookAt[2] - p[2]);
      cap.start.set(p[0], p[1] + 0.45, p[2]);
      cap.end.set(p[0], p[1] + 1.4, p[2]);
      const hit = this.collision.capsuleIntersect(cap);
      // A capsule buried in a closed solid gets NO push-out (depth 0), so the depth test alone cannot see it. Resolve
      // first: a capsule that merely overlaps a wall (or sits exactly on its face, where "inside" is ambiguous) is pushed
      // out by the normal collision; only one that is STILL inside afterwards is buried.
      this.collision.resolveCapsule(cap);
      if (this.collision.capsuleInside(cap, 12)) {
        // an entity spawned inside a solid gets no push-out and walks around inside the geometry: relocate the spawn to
        // the first free spot above (the roof of whatever it is buried in) and tell the map author
        const y = this._liftSpawn(p, cap);
        if (y === null) warn(`spawn #${i} at [${p.map(v => +v.toFixed(1))}] is INSIDE a solid and could not be lifted out`);
        else {
          warn(`spawn #${i} at [${p.map(v => +v.toFixed(1))}] is INSIDE a solid: moved up to y=${y.toFixed(2)}`);
          p = [p[0], y, p[2]];
        }
      } else if (hit && hit.depth > 0.12) warn(`spawn #${i} at [${p.map(v => +v.toFixed(1))}] is inside or too close to solid geometry (depth ${hit.depth.toFixed(2)})`);
      this.spawnPoints.push({ position: new THREE.Vector3(p[0], p[1], p[2]), yaw });
    });
  }

  // ==================================================================== jump pads

  _buildJumpPads(def, warn) {
    this.jumpPads = [];
    this._padCool = new WeakMap();
    this._padMeshes = null;
    const list = Array.isArray(def.jumpPads) ? def.jumpPads : [];
    list.forEach((jp, i) => {
      if (!jp || !Array.isArray(jp.pos) || jp.pos.some(v => !Number.isFinite(v))) { warn(`jumpPad #${i}: 'pos' must be [x,y,z]`); return; }
      const pos = new THREE.Vector3(jp.pos[0], jp.pos[1], jp.pos[2]);
      const fy = this._floorY(pos.x, pos.y, pos.z);
      if (fy === null) warn(`jumpPad #${i} at [${jp.pos}] has no floor below it`);
      else pos.y = fy;
      if (this.collision.isInsideXYZ(pos.x, pos.y + 0.3, pos.z)) warn(`jumpPad #${i} at [${jp.pos}] is inside a solid`);
      const velocity = new THREE.Vector3();
      let target = null;
      if (Array.isArray(jp.target)) {
        target = new THREE.Vector3(jp.target[0], jp.target[1], jp.target[2]);
        ballisticVelocity(pos, target, jp.apex ?? 3, velocity);
        if (this._floorY(target.x, target.y, target.z) === null) warn(`jumpPad #${i}: target [${jp.target}] has no floor below it`);
        this._checkArc(i, pos, target, velocity, warn);
      } else if (Array.isArray(jp.velocity)) {
        velocity.set(jp.velocity[0], jp.velocity[1], jp.velocity[2]);
        // estimate where it lands (level ground assumption) for nav links
        const tLand = (velocity.y + Math.sqrt(velocity.y * velocity.y)) / GRAVITY;
        target = new THREE.Vector3(pos.x + velocity.x * tLand, pos.y, pos.z + velocity.z * tLand);
      } else {
        warn(`jumpPad #${i}: needs 'target' [x,y,z] (+ optional 'apex') or 'velocity' [x,y,z]`);
        return;
      }
      this.jumpPads.push({ position: pos, radius: PAD_RADIUS, velocity, target, flash: 0 });
    });
    if (!this.jumpPads.length) { this._padGroup = null; return; }
    this._buildPadVisuals();
  }

  /**
   * Warn when the launch arc runs into geometry before reaching its target. The launched entity is the standing
   * capsule (r 0.4, 1.8 m, starting at the FEET), so a ledge or slab edge that a waist-height ray clears still
   * stops it: sample the capsule along the parabola (inflated by 0.1 m, because a grazing contact already kills the
   * horizontal speed). Only the last 10 % of the flight is skipped, plus up-facing hits while falling (the landing
   * surface).
   */
  _checkArc(i, pos, target, vel, warn) {
    const dy = target.y - pos.y;
    const tEnd = (vel.y + Math.sqrt(Math.max(0, vel.y * vel.y - 2 * GRAVITY * dy))) / GRAVITY;
    const cap = new Capsule(new THREE.Vector3(), new THREE.Vector3(), 0.5);
    for (let t = 0.1; t <= tEnd * 0.9; t += 0.025) {
      const x = pos.x + vel.x * t, z = pos.z + vel.z * t;
      const y = pos.y + vel.y * t - 0.5 * GRAVITY * t * t; // feet
      cap.start.set(x, y + 0.4, z);
      cap.end.set(x, y + 1.4, z);
      const hit = this.collision.capsuleIntersect(cap);
      const rising = vel.y - GRAVITY * t > 0;
      if (hit && hit.depth > 0.03 && (rising || hit.normal.y < 0.6)) {
        warn(`jumpPad #${i}: the launch arc hits geometry near [${[x, y, z].map(v => +v.toFixed(1))}] (t=${t.toFixed(2)} s)`);
        return;
      }
    }
  }

  /** All jump pads share five InstancedMeshes (base, ring, glow disc, chevrons, beam). */
  _buildPadVisuals() {
    const A = padAssets();
    const pads = this.jumpPads, n = pads.length;
    const group = (this._padGroup = new THREE.Group());
    group.name = 'jump-pads';
    const base = new THREE.InstancedMesh(A.base, A.baseMat, n);
    const ring = new THREE.InstancedMesh(A.ring, A.ringMat, n);
    const disc = new THREE.InstancedMesh(A.disc, A.discMat, n);
    const beam = new THREE.InstancedMesh(A.beam, A.beamMat, n);
    const chev = new THREE.InstancedMesh(A.chevron, A.chevMat, n * 3);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), one = new THREE.Vector3(1, 1, 1), yAxis = new THREE.Vector3(0, 1, 0);
    const p = new THREE.Vector3(), sc = new THREE.Vector3();
    pads.forEach((pad, i) => {
      m.compose(pad.position, q.identity(), one);
      base.setMatrixAt(i, m); ring.setMatrixAt(i, m); disc.setMatrixAt(i, m); beam.setMatrixAt(i, m);
      _dirv.set(pad.velocity.x, 0, pad.velocity.z);
      const yaw = _dirv.lengthSq() > 1e-4 ? yawFromDirection(_dirv.x, _dirv.z) : 0;
      q.setFromAxisAngle(yAxis, yaw);
      for (let k = 0; k < 3; k++) {
        // chevrons line up along the launch direction (local -Z after the yaw)
        p.set(0, 0.2, 0.55 - k * 0.55).applyQuaternion(q).add(pad.position);
        chev.setMatrixAt(i * 3 + k, m.compose(p, q, sc.setScalar(0.62)));
      }
      for (const im of [ring, disc, beam]) im.setColorAt(i, _padColor.setHex(PAD_COLOR));
      for (let k = 0; k < 3; k++) chev.setColorAt(i * 3 + k, _padColor.setHex(PAD_COLOR));
    });
    for (const im of [base, ring, disc, beam, chev]) { im.frustumCulled = false; im.castShadow = false; im.receiveShadow = false; group.add(im); }
    base.receiveShadow = true;
    beam.renderOrder = 5;
    this._padMeshes = { base, ring, disc, beam, chev };
    this._updatePadVisuals();
  }

  _updatePadVisuals() {
    const M = this._padMeshes;
    if (!M) return;
    const t = this._time;
    const pads = this.jumpPads;
    for (let i = 0; i < pads.length; i++) {
      const pad = pads[i];
      const boost = 1 + pad.flash * 1.2;
      M.ring.setColorAt(i, _padColor.setHex(PAD_COLOR).multiplyScalar((1.15 + 0.3 * Math.sin(t * 4)) * boost));
      M.disc.setColorAt(i, _padColor.setHex(PAD_COLOR).multiplyScalar(0.12 + 0.06 * Math.sin(t * 3) + pad.flash * 0.22));
      M.beam.setColorAt(i, _padColor.setHex(PAD_COLOR).multiplyScalar(0.26 + pad.flash * 0.35));
      for (let k = 0; k < 3; k++) {
        const ph = (t * 1.9 - k * 0.33) % 1;
        const a = Math.max(0.08, Math.pow(1 - Math.abs((ph < 0 ? ph + 1 : ph) * 2 - 1), 1.5)) * (0.7 + pad.flash);
        M.chev.setColorAt(i * 3 + k, _padColor.setHex(PAD_COLOR).multiplyScalar(1.4 * a));
      }
    }
    M.ring.instanceColor.needsUpdate = true;
    M.disc.instanceColor.needsUpdate = true;
    M.beam.instanceColor.needsUpdate = true;
    M.chev.instanceColor.needsUpdate = true;
  }

  _updatePads(dt) {
    const pads = this.jumpPads;
    if (!pads.length) return;
    const game = this.game;
    const ents = game.entities || [];
    for (const pad of pads) {
      pad.flash = Math.max(0, pad.flash - dt * 2.5);
      for (let i = 0; i < ents.length; i++) {
        const e = ents[i];
        if (!e.alive) continue;
        const dx = e.position.x - pad.position.x, dz = e.position.z - pad.position.z;
        if (dx * dx + dz * dz > pad.radius * pad.radius) continue;
        if (Math.abs(e.position.y - pad.position.y) > PAD_VERTICAL) continue;
        const last = this._padCool.get(e);
        if (last !== undefined && game.time - last < PAD_COOLDOWN && game.time >= last) continue;
        if (game.time - (e.lastLaunchTime ?? -999) < PAD_COOLDOWN && game.time >= (e.lastLaunchTime ?? -999)) continue;
        this._padCool.set(e, game.time);
        e.launch(_launch.copy(pad.velocity));
        pad.flash = 1;
        if (game.audio && game.audio.play) game.audio.play('jumppad', { position: pad.position });
      }
    }
    this._updatePadVisuals();
  }

  // ==================================================================== validation

  _validate(def, builder, warn) {
    const st = builder.stats;
    if (st.solids > 700) warn(`${st.solids} solids (budget ~700)`);
    if (st.triangles > 60000) warn(`${st.triangles} rendered triangles (budget 60k)`);
    if (st.collisionTriangles > 20000) warn(`${st.collisionTriangles} collision triangles (budget 20k)`);
    if (st.drawCalls > 48) warn(`${st.drawCalls} map draw calls (budget ~40) - use fewer distinct materials`);
    if (!this.collision.built) { warn('map has no collision geometry'); return; }
    // items must not sit inside a solid
    const coll = this.collision;
    const buried = this.pickups.list.filter(p => coll.isInsideXYZ(p.position.x, p.position.y + 0.5, p.position.z));
    if (buried.length) warn(`pickups inside a solid: ${buried.map(p => `#${p.id} (${p.type}${p.weapon ? ':' + p.weapon : ''}) at [${p.position.toArray().map(v => +v.toFixed(1))}]`).join(', ')}`);
    const nav = this.nav;
    // NavGraph drops nodes that stand inside a solid (open-bottomed pillar shafts, ...); the map author should know
    if (nav && nav.stats.removedInside) warn(`${nav.stats.removedInside} navigation node(s) were inside solids and were removed (first at [${nav.stats.removedSample[0]}]) - a solid with missing faces?`);
    if (nav && nav.nodes.length) {
      const bad = [];
      this.spawnPoints.forEach((sp, i) => {
        const n = nav.nearestNode(sp.position, 2.5);
        if (!n) bad.push(`spawn #${i}`); else if (!n.main) bad.push(`spawn #${i} (isolated area)`);
      });
      this.pickups.list.forEach(p => {
        const n = nav.nearestNode(p.position, 2.5);
        if (!n) bad.push(`pickup #${p.id} (${p.type}${p.weapon ? ':' + p.weapon : ''})`); else if (!n.main) bad.push(`pickup #${p.id} (${p.type}${p.weapon ? ':' + p.weapon : ''}, isolated area)`);
      });
      if (bad.length) warn(`bots cannot reach: ${bad.join(', ')} - add ramps/stairs (bots cannot grapple or wall-run)`);
      const s = nav.stats;
      if (s.cells > 40000) warn(`navigation grid is ${s.cells} cells (${s.buildMs} ms to build): maps larger than ~150 x 150 m load slowly`);
      if (s.traps > Math.max(30, s.nodes * 0.03)) {
        warn(`${s.traps} walkable cells are one-way traps for bots (they can drop in but not walk back out)`);
      }
    } else {
      warn('navigation graph is empty (no walkable floor found)');
    }
  }

  // ==================================================================== runtime

  /** Advance pickups, jump pads, sky. */
  update(dt) {
    if (!this.def) return;
    this._time += dt;
    if (this.sky) this.sky.update(dt);
    if (this.storm) this.storm.update(dt);
    this.pickups.update(dt);
    this._updatePads(dt);
  }

  /** Same map, new match: pickups and jump pads reset. */
  reset() {
    if (this.storm) this.storm.reset();
    this.pickups.reset();
    this._padCool = new WeakMap();
    for (const p of this.jumpPads) p.flash = 0;
  }

  /**
   * Ray against what stops bullets, projectiles and sight (BLOCK_SHOTS: e.g. railing posts and rails, not the gaps
   * between them). Movement / navigation rays use collision.raycast directly (bodies collide with BLOCK_MOVE).
   */
  raycast(origin, dir, maxDist) {
    return this.collision.raycast(origin, dir, maxDist, BLOCK_SHOTS);
  }

  /** Remove and dispose everything map-owned (shared/cached materials are not disposed). */
  unload() {
    const scene = this.game.scene;
    if (this.storm) { this.storm.dispose(); this.storm = null; }
    this.pickups.dispose();
    if (this._padMeshes) {
      for (const im of Object.values(this._padMeshes)) im.dispose();
      this._padMeshes = null;
    }
    this._padGroup = null;
    if (this.group) {
      scene.remove(this.group);
      if (this._solidsGroup) this._solidsGroup.traverse(o => { if (o.geometry) o.geometry.dispose(); });
      this._solidsGroup = null;
      this.group = null;
    }
    if (this.sun && this.sun.shadow.map) { this.sun.shadow.map.dispose(); this.sun.shadow.map = null; }
    if (this.sky) { this.sky.dispose(); this.sky = null; }
    if (this.env) {
      if (scene.environment === this.env.texture) scene.environment = null;
      this.env.dispose();
      this.env = null;
    }
    scene.background = null;
    scene.fog = null;
    if (this.nav) this.nav.dispose();
    this.nav = NavGraph.empty();
    this.collision.clear();
    this.sun = null;
    this.hemi = null;
    this.pointLights = [];
    this.jumpPads = [];
    this.spawnPoints = [];
    this.lighting = null;
    this.def = null;
    this.mapId = null;
    this.stats = null;
  }
}
