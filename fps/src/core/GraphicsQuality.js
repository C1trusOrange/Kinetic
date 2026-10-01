// Graphics adapter detection, the 'auto' quality pick and the render-resolution rule of the quality presets.

import { QUALITY_PRESETS } from './constants.js';

/** Values of the 'quality' setting in UI order. 'auto' resolves to a preset from the detected GPU on every start. */
export const QUALITY_NAMES = ['auto', 'low', 'medium', 'high', 'ultra'];

/** Preset picked by 'auto' per GPU kind (see classifyGpu). */
const AUTO_BY_KIND = { software: 'low', integrated: 'medium', apple: 'high', discrete: 'high', unknown: 'high' };

/**
 * Sort an adapter into a performance class from its renderer string.
 * @param {string} renderer e.g. 'ANGLE (AMD, AMD Radeon(TM) 860M Graphics (0x00001114) Direct3D11 vs_5_0 ps_5_0, D3D11)'
 * @returns {'software'|'integrated'|'apple'|'discrete'|'unknown'}
 */
export function classifyGpu(renderer) {
  const r = String(renderer || '').toLowerCase();
  if (!r) return 'unknown';
  if (/swiftshader|llvmpipe|softpipe|lavapipe|basic render|software/.test(r)) return 'software';
  if (/apple m\d|apple gpu/.test(r)) return 'apple';
  if (/nvidia|geforce|quadro|\brtx\b|\bgtx\b/.test(r)) return 'discrete';
  if (/intel/.test(r)) return /arc(\(tm\))?\s+[ab]\d{3}/.test(r) ? 'discrete' : 'integrated';   // Arc A/B cards vs UHD / Iris / Xe / Arc iGPUs
  if (/radeon|\bamd\b/.test(r)) {
    if (/\brx\s?\d|\bpro\b|firepro|vega\s?(56|64)|radeon\s?vii/.test(r)) return 'discrete';
    // Ryzen APUs report 'AMD Radeon(TM) Graphics', 'Radeon 780M / 860M Graphics', 'Radeon Vega 8 Graphics'
    return /graphics|\b\d{3}m\b/.test(r) ? 'integrated' : 'discrete';
  }
  if (/adreno|mali|powervr|qualcomm|immortalis|videocore|tegra/.test(r)) return 'integrated';
  return 'unknown';
}

/** Short adapter name for the UI: 'AMD Radeon(TM) 860M Graphics' from the full ANGLE renderer string. */
export function gpuDisplayName(renderer) {
  let s = String(renderer || '');
  const m = /^ANGLE \((.*)\)$/.exec(s);
  if (m) {
    const parts = m[1].split(', ');
    s = parts.length >= 2 ? parts[1] : parts[0];
  }
  s = s.replace(/^ANGLE Metal Renderer:\s*/, '').replace(/\s*\(0x[0-9a-f]+\)/ig, '').replace(/\s+(Direct3D|D3D1|vs_\d|OpenGL ES|OpenGL \d).*$/, '').trim();
  return s || 'Unknown GPU';
}

/**
 * Identify the WebGL adapter (WEBGL_debug_renderer_info when the browser exposes it, else the masked strings).
 * @param {WebGLRenderingContext|WebGL2RenderingContext} gl
 * @returns {{renderer: string, vendor: string, name: string, kind: 'software'|'integrated'|'apple'|'discrete'|'unknown'}}
 */
export function detectGpu(gl) {
  let renderer = '';
  let vendor = '';
  try {
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    renderer = String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER) || '');
    vendor = String(gl.getParameter(ext ? ext.UNMASKED_VENDOR_WEBGL : gl.VENDOR) || '');
  } catch (err) {
    console.warn('[graphics] could not query the GPU name', err);
  }
  return { renderer, vendor, name: gpuDisplayName(renderer), kind: classifyGpu(renderer) };
}

/**
 * Preset name that 'auto' stands for on this GPU.
 * @param {{kind: string}} gpu result of detectGpu
 * @returns {'low'|'medium'|'high'}
 */
export function autoQualityName(gpu) {
  return AUTO_BY_KIND[(gpu && gpu.kind) || 'unknown'] || 'high';
}

/**
 * The preset for a 'quality' setting value ('auto' or an unknown name -> autoQualityName(gpu)).
 * @param {string} name
 * @param {{kind: string}} gpu
 * @returns {object} an entry of QUALITY_PRESETS
 */
export function resolveQuality(name, gpu) {
  return QUALITY_PRESETS[name] || QUALITY_PRESETS[autoQualityName(gpu)] || QUALITY_PRESETS.high;
}

/**
 * Whether switching between two presets changes material programs: shadows on/off changes every lit material, and
 * 'low' switches the sky to its cheaper shader. Resolution, MSAA, bloom, shadow-map size, decal and particle budgets
 * need no shader work.
 * @param {object|null} a previous preset
 * @param {object} b next preset
 * @returns {boolean}
 */
export function presetsNeedRecompile(a, b) {
  return !a || !!a.shadows !== !!b.shadows || (a.name === 'low') !== (b.name === 'low');
}

/**
 * Drawing-buffer pixel ratio for a preset: min(devicePixelRatio, maxPixelRatio), lowered so the buffer holds at most
 * maxMegapixels million pixels (0 / missing = no budget), then multiplied by the Render scale setting (0.5..1).
 * @param {{maxPixelRatio?: number, maxMegapixels?: number}} q preset
 * @param {number} dpr window.devicePixelRatio
 * @param {number} cssWidth canvas CSS width
 * @param {number} cssHeight canvas CSS height
 * @param {number} [renderScale=1]
 * @returns {number}
 */
export function presetPixelRatio(q, dpr, cssWidth, cssHeight, renderScale = 1) {
  let pr = Math.min(dpr > 0 ? dpr : 1, q.maxPixelRatio > 0 ? q.maxPixelRatio : Infinity);
  const budget = q.maxMegapixels > 0 ? q.maxMegapixels * 1e6 : Infinity;
  const css = Math.max(1, cssWidth) * Math.max(1, cssHeight);
  if (css * pr * pr > budget) pr = Math.sqrt(budget / css);
  const s = Number.isFinite(renderScale) ? Math.min(1, Math.max(0.5, renderScale)) : 1;
  return Math.max(0.25, pr * s);
}
