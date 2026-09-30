/**
 * Procedural weapon models for KINETIC (see ARCHITECTURE.md 6.6).
 *
 * createWeaponModel(id, { view }) builds a fresh object tree per call from a cached template of merged
 * geometry (shared with every other instance) and shared procedural materials.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { ModelBuilder, instantiate } from './models/ModelKit.js';
import { PISTOL, buildPistol } from './models/pistol.js';
import { RIFLE, buildRifle } from './models/rifle.js';
import { SHOTGUN, buildShotgun } from './models/shotgun.js';
import { SNIPER, buildSniper } from './models/sniper.js';
import { SMG, buildSmg } from './models/smg.js';
import { RAIL, buildRail } from './models/rail.js';
import { ROCKET, buildRocketLauncher, buildRocketProjectile, flameGeometry } from './models/rocket.js';
import { ARC, buildArc } from './models/arc.js';
import { GALE, buildGale } from './models/gale.js';
import { buildGrenade } from './models/grenade.js';
import { GRENADE_MODEL_BUILDERS } from './models/grenades.js';
import { getMaterials, preloadMaterialSets } from './models/WeaponMaterials.js';
import { bakeWorldTemplate, foldSteelTints } from './models/WorldBake.js';

const DEFS = {
  pistol: { meta: PISTOL, build: buildPistol },
  rifle: { meta: RIFLE, build: buildRifle },
  shotgun: { meta: SHOTGUN, build: buildShotgun },
  sniper: { meta: SNIPER, build: buildSniper },
  smg: { meta: SMG, build: buildSmg },
  rail: { meta: RAIL, build: buildRail },
  rocket: { meta: ROCKET, build: buildRocketLauncher },
  arc: { meta: ARC, build: buildArc },
  gale: { meta: GALE, build: buildGale },
};

const templates = new Map();
const WORLD_TRI_BUDGET = 1150;

function getTemplate(id, view, batched = false) {
  const key = id + (view ? ':view' : batched ? ':batched' : ':world');
  let tpl = templates.get(key);
  if (!tpl) {
    const def = DEFS[id];
    if (batched && !view) {
      // bots: the world template folded into <= 3 shared meshes (metal / paint / glow), decals dropped
      const baked = bakeWorldTemplate(getTemplate(id, false, false));
      tpl = { ...baked };
    } else if (view) {
      const b = new ModelBuilder({ hi: true });
      def.build(b, true);
      tpl = b.build();
    } else {
      // world model: keep bevels (lod 1) unless that busts the triangle budget, then fall back to plain (lod 0)
      let b = new ModelBuilder({ lod: 1 });
      def.build(b, false);
      tpl = b.build();
      if (tpl.tris > WORLD_TRI_BUDGET) {
        b = new ModelBuilder({ lod: 0 });
        def.build(b, false);
        tpl = b.build();
      }
    }
    tpl.meta = def.meta;
    templates.set(key, tpl);
  }
  return tpl;
}

/**
 * Creates a weapon model.
 * @param {'pistol'|'rifle'|'shotgun'|'sniper'|'rocket'|'smg'|'arc'|'rail'|'gale'} id
 * @param {{view?: boolean, batched?: boolean}} [opts] view = first-person model with arms (higher detail);
 *   batched (world models only) = draw-call friendly model for bots: <= 3 meshes on shared vertex-coloured
 *   materials, no lens / reticle / label decals. Keep the default for pickups, which bake the full model themselves.
 * @returns {{root: THREE.Group, muzzle: THREE.Object3D, sight: THREE.Object3D, ejectPort: THREE.Object3D|null,
 *   hip: THREE.Vector3, adsDistance: number, parts: Object<string, THREE.Object3D>, id: string, view: boolean, triangles: number}}
 */
export function createWeaponModel(id, { view = false, batched = false } = {}) {
  if (!DEFS[id]) throw new Error(`createWeaponModel: unknown weapon "${id}"`);
  const tpl = getTemplate(id, view, batched);
  const { root, parts, markers } = instantiate(tpl, { view });
  root.name = `weapon_${id}${view ? '_view' : ''}`;
  const m = tpl.meta;
  if (id === 'rocket' && parts.mag) parts.rocket = parts.mag; // the loaded round is both `mag` and `rocket`
  return {
    root,
    muzzle: markers.muzzle,
    sight: markers.sight,
    ejectPort: markers.ejectPort || null,
    hip: new THREE.Vector3().fromArray(m.hip),
    adsDistance: m.adsDistance,
    parts,
    id,
    view,
    triangles: tpl.tris,
  };
}

let grenadeTpl = null;
let rocketTpl = null;
const grenadeTypeTpls = {};

/**
 * Grenade model: ~0.1 m tall, origin at the centre, fuze pointing +Y. Every call returns a new object tree.
 * @param {'frag'|'vortex'|'static'|'kinetic'|'smoke'} [type='frag']
 * @returns {THREE.Group}
 */
export function createGrenadeModel(type = 'frag') {
  if (type !== 'frag' && GRENADE_MODEL_BUILDERS[type]) {
    let tpl = grenadeTypeTpls[type];
    if (!tpl) {
      const b = new ModelBuilder({ hi: true });
      GRENADE_MODEL_BUILDERS[type](b);
      tpl = grenadeTypeTpls[type] = foldSteelTints(b.build());
    }
    const { root } = instantiate(tpl, { view: false });
    root.name = 'grenade_' + type;
    return root;
  }
  if (!grenadeTpl) {
    const b = new ModelBuilder({ hi: true });
    buildGrenade(b);
    grenadeTpl = foldSteelTints(b.build()); // lossless: also serves the first-person grenade in the palm
  }
  const { root } = instantiate(grenadeTpl, { view: false });
  root.name = 'grenade';
  return root;
}

/**
 * In-flight rocket: ~0.6 m long, nose toward -Z, origin at the centre, emissive nozzle and an additive exhaust
 * flame (`root.userData.flame`, a Group of two cones behind the tail that can be scaled to flicker).
 * @returns {THREE.Group}
 */
export function createRocketModel() {
  if (!rocketTpl) {
    const b = new ModelBuilder({ hi: true });
    buildRocketProjectile(b);
    rocketTpl = bakeWorldTemplate(b.build()); // metal + paint + glow meshes instead of one per material
  }
  const { root } = instantiate(rocketTpl, { view: false });
  root.name = 'rocket';
  const M = getMaterials();
  const flame = new THREE.Group();
  flame.name = 'flame';
  flame.position.z = 0.3;
  // two additive cones + soft glow (two crossed quads along the flame axis plus a disc facing the tail):
  // merged into one mesh per material, so the whole flame is two draw calls
  const F = flameMerged();
  const cones = new THREE.Mesh(F.cones, M.flame);
  cones.frustumCulled = false;
  flame.add(cones);
  const glow = new THREE.Mesh(F.glow, M.flameGlow);
  glow.frustumCulled = false;
  flame.add(glow);
  root.add(flame);
  root.userData.flame = flame;
  return root;
}

let flameGeos = null;
function flameMerged() {
  if (!flameGeos) {
    const quad = new THREE.PlaneGeometry(0.2, 0.2).rotateY(Math.PI / 2).translate(0, 0, 0.07);
    const disc = new THREE.PlaneGeometry(0.17, 0.17).translate(0, 0, 0.04);
    flameGeos = {
      cones: mergeGeometries(flameGeometry(), false),
      glow: mergeGeometries([quad, quad.clone().rotateZ(Math.PI / 2), disc], false),
    };
  }
  return flameGeos;
}

/**
 * Optional: builds every material and model template up front, yielding to the event loop between steps so a
 * loading screen keeps animating. Calling it is never required (models build lazily on first use).
 * @returns {Promise<void>}
 */
export async function preloadWeaponModels() {
  const tick = () => new Promise(r => setTimeout(r, 0));
  await preloadMaterialSets(tick);
  getMaterials();
  await tick();
  for (const id of Object.keys(DEFS)) {
    getTemplate(id, true);
    await tick();
    getTemplate(id, false);
    await tick();
    getTemplate(id, false, true);
    await tick();
  }
  createGrenadeModel();
  for (const t of Object.keys(GRENADE_MODEL_BUILDERS)) createGrenadeModel(t);
  createRocketModel();
}
