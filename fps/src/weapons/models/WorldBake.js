/**
 * Draw-call batching for the world-space weapon models (bots' guns, the in-flight rocket, the thrown grenade).
 *
 * A ModelBuilder template keeps one mesh per material (8-18 per gun), which is far more draw calls than a bot
 * at gameplay distance can justify. `bakeWorldTemplate` folds a flat template into at most three meshes that
 * share three module-level materials: vertex-coloured metal, vertex-coloured paint / polymer, and an unlit
 * vertex-coloured glow. Colour comes from the source material (its colour times the average of its map, like
 * Pickups' weapon-prop bake), the bevel highlight vertex colour is kept, and transparent decals (lens window,
 * reticle, stencil labels) are dropped because they are invisible at bot distance. The source template is left
 * untouched, so the first-person and pickup paths keep using the full-detail models.
 *
 * `foldSteelTints` is the lossless variant: the three steel tints share one texture set and differ only in
 * `material.color`, so they merge into one mesh with the tint folded into the vertex colours.
 *
 * The result has the same shape as ModelBuilder#build() and goes straight into `instantiate()`; the baked
 * materials are registered as `custom:` materials of the template. Shared materials / geometry are never disposed.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { getMaterials } from './WeaponMaterials.js';

/** Keys that read as bare / brushed metal; every other opaque key is paint, polymer, rubber or wood. */
const METAL_KEYS = new Set(['steel', 'steelDark', 'steelBlack', 'rail', 'hazard', 'brass', 'frag']);

let bakedMat = null;

function bakedMaterials() {
  if (!bakedMat) {
    bakedMat = {
      bakedMetal: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.6 }),
      bakedPaint: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.58, metalness: 0.12 }),
      bakedGlow: new THREE.MeshBasicMaterial({ vertexColors: true }),
    };
    for (const [k, m] of Object.entries(bakedMat)) m.name = k;
  }
  return bakedMat;
}

const _avgCache = new Map();
const _c = new THREE.Color();

/** Average colour (linear) of a canvas / image texture; white when it cannot be sampled. Cached per texture. */
function averageOf(t) {
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
    } catch (err) { /* non-drawable image: keep white */ }
    _avgCache.set(t.uuid, avg);
  }
  return avg;
}

/** Flat colour a material appears as from a distance (linear), written into `_c`. */
function surfaceColor(m) {
  _c.copy(m.color || _c.set(0x888888));
  if (m.map && m.map.image) _c.multiply(averageOf(m.map));
  return _c;
}

/** Flat emissive radiance of a material (linear, intensity applied), written into `_c`. */
function glowColor(m) {
  _c.copy(m.emissive);
  if (m.emissiveMap && m.emissiveMap.image) _c.multiply(averageOf(m.emissiveMap));
  return _c.multiplyScalar(m.emissiveIntensity ?? 1);
}

/** Position (+ normal, + uv) of `src` with a per-vertex colour = `base` times the source vertex colour (bevel shade). */
function colourised(src, base, withNormal, withUv = false) {
  const g = src.index ? src.toNonIndexed() : src;
  const pos = g.attributes.position, n = pos.count;
  const sc = g.attributes.color;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    col[i * 3] = base.r * (sc ? sc.getX(i) : 1);
    col[i * 3 + 1] = base.g * (sc ? sc.getY(i) : 1);
    col[i * 3 + 2] = base.b * (sc ? sc.getZ(i) : 1);
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', pos);
  if (withNormal) out.setAttribute('normal', g.attributes.normal);
  if (withUv) out.setAttribute('uv', g.attributes.uv);
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return out;
}

function finish(list) {
  const g = mergeGeometries(list, false);
  g.computeBoundingSphere();
  g.computeBoundingBox();
  return g;
}

/** The single 'body' part of a flat template, or null when the template has animated parts. */
function bodyOf(tpl) {
  const names = Object.keys(tpl.parts);
  return names.length === 1 && names[0] === 'body' ? tpl.parts.body : null;
}

/**
 * Bakes a flat world template into <= 3 meshes (metal, paint, glow). Returns the template unchanged when it
 * has animated parts.
 * @param {ReturnType<import('./ModelKit.js').ModelBuilder['build']>} tpl
 * @returns {ReturnType<import('./ModelKit.js').ModelBuilder['build']>}
 */
export function bakeWorldTemplate(tpl) {
  const body = bodyOf(tpl);
  if (!body) return tpl;
  const M = getMaterials();
  const B = bakedMaterials();
  const lists = { bakedMetal: [], bakedPaint: [], bakedGlow: [] };
  for (const { geometry, mat } of body.meshes) {
    const m = mat.startsWith('custom:') ? tpl.custom.get(mat.slice(7)) : M[mat];
    if (!m) continue;
    if (m.transparent && (m.map || m.opacity < 0.5)) continue; // lens window, reticle, stencil label
    if (m.emissive && m.emissive.getHex() !== 0) lists.bakedGlow.push(colourised(geometry, glowColor(m), false));
    else (METAL_KEYS.has(mat) ? lists.bakedMetal : lists.bakedPaint).push(colourised(geometry, surfaceColor(m), true));
  }
  const meshes = [];
  const custom = new Map();
  let tris = 0;
  for (const [key, list] of Object.entries(lists)) {
    if (!list.length) continue;
    const geometry = finish(list);
    tris += geometry.attributes.position.count / 3;
    meshes.push({ geometry, mat: 'custom:' + key });
    custom.set(key, B[key]);
  }
  return { parts: { body: { pivot: [0, 0, 0], parent: null, meshes } }, markers: tpl.markers, tris: Math.round(tris), custom };
}

/**
 * Lossless merge of the steel tints (steel / steelDark / steelBlack) into one mesh: same texture set, the tint
 * is folded into the vertex colours. Every other material keeps its own mesh, so the look is unchanged.
 * @param {ReturnType<import('./ModelKit.js').ModelBuilder['build']>} tpl
 * @returns {ReturnType<import('./ModelKit.js').ModelBuilder['build']>}
 */
export function foldSteelTints(tpl) {
  const body = bodyOf(tpl);
  if (!body) return tpl;
  const M = getMaterials();
  const steel = [];
  const meshes = [];
  for (const e of body.meshes) {
    if (e.mat !== 'steel' && e.mat !== 'steelDark' && e.mat !== 'steelBlack') { meshes.push(e); continue; }
    steel.push(colourised(e.geometry, M[e.mat].color, true, true));
  }
  if (steel.length < 2) return tpl;
  const geo = finish(steel);
  return { ...tpl, parts: { body: { ...body, meshes: [...meshes, { geometry: geo, mat: 'steel' }] } } };
}
