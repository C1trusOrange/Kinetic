
// ------------------------------------------------------------------ public API

const _cache = new Map();
const _warned = new Set();

/** Every material name this library can build. */
export const MATERIAL_NAMES = Object.keys(DEFS);

let _renderer = null;

/** Call once with the renderer (sets the anisotropic filtering level used by all textures). */
export function initTextures(renderer) {
  if (renderer && renderer.capabilities) setMaxAnisotropy(renderer.capabilities.getMaxAnisotropy());
  _renderer = renderer || null;
}

function resolveName(name) {
  if (DEFS[name]) return name;
  if (!_warned.has(name)) {
    _warned.add(name);
    console.warn(`[Textures] unknown material '${name}', using 'dev_grid'`);
  }
  return 'dev_grid';
}

function buildMaterial(name) {
  const d = DEFS[name];
  const g = d.gen(d.size, name);
  const params = {
    map: g.map,
    normalMap: g.normalMap,
    roughnessMap: g.rm,
    roughness: 1,
    metalness: g.metalMap ? 1 : g.metalness,
    metalnessMap: g.metalMap ? g.rm : null,
  };
  if (g.emissiveMap) {
    params.emissive = new THREE.Color(0xffffff);
    params.emissiveMap = g.emissiveMap;
  }
  if (g.alphaMap) {
    params.alphaMap = g.alphaMap;
    params.alphaTest = 0.4;
  }
  if (g.props) Object.assign(params, g.props);
  const mat = new THREE.MeshStandardMaterial(params);
  mat.name = name;
  mat.userData.surface = d.surface;
  mat.userData.scale = d.scale;
  return mat;
}

/**
 * Shared, cached MeshStandardMaterial for a material name (generated on first use).
 * Unknown names warn once and return the 'dev_grid' fallback. Never dispose the result.
 * @param {string} name
 * @returns {THREE.MeshStandardMaterial}
 */
export function getMaterial(name) {
  const key = resolveName(name);
  let m = _cache.get(key);
  if (!m) {
    m = buildMaterial(key);
    _cache.set(key, m);
  }
  return m;
}

/**
 * Static info about a material: physical size of one texture repeat, gameplay surface type,
 * and whether it is a self-illuminated (light-emitting) material.
 * @param {string} name
 * @returns {{surface: string, scale: number, emissive: boolean}}
 */
export function getMaterialInfo(name) {
  const d = DEFS[DEFS[name] ? name : 'dev_grid'];
  return { surface: d.surface, scale: d.scale, emissive: d.emissive };
}

const TEX_SLOTS = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'alphaMap'];

/** Upload a material's textures to the GPU now (avoids a hitch on the first frame that uses it). */
function uploadTextures(mat) {
  if (!_renderer || typeof _renderer.initTexture !== 'function') return;
  try {
    const seen = new Set();
    for (const k of TEX_SLOTS) {
      const t = mat[k];
      if (t && !seen.has(t)) { seen.add(t); _renderer.initTexture(t); }
    }
  } catch (err) {
    if (!_warned.has('upload')) { _warned.add('upload'); console.warn('[Textures] GPU pre-upload failed:', err); }
  }
}

const yieldFrame = () => new Promise(res => {
  let done = false;
  const f = () => { if (!done) { done = true; res(); } };
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(f);
  setTimeout(f, 40);
});

/**
 * Generate materials ahead of time, yielding to the browser between materials so a loading
 * screen keeps animating.
 * @param {string[]} names
 * @param {(fraction: number) => void} [onProgress]
 */
export async function preloadMaterials(names = MATERIAL_NAMES, onProgress) {
  const list = [...new Set(names)];
  const n = list.length;
  if (!n) { if (onProgress) onProgress(1); return; }
  let last = performance.now();
  for (let i = 0; i < n; i++) {
    uploadTextures(getMaterial(list[i]));
    if (onProgress) onProgress((i + 1) / n);
    // yield once ~a frame of work has accumulated (cheap materials are batched)
    if (performance.now() - last >= 24) {
      await yieldFrame();
      last = performance.now();
    }
  }
}
