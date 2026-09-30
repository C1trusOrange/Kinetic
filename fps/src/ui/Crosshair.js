// Custom crosshair: settings defaults + validation, share codes, the per-weapon aim-down-sights (ADS) behaviour and
// whole-device-pixel rendering shared by the HUD crosshair and the menu preview (src/ui/CrosshairScreen.js).
//
// Settings keys (flat, stored with the other settings; see DEFAULT_SETTINGS in core/Settings.js):
//   xhStyle 'cross'|'tee'|'circle'|'dot', xhColor '#rrggbb', xhSize (tick length), xhThickness, xhGap (minimum gap),
//   xhDot (centre dot on/off), xhDotSize, xhOutline (0 = none), xhOpacity (0.2..1), xhDynamic (gap follows the spread),
//   xhWeaponStyles (weapon reticles: shotgun pellet ring, Javelin charge ring, Hammer / Tempest rings, Gale brackets),
//   xhAds { weaponId: 'hide'|'fade'|'show' } (what the crosshair does while aiming down sights).
// Lengths are pixels at 1080p: xhSize, xhThickness and xhDotSize scale with the HUD (like every other HUD element),
// xhGap and xhOutline are CSS pixels (the spread gap is measured in CSS pixels too). Everything is rounded to whole
// device pixels, so lines stay crisp at any devicePixelRatio (Windows 125% / 150% scaling).
//
// No DOM access at import time: core/Settings.js imports the validators.

import { WEAPON_IDS } from '../core/constants.js';

/** Crosshair shapes (the seg in the Crosshair screen passes these strings). */
export const XH_STYLES = ['cross', 'tee', 'circle', 'dot'];
/** What the crosshair does while aiming down sights. */
export const XH_ADS_MODES = ['hide', 'fade', 'show'];

/**
 * Recommended ADS behaviour: hide it for every weapon whose sight is aligned with the true aim point (holo / iron /
 * scope), keep today's faint fade on the shotgun, whose ring shows the real pellet cone.
 */
export const DEFAULT_XH_ADS = Object.freeze({
  pistol: 'hide', rifle: 'hide', shotgun: 'fade', sniper: 'hide', rocket: 'hide', smg: 'hide', arc: 'hide', rail: 'hide', gale: 'hide',
});
/** ADS behaviour of a weapon id that has no entry above (weapons added later: keep the old faint fade). */
const ADS_FALLBACK = 'fade';

/** One-click ADS presets for the Crosshair screen. `modes` null = the recommended table. */
export const XH_ADS_PRESETS = Object.freeze([
  { id: 'recommended', name: 'Recommended', info: 'Hide where the sight works', mode: null },
  { id: 'hide', name: 'Always hide', info: 'Aim with the gun sights', mode: 'hide' },
  { id: 'fade', name: 'Classic fade', info: 'Faint crosshair (old look)', mode: 'fade' },
  { id: 'show', name: 'Always show', info: 'Crosshair stays on', mode: 'show' },
]);

/** Numeric keys: [min, max, step]. */
export const XH_RANGES = Object.freeze({
  xhSize: [2, 30, 1],
  xhThickness: [1, 8, 1],
  xhGap: [0, 20, 1],
  xhDotSize: [2, 10, 1],
  xhOutline: [0, 3, 1],
  xhOpacity: [0.2, 1, 0.05],
});

/** Defaults: reproduce the original hip-fire crosshair (white cross + dot, dynamic gap, 1 px dark outline). */
export const XH_DEFAULTS = Object.freeze({
  xhStyle: 'cross',
  xhColor: '#ffffff',
  xhSize: 12,
  xhThickness: 3,
  xhGap: 3,
  xhDot: true,
  xhDotSize: 4,
  xhOutline: 1,
  xhOpacity: 1,
  xhDynamic: true,
  xhWeaponStyles: true,
  xhAds: DEFAULT_XH_ADS,
});
/** Every crosshair settings key. */
export const XH_KEYS = Object.freeze(Object.keys(XH_DEFAULTS));

/** Colour swatches offered by the Crosshair screen (plus a free colour picker). */
export const XH_SWATCHES = Object.freeze(['#ffffff', '#4dff6a', '#ffe23d', '#3de0ff', '#ff4dd8', '#ff4040']);

/** Per-weapon reticle variant (data-style) used when xhWeaponStyles is on. */
export const WEAPON_XH_STYLE = Object.freeze({ shotgun: 'ring', rocket: 'rocket', rail: 'rail', arc: 'arc', gale: 'cone' });

/** HUD font size (px) at 1920x1080: the reference size of xhSize / xhThickness / xhDotSize. */
export const XH_REF_EM = 17.72;

const HEX6 = /^#[0-9a-f]{6}$/;
const HEX3 = /^#[0-9a-f]{3}$/;

// ------------------------------------------------------------------------------------ validation

/** @returns {string|null} '#rrggbb' (lower case) or null when `v` is not a hex colour. */
export function normalizeColor(v) {
  if (typeof v !== 'string') return null;
  let s = v.trim().toLowerCase();
  if (s && s[0] !== '#') s = '#' + s;
  if (HEX3.test(s)) s = '#' + s[1] + s[1] + s[2] + s[2] + s[3] + s[3];
  return HEX6.test(s) ? s : null;
}

/**
 * Defensive normaliser for anything that claims to be an ADS map (saved settings, share codes, old versions): a fresh,
 * complete { weaponId: 'hide'|'fade'|'show' } for every id in WEAPON_IDS. Unknown ids are dropped, invalid values fall
 * back to the weapon's default.
 * @param {*} input
 * @returns {Record<string,string>}
 */
export function sanitizeAdsModes(input) {
  const src = input && typeof input === 'object' && !Array.isArray(input) ? input : null;
  const out = {};
  for (const id of WEAPON_IDS) {
    const dflt = DEFAULT_XH_ADS[id] || ADS_FALLBACK;
    const v = src && Object.hasOwn(src, id) && typeof src[id] === 'string' ? src[id].trim().toLowerCase() : '';
    out[id] = XH_ADS_MODES.includes(v) ? v : dflt;
  }
  return out;
}

/** @returns {boolean} true when two ADS maps are identical after normalisation. */
export function adsModesEqual(a, b) {
  const x = sanitizeAdsModes(a), y = sanitizeAdsModes(b);
  for (const id of WEAPON_IDS) if (x[id] !== y[id]) return false;
  return true;
}

/**
 * Valid value for one crosshair key: enums / colours are checked, numbers clamped to XH_RANGES and snapped to the
 * step, booleans type-checked, the ADS map sanitised. Anything invalid becomes the key's default.
 * @param {string} key an XH_KEYS entry
 * @param {*} value
 */
export function sanitizeCrosshairValue(key, value) {
  const dflt = XH_DEFAULTS[key];
  if (key === 'xhAds') return sanitizeAdsModes(value);
  if (key === 'xhStyle') return XH_STYLES.includes(value) ? value : dflt;
  if (key === 'xhColor') return normalizeColor(value) || dflt;
  const range = XH_RANGES[key];
  if (range) {
    const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
    if (typeof n !== 'number' || !Number.isFinite(n)) return dflt;
    const [lo, hi, step] = range;
    const snapped = Math.round(n / step) * step;
    return Math.min(hi, Math.max(lo, +snapped.toFixed(2)));
  }
  if (typeof dflt === 'boolean') return typeof value === 'boolean' ? value : dflt;
  return value;
}

/**
 * Validate every crosshair key of a settings data object in place (used by Settings.load: keeps hand-edited /
 * stale values inside the UI ranges). Missing keys get their default.
 * @param {object} data
 */
export function sanitizeCrosshairSettings(data) {
  for (const k of XH_KEYS) data[k] = sanitizeCrosshairValue(k, data[k]);
}

/**
 * The crosshair config the renderer uses, from a Settings instance (get(key)) or a plain object with xh* keys.
 * @param {{get?:Function}|object} src
 * @returns {{style:string,color:string,size:number,thickness:number,gap:number,dot:boolean,dotSize:number,outline:number,
 *   opacity:number,dynamic:boolean,weaponStyles:boolean,ads:Record<string,string>}}
 */
export function readCrosshair(src) {
  const get = src && typeof src.get === 'function' ? k => src.get(k) : k => (src ? src[k] : undefined);
  const v = k => sanitizeCrosshairValue(k, get(k));
  return {
    style: v('xhStyle'), color: v('xhColor'), size: v('xhSize'), thickness: v('xhThickness'), gap: v('xhGap'),
    dot: v('xhDot'), dotSize: v('xhDotSize'), outline: v('xhOutline'), opacity: v('xhOpacity'),
    dynamic: v('xhDynamic'), weaponStyles: v('xhWeaponStyles'), ads: v('xhAds'),
  };
}

/** The settings values of the defaults (fresh ADS map). */
export function defaultCrosshairValues() {
  const out = {};
  for (const k of XH_KEYS) out[k] = k === 'xhAds' ? { ...DEFAULT_XH_ADS } : XH_DEFAULTS[k];
  return out;
}

// ------------------------------------------------------------------------------------ ADS behaviour

/**
 * Crosshair visibility factor (0..1) while aiming down sights.
 *   hide: 1 - smoothstep(0.2, 0.75, ads): gone before the sight settles (the viewmodel pose follows
 *         smoothstep(adsAmount)), so there is no pop when the Longbow scope overlay appears at 0.9;
 *   fade: 1 - 0.7 * ads (the original behaviour); show: 1.
 * @param {'hide'|'fade'|'show'} mode
 * @param {number} ads weapons.adsAmount (0..1)
 * @returns {number}
 */
export function adsVisibility(mode, ads) {
  const a = ads > 0 ? (ads < 1 ? ads : 1) : 0;
  if (mode === 'show') return 1;
  if (mode === 'hide') {
    const t = Math.min(1, Math.max(0, (a - 0.2) / 0.55));
    return 1 - t * t * (3 - 2 * t);
  }
  return 1 - 0.7 * a;
}

/** @returns {'hide'|'fade'|'show'} the configured ADS mode of a weapon (fallback: 'fade'). */
export function adsModeOf(ads, id) {
  const m = ads && ads[id];
  return m === 'hide' || m === 'fade' || m === 'show' ? m : (DEFAULT_XH_ADS[id] || ADS_FALLBACK);
}

// ------------------------------------------------------------------------------------ share codes

// v1 layout: XH1-<style>-<rrggbb>-<size>-<thickness>-<gap>-<dot 0|1>-<dotSize>-<outline>-<opacity %>-<dynamic 0|1>-<weapon
// reticles 0|1>-<ADS h|f|s per weapon in CODE_V1_IDS order>. The id list is frozen per version (new weapons -> v2).
const CODE_V1_IDS = ['pistol', 'rifle', 'shotgun', 'sniper', 'rocket', 'smg', 'arc', 'rail', 'gale'];
const STYLE_CHAR = { cross: 'c', tee: 't', circle: 'o', dot: 'd' };
const ADS_CHAR = { hide: 'h', fade: 'f', show: 's' };

/**
 * Compact, human-copyable share code for a crosshair (localStorage is per origin, so LAN players carry their
 * crosshair between hosts with it).
 * @param {{get?:Function}|object} src settings or an object with xh* keys
 * @returns {string} e.g. 'XH1-c-ffffff-12-3-3-1-4-1-100-1-1-hhfhhhhhh'
 */
export function encodeCrosshair(src) {
  const c = readCrosshair(src);
  const b = x => (x ? '1' : '0');
  const ads = CODE_V1_IDS.map(id => ADS_CHAR[adsModeOf(c.ads, id)]).join('');
  return ['XH1', STYLE_CHAR[c.style], c.color.slice(1), c.size, c.thickness, c.gap, b(c.dot), c.dotSize, c.outline,
    Math.round(c.opacity * 100), b(c.dynamic), b(c.weaponStyles), ads].join('-');
}

/**
 * Parse a share code. Returns the settings values (every XH_KEYS entry, sanitised) or null when the text is not a
 * crosshair code. Surrounding whitespace / quotes and letter case are ignored.
 * @param {string} code
 * @returns {object|null}
 */
export function decodeCrosshair(code) {
  if (typeof code !== 'string') return null;
  const parts = code.trim().replace(/^["'`]+|["'`]+$/g, '').toLowerCase().split('-');
  if (parts.length !== 13 || parts[0] !== 'xh1') return null;
  const style = Object.keys(STYLE_CHAR).find(k => STYLE_CHAR[k] === parts[1]);
  const color = normalizeColor('#' + parts[2]);
  const num = s => (/^\d+(\.\d+)?$/.test(s) ? Number(s) : NaN);
  const bit = s => (s === '1' ? true : s === '0' ? false : null);
  const nums = [3, 4, 5, 7, 8, 9].map(i => num(parts[i]));
  const bits = [6, 10, 11].map(i => bit(parts[i]));
  if (!style || !color || nums.some(n => !Number.isFinite(n)) || bits.some(x => x === null) || !/^[hfs]+$/.test(parts[12])) return null;
  const ads = {};
  CODE_V1_IDS.forEach((id, i) => {
    const ch = parts[12][i];
    if (ch) ads[id] = Object.keys(ADS_CHAR).find(k => ADS_CHAR[k] === ch);
  });
  const raw = {
    xhStyle: style, xhColor: color, xhSize: nums[0], xhThickness: nums[1], xhGap: nums[2], xhDot: bits[0],
    xhDotSize: nums[3], xhOutline: nums[4], xhOpacity: nums[5] / 100, xhDynamic: bits[1], xhWeaponStyles: bits[2], xhAds: ads,
  };
  const out = {};
  for (const k of XH_KEYS) out[k] = sanitizeCrosshairValue(k, raw[k]);
  return out;
}

// ------------------------------------------------------------------------------------ DOM

/**
 * Inner markup of a crosshair element (`<div class="xh">`): four ticks, the centre square (fills the junction of a
 * gap-0 cross), the dot, the circle and the weapon ring.
 */
export function crosshairMarkup() {
  return '<b class="ch t"></b><b class="ch b"></b><b class="ch l"></b><b class="ch r"></b><b class="ch c"></b><b class="ch dot"></b><b class="ch-cir"></b><b class="ch-ring"></b>';
}

/** Relative luminance of '#rrggbb' (0..1). */
function lum(hex) {
  const n = parseInt(hex.slice(1), 16);
  return (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255;
}

/**
 * Whole-device-pixel geometry of a crosshair (every length is returned in device pixels).
 * @param {ReturnType<typeof readCrosshair>} cfg
 * @param {number} emPx font size of the HUD / preview (px)
 * @param {number} dpr devicePixelRatio
 */
export function crosshairMetrics(cfg, emPx, dpr) {
  const k = (emPx > 0 ? emPx : XH_REF_EM) / XH_REF_EM;
  const dev = (css, min = 1) => Math.max(min, Math.round(css * dpr));
  const t = dev(cfg.thickness * k);
  const em = x => dev(x * emPx);
  // the dot takes the parity of the line thickness, so it is centred on the lines (no half-pixel offset); ties round up
  const dotRaw = Math.max(1, cfg.dotSize * k * dpr);
  let dot = Math.round(dotRaw);
  if ((dot - t) % 2 !== 0) dot = dotRaw >= dot || dot - 1 < 1 ? dot + 1 : dot - 1;
  return {
    dpr,
    t,                                  // line thickness
    h: Math.floor(t / 2),               // offset of the line's first pixel from the centre
    len: dev(cfg.size * k),             // tick length
    dot,                                // dot size
    ol: cfg.outline > 0 ? dev(cfg.outline) : 0,
    gap: Math.round(cfg.gap * dpr),     // minimum gap (CSS px setting)
    ring: t,                            // shotgun pellet ring stroke
    ringThin: Math.max(1, t - 1),       // decorative / charge ring stroke
    rail: em(0.55),                     // Javelin ring radius beyond the spread gap
    rocket: em(1.7),                    // Hammer ring radius
    arc: em(1.5),                       // Tempest ring radius
    galeX: em(4.04),                    // Gale bracket inner distance
    galeH: em(2),                       // Gale bracket height
  };
}

/**
 * Apply a crosshair config to a crosshair element (`.xh`, children from crosshairMarkup()): colour, geometry (CSS
 * custom properties on the element itself - never on a large ancestor, which would restyle every descendant) and the
 * style / dot / tint data attributes. The spread gap (`--gap`, CSS px holding whole device pixels: the distance from
 * the centre to where the ticks start) is written separately by its owner every time it changes (HUD._updateCrosshair,
 * the Crosshair screen preview).
 * @param {HTMLElement} el
 * @param {ReturnType<typeof readCrosshair>} cfg
 * @param {{emPx:number, dpr:number}} env
 * @returns {ReturnType<typeof crosshairMetrics>} the metrics used
 */
export function applyCrosshair(el, cfg, env) {
  const dpr = env && env.dpr > 0 ? env.dpr : 1;
  const m = crosshairMetrics(cfg, env && env.emPx, dpr);
  const px = d => d / dpr + 'px';
  const s = el.style;
  s.setProperty('--xh-c', cfg.color);
  s.setProperty('--xh-oc', lum(cfg.color) < 0.3 ? 'rgba(255, 255, 255, 0.6)' : 'rgba(0, 0, 0, 0.62)');
  s.setProperty('--xh-th', px(m.t));
  s.setProperty('--xh-h', px(m.h));
  s.setProperty('--xh-o', px(m.t - 2 * m.h));
  s.setProperty('--xh-len', px(m.len));
  s.setProperty('--xh-dot', px(m.dot));
  s.setProperty('--xh-dp', px(Math.floor((m.t - m.dot) / 2) - m.h));
  s.setProperty('--xh-ol', px(m.ol));
  s.setProperty('--xh-cr', px(Math.round(m.len / 2)));
  s.setProperty('--xh-rb', px(m.ring));
  s.setProperty('--xh-rs', px(Math.floor((m.t - m.ring) / 2)));
  s.setProperty('--xh-rbt', px(m.ringThin));
  s.setProperty('--xh-rst', px(Math.floor((m.t - m.ringThin) / 2)));
  s.setProperty('--xh-rail', px(m.rail));
  s.setProperty('--xh-rocket', px(m.rocket));
  s.setProperty('--xh-arc', px(m.arc));
  s.setProperty('--xh-gx', px(m.galeX));
  s.setProperty('--xh-gh', px(m.galeH));
  s.setProperty('--xh-gt', px(Math.floor((m.t - m.galeH) / 2) - m.h));
  el.dataset.shape = cfg.style;
  el.dataset.dot = cfg.dot || cfg.style === 'dot' ? '1' : '0';
  el.dataset.tint = cfg.color === '#ffffff' ? '1' : '0';
  return m;
}

/**
 * Distance (device px) from the crosshair centre to the lower edge of what is drawn, for placing the reload bar /
 * momentum meter / prompts under it.
 * @param {ReturnType<typeof crosshairMetrics>} m
 * @param {string} shape cfg.style
 * @param {string} wstyle weapon data-style
 * @param {number} gapDev current gap in device px
 */
export function crosshairReach(m, shape, wstyle, gapDev) {
  let r;
  if (wstyle === 'ring') r = gapDev + m.ring;
  else if (wstyle === 'rail') r = gapDev + m.rail + m.ringThin;
  else if (wstyle === 'cone') r = Math.ceil(m.galeH / 2);
  else if (shape === 'circle') r = gapDev + Math.round(m.len / 2) + m.t;
  else if (shape === 'dot') r = Math.ceil(m.dot / 2);
  else r = gapDev + (m.t - 2 * m.h) + m.len;   // bottom tick (style.css: top = gap + t - 2h)
  if (wstyle === 'rocket') r = Math.max(r, m.rocket + m.ringThin);
  else if (wstyle === 'arc') r = Math.max(r, m.arc + m.ringThin);
  return r + m.ol;
}

/**
 * Snap an absolutely positioned crosshair anchor to the device-pixel grid: sets left / top (CSS px) to the centre of
 * a `width` x `height` box, rounded to whole device pixels.
 * @param {HTMLElement} el
 * @param {number} width
 * @param {number} height
 * @param {number} dpr
 */
export function snapAnchor(el, width, height, dpr) {
  const x = Math.round((width / 2) * dpr) / dpr;
  const y = Math.round((height / 2) * dpr) / dpr;
  el.style.left = x + 'px';
  el.style.top = y + 'px';
}
